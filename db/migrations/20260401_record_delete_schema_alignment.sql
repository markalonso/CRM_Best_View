begin;

-- Re-align transactional record delete RPC with the real schema.
-- This safely overwrites any drifted function body deployed manually.
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

-- Keep a compatibility overload for environments where RPC lookup resolves
-- arguments in reverse order.
create or replace function public.delete_crm_records_transactional(
  p_record_ids uuid[],
  p_type text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.delete_crm_records_transactional(
    p_type::text,
    p_record_ids::uuid[]
  );
$$;

commit;
