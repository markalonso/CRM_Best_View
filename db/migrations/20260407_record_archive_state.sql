begin;

alter table public.properties_sale add column if not exists is_archived boolean not null default false;
alter table public.properties_sale add column if not exists archived_at timestamptz;
alter table public.properties_sale add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.properties_rent add column if not exists is_archived boolean not null default false;
alter table public.properties_rent add column if not exists archived_at timestamptz;
alter table public.properties_rent add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.buyers add column if not exists is_archived boolean not null default false;
alter table public.buyers add column if not exists archived_at timestamptz;
alter table public.buyers add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.clients add column if not exists is_archived boolean not null default false;
alter table public.clients add column if not exists archived_at timestamptz;
alter table public.clients add column if not exists archived_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_sale_archive_state_check'
      and conrelid = 'public.properties_sale'::regclass
  ) then
    alter table public.properties_sale
      add constraint properties_sale_archive_state_check
      check (
        (is_archived = false and archived_at is null)
        or (is_archived = true and archived_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_rent_archive_state_check'
      and conrelid = 'public.properties_rent'::regclass
  ) then
    alter table public.properties_rent
      add constraint properties_rent_archive_state_check
      check (
        (is_archived = false and archived_at is null)
        or (is_archived = true and archived_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'buyers_archive_state_check'
      and conrelid = 'public.buyers'::regclass
  ) then
    alter table public.buyers
      add constraint buyers_archive_state_check
      check (
        (is_archived = false and archived_at is null)
        or (is_archived = true and archived_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_archive_state_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_archive_state_check
      check (
        (is_archived = false and archived_at is null)
        or (is_archived = true and archived_at is not null)
      );
  end if;
end
$$;

create index if not exists idx_properties_sale_active_updated_at
  on public.properties_sale(updated_at desc)
  where is_archived = false;

create index if not exists idx_properties_sale_archived_at
  on public.properties_sale(archived_at desc)
  where is_archived = true;

create index if not exists idx_properties_rent_active_updated_at
  on public.properties_rent(updated_at desc)
  where is_archived = false;

create index if not exists idx_properties_rent_archived_at
  on public.properties_rent(archived_at desc)
  where is_archived = true;

create index if not exists idx_buyers_active_updated_at
  on public.buyers(updated_at desc)
  where is_archived = false;

create index if not exists idx_buyers_archived_at
  on public.buyers(archived_at desc)
  where is_archived = true;

create index if not exists idx_clients_active_updated_at
  on public.clients(updated_at desc)
  where is_archived = false;

create index if not exists idx_clients_archived_at
  on public.clients(archived_at desc)
  where is_archived = true;

commit;
