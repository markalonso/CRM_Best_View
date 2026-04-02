-- 2026-04-01: Admin + Agent role foundation (compat for existing current_app_role() text)
--
-- Purpose:
--   * Keep existing projects safe where public.current_app_role() already returns text
--   * Standardize active roles to admin|agent using public.profiles.role
--   * Avoid dropping current_app_role() because many RLS policies may depend on it

begin;

-- 1) Role type + profiles storage

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'agent', 'viewer');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null default 'agent',
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_profiles_role on public.profiles(role);

-- 2) Backfill/default strategy
update public.profiles
set role = 'agent'
where role is null or role = 'viewer';

alter table public.profiles
  alter column role set default 'agent';

alter table public.profiles
  drop constraint if exists profiles_role_admin_agent_check;

alter table public.profiles
  add constraint profiles_role_admin_agent_check
  check (role in ('admin', 'agent'));

-- 3) updated_at trigger helper
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

-- 4) Role helper functions
-- IMPORTANT: keep current_app_role() return type as text for compatibility
create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    (
      select p.role::text
      from public.profiles p
      where p.user_id = auth.uid()
      limit 1
    ),
    'agent'
  );
$$;

create or replace function public.current_app_role_enum()
returns public.app_role
language sql
stable
as $$
  select case
    when public.current_app_role() = 'admin' then 'admin'::public.app_role
    else 'agent'::public.app_role
  end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'admin';
$$;

create or replace function public.my_role()
returns text
language sql
stable
as $$
  select public.current_app_role();
$$;

-- 5) Admin role-management RPC
create or replace function public.admin_set_user_role(target_user_id uuid, new_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  out_profile public.profiles;
begin
  actor_role := public.current_app_role();
  if actor_role <> 'admin' then
    raise exception 'Only admin can set roles';
  end if;

  if new_role not in ('admin'::public.app_role, 'agent'::public.app_role) then
    raise exception 'Role must be admin or agent';
  end if;

  insert into public.profiles as p (user_id, role)
  values (target_user_id, new_role)
  on conflict (user_id)
  do update set role = excluded.role, updated_at = now()
  returning p.* into out_profile;

  return out_profile;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, public.app_role) from public;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;

-- 6) Profiles RLS policies
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
using (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists profiles_insert_self_or_admin on public.profiles;
create policy profiles_insert_self_or_admin
on public.profiles
for insert
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
using (user_id = auth.uid() or public.current_app_role() = 'admin')
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin
on public.profiles
for delete
using (public.current_app_role() = 'admin');

commit;
