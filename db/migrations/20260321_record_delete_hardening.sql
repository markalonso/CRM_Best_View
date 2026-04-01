begin;

create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  bucket text not null,
  path text not null,
  status text not null default 'pending',
  reason text not null default 'storage_delete_failed',
  last_error text,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint storage_cleanup_queue_status_check check (status in ('pending', 'resolved'))
);

alter table public.storage_cleanup_queue add column if not exists id uuid default gen_random_uuid();
alter table public.storage_cleanup_queue add column if not exists entity_type text;
alter table public.storage_cleanup_queue add column if not exists entity_id uuid;
alter table public.storage_cleanup_queue add column if not exists bucket text;
alter table public.storage_cleanup_queue add column if not exists path text;
alter table public.storage_cleanup_queue add column if not exists status text default 'pending';
alter table public.storage_cleanup_queue add column if not exists reason text default 'storage_delete_failed';
alter table public.storage_cleanup_queue add column if not exists last_error text;
alter table public.storage_cleanup_queue add column if not exists context_json jsonb not null default '{}'::jsonb;
alter table public.storage_cleanup_queue add column if not exists created_at timestamptz not null default now();
alter table public.storage_cleanup_queue add column if not exists updated_at timestamptz not null default now();
alter table public.storage_cleanup_queue add column if not exists resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'storage_cleanup_queue_status_check'
      and conrelid = 'public.storage_cleanup_queue'::regclass
  ) then
    alter table public.storage_cleanup_queue
      add constraint storage_cleanup_queue_status_check check (status in ('pending', 'resolved'));
  end if;
end;
$$;

create unique index if not exists idx_storage_cleanup_queue_bucket_path_status
  on public.storage_cleanup_queue (bucket, path, status);

create index if not exists idx_storage_cleanup_queue_status_created
  on public.storage_cleanup_queue (status, created_at desc);

drop trigger if exists trg_storage_cleanup_queue_updated_at on public.storage_cleanup_queue;
create trigger trg_storage_cleanup_queue_updated_at
before update on public.storage_cleanup_queue
for each row execute function public.set_updated_at();

alter table public.storage_cleanup_queue enable row level security;

drop policy if exists storage_cleanup_queue_read_admin on public.storage_cleanup_queue;
create policy storage_cleanup_queue_read_admin
on public.storage_cleanup_queue
for select
using (public.current_app_role() = 'admin');

drop policy if exists storage_cleanup_queue_write_admin on public.storage_cleanup_queue;
create policy storage_cleanup_queue_write_admin
on public.storage_cleanup_queue
for all
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create or replace function public.delete_crm_records_transactional(p_type text, p_record_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_related_type text;
  v_link_column text;
  v_existing_ids uuid[];
  v_deleted_record_ids uuid[];
  v_deleted_media_ids uuid[];
  v_deleted_task_count integer := 0;
  v_deleted_timeline_count integer := 0;
  v_deleted_audit_log_count integer := 0;
  v_cleared_intake_session_count integer := 0;
  v_deleted_hierarchy_link_count integer := 0;
begin
  if p_type not in ('sale', 'rent', 'buyer', 'client') then
    raise exception 'Unsupported record delete type %', p_type;
  end if;

  if coalesce(array_length(p_record_ids, 1), 0) = 0 then
    raise exception 'Select at least one record to delete.';
  end if;

  v_table := case p_type
    when 'sale' then 'properties_sale'
    when 'rent' then 'properties_rent'
    when 'buyer' then 'buyers'
    when 'client' then 'clients'
    else null
  end;

  v_related_type := p_type;

  v_link_column := case p_type
    when 'sale' then 'sale_id'
    when 'rent' then 'rent_id'
    when 'buyer' then 'buyer_id'
    when 'client' then 'client_id'
    else null
  end;

  execute format(
    'select coalesce(array_agg(id), array[]::uuid[]) from public.%I where id = any($1)',
    v_table
  )
  into v_existing_ids
  using p_record_ids;

  if coalesce(array_length(v_existing_ids, 1), 0) = 0 then
    raise exception 'No matching records were found for deletion.';
  end if;

  with deleted as (
    delete from public.tasks
    where related_type::text = v_related_type
      and related_id = any(v_existing_ids)
    returning id
  )
  select count(*)::integer into v_deleted_task_count from deleted;

  with deleted as (
    delete from public.timeline
    where record_type::text = v_table
      and record_id = any(v_existing_ids)
    returning id
  )
  select count(*)::integer into v_deleted_timeline_count from deleted;

  with deleted as (
    delete from public.audit_logs
    where record_type::text = v_table
      and record_id = any(v_existing_ids)
    returning id
  )
  select count(*)::integer into v_deleted_audit_log_count from deleted;

  with updated as (
    update public.intake_sessions
    set final_record_type = null,
        final_record_id = null
    where final_record_type::text = v_table
      and final_record_id = any(v_existing_ids)
    returning id
  )
  select count(*)::integer into v_cleared_intake_session_count from updated;

  with deleted as (
    delete from public.media
    where record_type::text = v_table
      and record_id = any(v_existing_ids)
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_deleted_media_ids from deleted;

  execute format(
    'with deleted as (
       delete from public.record_hierarchy_links
       where %I = any($1)
       returning id
     )
     select count(*)::integer from deleted',
    v_link_column
  )
  into v_deleted_hierarchy_link_count
  using v_existing_ids;

  execute format(
    'with deleted as (
       delete from public.%I
       where id = any($1)
       returning id
     )
     select coalesce(array_agg(id), array[]::uuid[]) from deleted',
    v_table
  )
  into v_deleted_record_ids
  using v_existing_ids;

  return jsonb_build_object(
    'deleted_record_ids', coalesce(to_jsonb(v_deleted_record_ids), '[]'::jsonb),
    'deleted_media_ids', coalesce(to_jsonb(v_deleted_media_ids), '[]'::jsonb),
    'deleted_task_count', v_deleted_task_count,
    'deleted_timeline_count', v_deleted_timeline_count,
    'deleted_audit_log_count', v_deleted_audit_log_count,
    'cleared_intake_session_count', v_cleared_intake_session_count,
    'deleted_hierarchy_link_count', v_deleted_hierarchy_link_count
  );
end;
$$;

commit;
