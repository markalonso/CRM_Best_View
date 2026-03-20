-- 2026-03-19: Hierarchy foundation / behavior model / RLS hardening
--
-- Purpose
-- -------
-- This migration codifies the hierarchy layer that the application already expects:
--   * hierarchy_nodes
--   * hierarchy_node_closure
--   * record_hierarchy_links
--   * media_hierarchy_links
--   * field_definitions
--   * hierarchy_field_overrides
--   * record_custom_field_values
--
-- It also introduces explicit node-behavior columns so business rules are enforced
-- in Postgres instead of being inferred loosely from node_kind labels.
--
-- Key business rules enforced here
-- --------------------------------
--   * Each family (sale, rent, buyers, clients, media) has one root node.
--   * Root nodes are navigation containers only.
--   * Root nodes cannot directly contain records.
--   * Child nodes may be:
--       - folder only
--       - record-container only
--       - folder + record-container
--   * Only active record-container nodes are assignable to records.
--   * Admin users may mutate hierarchy definitions.
--   * Agent/admin users may assign records/media to nodes.
--
-- Compatibility notes
-- -------------------
--   * Existing allow_record_assignment is preserved for application compatibility.
--   * New can_contain_records is the stronger behavioral source of truth.
--   * Triggers keep allow_record_assignment synchronized for older code paths.
--   * The migration is written to tolerate reruns after partial/manual application.
--
-- Rollback notes
-- --------------
--   * See the "Rollback Notes" comment block near the end of this file.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.hierarchy_is_valid_family(p_family text)
returns boolean
language sql
immutable
as $$
  select p_family in ('sale', 'rent', 'buyers', 'clients', 'media')
$$;

create or replace function public.hierarchy_is_record_family(p_family text)
returns boolean
language sql
immutable
as $$
  select p_family in ('sale', 'rent', 'buyers', 'clients')
$$;

create or replace function public.hierarchy_is_valid_node_kind(p_kind text)
returns boolean
language sql
immutable
as $$
  select p_kind in ('root', 'folder', 'project', 'building', 'unit', 'phase', 'custom')
$$;

-- ---------------------------------------------------------------------------
-- hierarchy_nodes
-- ---------------------------------------------------------------------------

create table if not exists public.hierarchy_nodes (
  id uuid primary key default gen_random_uuid(),
  family text not null,
  parent_id uuid references public.hierarchy_nodes(id) on delete cascade,
  node_kind text not null default 'folder',
  node_key text not null,
  name text not null,
  path_text text not null default '',
  depth integer not null default 0,
  sort_order integer not null default 0,
  allow_record_assignment boolean not null default false,
  can_have_children boolean not null default true,
  can_contain_records boolean not null default false,
  is_root boolean not null default false,
  is_active boolean not null default true,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hierarchy_nodes_family_check check (public.hierarchy_is_valid_family(family)),
  constraint hierarchy_nodes_kind_check check (public.hierarchy_is_valid_node_kind(node_kind)),
  constraint hierarchy_nodes_key_check check (node_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  constraint hierarchy_nodes_sort_order_check check (sort_order >= 0),
  constraint hierarchy_nodes_depth_check check (depth >= 0),
  constraint hierarchy_nodes_root_shape_check check (
    (is_root = true and parent_id is null and node_kind = 'root')
    or
    (is_root = false)
  ),
  constraint hierarchy_nodes_root_container_only_check check (
    is_root = false
    or
    (can_have_children = true and can_contain_records = false and allow_record_assignment = false)
  ),
  constraint hierarchy_nodes_archived_state_check check (
    (archived_at is null and is_active = true)
    or
    (archived_at is not null and is_active = false)
  )
);

alter table public.hierarchy_nodes add column if not exists family text;
alter table public.hierarchy_nodes add column if not exists parent_id uuid references public.hierarchy_nodes(id) on delete cascade;
alter table public.hierarchy_nodes add column if not exists node_kind text not null default 'folder';
alter table public.hierarchy_nodes add column if not exists node_key text;
alter table public.hierarchy_nodes add column if not exists name text;
alter table public.hierarchy_nodes add column if not exists path_text text not null default '';
alter table public.hierarchy_nodes add column if not exists depth integer not null default 0;
alter table public.hierarchy_nodes add column if not exists sort_order integer not null default 0;
alter table public.hierarchy_nodes add column if not exists allow_record_assignment boolean not null default false;
alter table public.hierarchy_nodes add column if not exists can_have_children boolean not null default true;
alter table public.hierarchy_nodes add column if not exists can_contain_records boolean not null default false;
alter table public.hierarchy_nodes add column if not exists is_root boolean not null default false;
alter table public.hierarchy_nodes add column if not exists is_active boolean not null default true;
alter table public.hierarchy_nodes add column if not exists archived_at timestamptz;
alter table public.hierarchy_nodes add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.hierarchy_nodes add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.hierarchy_nodes add column if not exists created_at timestamptz not null default now();
alter table public.hierarchy_nodes add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_hierarchy_nodes_one_root_per_family
  on public.hierarchy_nodes (family)
  where is_root = true;

create unique index if not exists idx_hierarchy_nodes_family_parent_key
  on public.hierarchy_nodes (family, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(node_key));

create index if not exists idx_hierarchy_nodes_parent_sort
  on public.hierarchy_nodes (parent_id, sort_order, name);

create index if not exists idx_hierarchy_nodes_family_active
  on public.hierarchy_nodes (family, is_active, can_contain_records, is_root);

-- ---------------------------------------------------------------------------
-- hierarchy_node_closure
-- ---------------------------------------------------------------------------

create table if not exists public.hierarchy_node_closure (
  ancestor_id uuid not null references public.hierarchy_nodes(id) on delete cascade,
  descendant_id uuid not null references public.hierarchy_nodes(id) on delete cascade,
  depth integer not null,
  created_at timestamptz not null default now(),
  primary key (ancestor_id, descendant_id),
  constraint hierarchy_node_closure_depth_check check (depth >= 0)
);

create index if not exists idx_hierarchy_node_closure_descendant
  on public.hierarchy_node_closure (descendant_id, depth);

-- ---------------------------------------------------------------------------
-- hierarchy node normalization / validation
-- ---------------------------------------------------------------------------

create or replace function public.hierarchy_prepare_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.hierarchy_nodes%rowtype;
begin
  new.family := lower(trim(coalesce(new.family, '')));
  new.node_kind := lower(trim(coalesce(new.node_kind, 'folder')));
  new.node_key := lower(trim(coalesce(new.node_key, '')));
  new.name := trim(coalesce(new.name, ''));
  new.sort_order := coalesce(new.sort_order, 0);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if new.family = '' or not public.hierarchy_is_valid_family(new.family) then
    raise exception 'Invalid hierarchy family: %', new.family;
  end if;

  if new.node_kind = '' or not public.hierarchy_is_valid_node_kind(new.node_kind) then
    raise exception 'Invalid hierarchy node_kind: %', new.node_kind;
  end if;

  if new.node_key = '' then
    raise exception 'node_key is required';
  end if;

  if new.name = '' then
    raise exception 'name is required';
  end if;

  if new.parent_id is null then
    new.is_root := true;
    new.node_kind := 'root';
    new.can_have_children := true;
    new.can_contain_records := false;
    new.allow_record_assignment := false;
    new.depth := 0;
    new.path_text := new.name;
  else
    select *
    into v_parent
    from public.hierarchy_nodes
    where id = new.parent_id;

    if not found then
      raise exception 'Parent hierarchy node % not found', new.parent_id;
    end if;

    if v_parent.family <> new.family then
      raise exception 'Parent family % does not match child family %', v_parent.family, new.family;
    end if;

    if not v_parent.can_have_children then
      raise exception 'Parent node % cannot have child nodes', v_parent.id;
    end if;

    new.is_root := false;
    new.depth := coalesce(v_parent.depth, 0) + 1;
    new.path_text := trim(both ' /' from concat_ws(' / ', v_parent.path_text, new.name));
    new.allow_record_assignment := coalesce(new.can_contain_records, false);
  end if;

  if new.is_root then
    new.archived_at := null;
    new.is_active := true;
  else
    if new.archived_at is not null then
      new.is_active := false;
    elsif new.is_active = false then
      new.archived_at := coalesce(new.archived_at, now());
    else
      new.archived_at := null;
    end if;
  end if;

  if new.can_contain_records is null then
    new.can_contain_records := false;
  end if;

  if new.can_have_children is null then
    new.can_have_children := true;
  end if;

  if new.is_root and new.can_contain_records then
    raise exception 'Root hierarchy nodes cannot contain records';
  end if;

  if new.created_at is null then
    new.created_at := now();
  end if;
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists trg_hierarchy_nodes_prepare on public.hierarchy_nodes;
create trigger trg_hierarchy_nodes_prepare
before insert or update of family, parent_id, node_kind, node_key, name, sort_order, can_have_children, can_contain_records, is_root, is_active, archived_at, metadata
on public.hierarchy_nodes
for each row
execute function public.hierarchy_prepare_node();

create or replace function public.hierarchy_rebuild_closure_for_node(p_node_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.hierarchy_nodes%rowtype;
begin
  select *
  into v_node
  from public.hierarchy_nodes
  where id = p_node_id;

  if not found then
    return;
  end if;

  delete from public.hierarchy_node_closure
  where descendant_id = p_node_id;

  insert into public.hierarchy_node_closure (ancestor_id, descendant_id, depth)
  values (p_node_id, p_node_id, 0)
  on conflict (ancestor_id, descendant_id) do update set depth = excluded.depth;

  if v_node.parent_id is not null then
    insert into public.hierarchy_node_closure (ancestor_id, descendant_id, depth)
    select ancestor_id, p_node_id, depth + 1
    from public.hierarchy_node_closure
    where descendant_id = v_node.parent_id
    on conflict (ancestor_id, descendant_id) do update set depth = excluded.depth;
  end if;
end;
$$;

create or replace function public.hierarchy_after_insert_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hierarchy_rebuild_closure_for_node(new.id);
  return new;
end;
$$;

drop trigger if exists trg_hierarchy_nodes_after_insert on public.hierarchy_nodes;
create trigger trg_hierarchy_nodes_after_insert
after insert
on public.hierarchy_nodes
for each row
execute function public.hierarchy_after_insert_node();

create or replace function public.hierarchy_after_parent_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.parent_id is distinct from new.parent_id then
    perform public.hierarchy_refresh_subtree_metadata(new.id);
    perform public.hierarchy_rebuild_full_closure();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hierarchy_nodes_after_parent_change on public.hierarchy_nodes;
create trigger trg_hierarchy_nodes_after_parent_change
after update of parent_id
on public.hierarchy_nodes
for each row
execute function public.hierarchy_after_parent_change();

create or replace function public.hierarchy_refresh_subtree_metadata(p_root_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with recursive subtree as (
    select
      n.id,
      n.parent_id,
      n.name,
      n.depth,
      n.path_text,
      0::integer as computed_depth,
      trim(n.name) as computed_path
    from public.hierarchy_nodes n
    where n.id = p_root_id

    union all

    select
      child.id,
      child.parent_id,
      child.name,
      child.depth,
      child.path_text,
      subtree.computed_depth + 1,
      trim(both ' /' from concat_ws(' / ', subtree.computed_path, child.name))
    from public.hierarchy_nodes child
    join subtree on subtree.id = child.parent_id
  )
  update public.hierarchy_nodes n
  set
    depth = subtree.computed_depth,
    path_text = subtree.computed_path,
    updated_at = now()
  from subtree
  where n.id = subtree.id;
end;
$$;

create or replace function public.hierarchy_rebuild_full_closure()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.hierarchy_node_closure;

  with recursive closure_source as (
    select id as ancestor_id, id as descendant_id, 0::integer as depth
    from public.hierarchy_nodes

    union all

    select
      closure_source.ancestor_id,
      child.id as descendant_id,
      closure_source.depth + 1
    from closure_source
    join public.hierarchy_nodes child
      on child.parent_id = closure_source.descendant_id
  )
  insert into public.hierarchy_node_closure (ancestor_id, descendant_id, depth)
  select ancestor_id, descendant_id, min(depth)
  from closure_source
  group by ancestor_id, descendant_id;
end;
$$;

create or replace function public.move_hierarchy_node(p_node_id uuid, p_new_parent_id uuid)
returns public.hierarchy_nodes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.hierarchy_nodes%rowtype;
  v_parent public.hierarchy_nodes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() <> 'admin' then
    raise exception 'Only admins may move hierarchy nodes';
  end if;

  select *
  into v_node
  from public.hierarchy_nodes
  where id = p_node_id
  for update;

  if not found then
    raise exception 'Hierarchy node % not found', p_node_id;
  end if;

  if v_node.is_root then
    raise exception 'Root nodes cannot be moved';
  end if;

  if p_new_parent_id is null then
    raise exception 'Child nodes cannot be moved to null parent';
  end if;

  select *
  into v_parent
  from public.hierarchy_nodes
  where id = p_new_parent_id
  for update;

  if not found then
    raise exception 'New parent node % not found', p_new_parent_id;
  end if;

  if v_parent.family <> v_node.family then
    raise exception 'Cannot move nodes across families';
  end if;

  if not v_parent.can_have_children then
    raise exception 'Target parent cannot have child nodes';
  end if;

  if exists (
    select 1
    from public.hierarchy_node_closure
    where ancestor_id = p_node_id
      and descendant_id = p_new_parent_id
  ) then
    raise exception 'Cannot move a node under its own descendant';
  end if;

  update public.hierarchy_nodes
  set parent_id = p_new_parent_id
  where id = p_node_id;

  perform public.hierarchy_refresh_subtree_metadata(p_node_id);
  perform public.hierarchy_rebuild_full_closure();

  return (
    select n
    from public.hierarchy_nodes n
    where n.id = p_node_id
  );
end;
$$;

revoke all on function public.hierarchy_prepare_node() from public;
revoke all on function public.hierarchy_after_insert_node() from public;
revoke all on function public.hierarchy_after_parent_change() from public;
revoke all on function public.hierarchy_rebuild_closure_for_node(uuid) from public;
revoke all on function public.hierarchy_refresh_subtree_metadata(uuid) from public;
revoke all on function public.hierarchy_rebuild_full_closure() from public;
revoke all on function public.move_hierarchy_node(uuid, uuid) from public;
grant execute on function public.move_hierarchy_node(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill hierarchy node behavior columns
-- ---------------------------------------------------------------------------

update public.hierarchy_nodes
set
  family = lower(trim(family)),
  node_kind = lower(trim(coalesce(node_kind, 'folder'))),
  is_root = case
    when coalesce(is_root, false) then true
    when parent_id is null and (coalesce(depth, 0) = 0 or lower(coalesce(node_kind, '')) = 'root') then true
    else false
  end,
  can_have_children = coalesce(can_have_children, true),
  can_contain_records = case
    when parent_id is null and (coalesce(depth, 0) = 0 or lower(coalesce(node_kind, '')) = 'root') then false
    else coalesce(can_contain_records, allow_record_assignment, false)
  end,
  allow_record_assignment = case
    when parent_id is null and (coalesce(depth, 0) = 0 or lower(coalesce(node_kind, '')) = 'root') then false
    else coalesce(can_contain_records, allow_record_assignment, false)
  end,
  is_active = case
    when archived_at is not null then false
    else coalesce(is_active, true)
  end,
  archived_at = case
    when parent_id is null and (coalesce(depth, 0) = 0 or lower(coalesce(node_kind, '')) = 'root') then null
    when coalesce(is_active, true) = false and archived_at is null then now()
    else archived_at
  end,
  node_key = lower(trim(coalesce(node_key, case when family is not null then family else id::text end))),
  name = trim(coalesce(name, node_key, family, 'Node')),
  metadata = coalesce(metadata, '{}'::jsonb),
  updated_at = now();

-- Normalize existing paths/depth after backfill.
with recursive roots as (
  select id
  from public.hierarchy_nodes
  where parent_id is null
)
select public.hierarchy_refresh_subtree_metadata(id)
from roots;

select public.hierarchy_rebuild_full_closure();

-- ---------------------------------------------------------------------------
-- Root seed data (idempotent)
-- ---------------------------------------------------------------------------

-- First, if a family has no root row, create it.
insert into public.hierarchy_nodes (
  family,
  parent_id,
  node_kind,
  node_key,
  name,
  sort_order,
  can_have_children,
  can_contain_records,
  allow_record_assignment,
  is_root,
  is_active,
  archived_at,
  metadata,
  created_by
)
select seed.family, null, 'root', seed.node_key, seed.name, 0, true, false, false, true, true, null, '{}'::jsonb, null
from (
  values
    ('sale', 'sale', 'Sale'),
    ('rent', 'rent', 'Rent'),
    ('buyers', 'buyers', 'Buyers'),
    ('clients', 'clients', 'Clients'),
    ('media', 'media', 'Media')
) as seed(family, node_key, name)
where not exists (
  select 1
  from public.hierarchy_nodes existing
  where existing.family = seed.family
    and existing.is_root = true
);

-- Next, harden any existing root rows to the new business rules.
update public.hierarchy_nodes
set
  parent_id = null,
  node_kind = 'root',
  node_key = lower(family),
  name = case family
    when 'sale' then 'Sale'
    when 'rent' then 'Rent'
    when 'buyers' then 'Buyers'
    when 'clients' then 'Clients'
    when 'media' then 'Media'
    else name
  end,
  can_have_children = true,
  can_contain_records = false,
  allow_record_assignment = false,
  is_root = true,
  is_active = true,
  archived_at = null,
  updated_at = now()
where is_root = true;

select public.hierarchy_rebuild_full_closure();
with recursive roots as (
  select id
  from public.hierarchy_nodes
  where is_root = true
)
select public.hierarchy_refresh_subtree_metadata(id)
from roots;

-- ---------------------------------------------------------------------------
-- record_hierarchy_links
-- ---------------------------------------------------------------------------

create table if not exists public.record_hierarchy_links (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.hierarchy_nodes(id) on delete cascade,
  sale_id uuid references public.properties_sale(id) on delete cascade,
  rent_id uuid references public.properties_rent(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint record_hierarchy_links_exactly_one_target check (
    ((sale_id is not null)::integer +
     (rent_id is not null)::integer +
     (buyer_id is not null)::integer +
     (client_id is not null)::integer) = 1
  )
);

alter table public.record_hierarchy_links add column if not exists id uuid default gen_random_uuid();
alter table public.record_hierarchy_links add column if not exists node_id uuid references public.hierarchy_nodes(id) on delete cascade;
alter table public.record_hierarchy_links add column if not exists sale_id uuid references public.properties_sale(id) on delete cascade;
alter table public.record_hierarchy_links add column if not exists rent_id uuid references public.properties_rent(id) on delete cascade;
alter table public.record_hierarchy_links add column if not exists buyer_id uuid references public.buyers(id) on delete cascade;
alter table public.record_hierarchy_links add column if not exists client_id uuid references public.clients(id) on delete cascade;
alter table public.record_hierarchy_links add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.record_hierarchy_links add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'record_hierarchy_links_exactly_one_target'
      and conrelid = 'public.record_hierarchy_links'::regclass
  ) then
    alter table public.record_hierarchy_links
      add constraint record_hierarchy_links_exactly_one_target check (
        ((sale_id is not null)::integer +
         (rent_id is not null)::integer +
         (buyer_id is not null)::integer +
         (client_id is not null)::integer) = 1
      );
  end if;
end;
$$;

create unique index if not exists idx_record_hierarchy_links_sale_unique
  on public.record_hierarchy_links (sale_id)
  where sale_id is not null;

create unique index if not exists idx_record_hierarchy_links_rent_unique
  on public.record_hierarchy_links (rent_id)
  where rent_id is not null;

create unique index if not exists idx_record_hierarchy_links_buyer_unique
  on public.record_hierarchy_links (buyer_id)
  where buyer_id is not null;

create unique index if not exists idx_record_hierarchy_links_client_unique
  on public.record_hierarchy_links (client_id)
  where client_id is not null;

create index if not exists idx_record_hierarchy_links_node
  on public.record_hierarchy_links (node_id, created_at desc);

create or replace function public.record_hierarchy_links_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.hierarchy_nodes%rowtype;
  v_family text;
begin
  select *
  into v_node
  from public.hierarchy_nodes
  where id = new.node_id;

  if not found then
    raise exception 'Hierarchy node % not found', new.node_id;
  end if;

  if v_node.is_active is distinct from true then
    raise exception 'Cannot assign records to archived hierarchy nodes';
  end if;

  if v_node.can_contain_records is distinct from true then
    raise exception 'Selected hierarchy node cannot contain records';
  end if;

  if v_node.is_root then
    raise exception 'Root hierarchy nodes cannot contain records';
  end if;

  v_family := case
    when new.sale_id is not null then 'sale'
    when new.rent_id is not null then 'rent'
    when new.buyer_id is not null then 'buyers'
    when new.client_id is not null then 'clients'
    else null
  end;

  if v_family is null then
    raise exception 'Record hierarchy link must target exactly one record';
  end if;

  if v_node.family <> v_family then
    raise exception 'Hierarchy node family % does not match record family %', v_node.family, v_family;
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_record_hierarchy_links_validate on public.record_hierarchy_links;
create trigger trg_record_hierarchy_links_validate
before insert or update of node_id, sale_id, rent_id, buyer_id, client_id
on public.record_hierarchy_links
for each row
execute function public.record_hierarchy_links_validate();

-- ---------------------------------------------------------------------------
-- media_hierarchy_links
-- ---------------------------------------------------------------------------

create table if not exists public.media_hierarchy_links (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media(id) on delete cascade,
  node_id uuid not null references public.hierarchy_nodes(id) on delete cascade,
  is_primary boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.media_hierarchy_links add column if not exists id uuid default gen_random_uuid();
alter table public.media_hierarchy_links add column if not exists media_id uuid references public.media(id) on delete cascade;
alter table public.media_hierarchy_links add column if not exists node_id uuid references public.hierarchy_nodes(id) on delete cascade;
alter table public.media_hierarchy_links add column if not exists is_primary boolean not null default true;
alter table public.media_hierarchy_links add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.media_hierarchy_links add column if not exists created_at timestamptz not null default now();

create unique index if not exists idx_media_hierarchy_links_primary_unique
  on public.media_hierarchy_links (media_id)
  where is_primary = true;

create index if not exists idx_media_hierarchy_links_node
  on public.media_hierarchy_links (node_id, created_at desc);

create or replace function public.media_hierarchy_links_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.hierarchy_nodes%rowtype;
begin
  select *
  into v_node
  from public.hierarchy_nodes
  where id = new.node_id;

  if not found then
    raise exception 'Hierarchy node % not found', new.node_id;
  end if;

  if v_node.is_active is distinct from true then
    raise exception 'Cannot assign media to archived hierarchy nodes';
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_media_hierarchy_links_validate on public.media_hierarchy_links;
create trigger trg_media_hierarchy_links_validate
before insert or update of node_id, media_id, is_primary
on public.media_hierarchy_links
for each row
execute function public.media_hierarchy_links_validate();

-- ---------------------------------------------------------------------------
-- field definitions / overrides / custom values
-- ---------------------------------------------------------------------------

create table if not exists public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  family text not null,
  field_key text not null,
  default_label text not null,
  description text,
  data_type text not null,
  storage_kind text not null,
  core_column_name text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  is_visible_default boolean not null default true,
  is_required_default boolean not null default false,
  is_filterable_default boolean not null default true,
  is_sortable_default boolean not null default true,
  is_grid_visible_default boolean not null default true,
  is_intake_visible_default boolean not null default true,
  is_detail_visible_default boolean not null default true,
  display_order_default integer not null default 100,
  options_json jsonb not null default '{}'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_definitions_family_check check (public.hierarchy_is_valid_family(family)),
  constraint field_definitions_storage_kind_check check (storage_kind in ('core_column', 'custom_value')),
  constraint field_definitions_data_type_check check (data_type in ('text', 'long_text', 'integer', 'number', 'boolean', 'date', 'timestamp', 'single_select', 'multi_select', 'json'))
);

alter table public.field_definitions add column if not exists id uuid default gen_random_uuid();
alter table public.field_definitions add column if not exists family text;
alter table public.field_definitions add column if not exists field_key text;
alter table public.field_definitions add column if not exists default_label text;
alter table public.field_definitions add column if not exists description text;
alter table public.field_definitions add column if not exists data_type text;
alter table public.field_definitions add column if not exists storage_kind text;
alter table public.field_definitions add column if not exists core_column_name text;
alter table public.field_definitions add column if not exists is_system boolean not null default false;
alter table public.field_definitions add column if not exists is_active boolean not null default true;
alter table public.field_definitions add column if not exists is_visible_default boolean not null default true;
alter table public.field_definitions add column if not exists is_required_default boolean not null default false;
alter table public.field_definitions add column if not exists is_filterable_default boolean not null default true;
alter table public.field_definitions add column if not exists is_sortable_default boolean not null default true;
alter table public.field_definitions add column if not exists is_grid_visible_default boolean not null default true;
alter table public.field_definitions add column if not exists is_intake_visible_default boolean not null default true;
alter table public.field_definitions add column if not exists is_detail_visible_default boolean not null default true;
alter table public.field_definitions add column if not exists display_order_default integer not null default 100;
alter table public.field_definitions add column if not exists options_json jsonb not null default '{}'::jsonb;
alter table public.field_definitions add column if not exists validation_json jsonb not null default '{}'::jsonb;
alter table public.field_definitions add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.field_definitions add column if not exists created_at timestamptz not null default now();
alter table public.field_definitions add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'field_definitions_family_check'
      and conrelid = 'public.field_definitions'::regclass
  ) then
    alter table public.field_definitions
      add constraint field_definitions_family_check check (public.hierarchy_is_valid_family(family));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'field_definitions_storage_kind_check'
      and conrelid = 'public.field_definitions'::regclass
  ) then
    alter table public.field_definitions
      add constraint field_definitions_storage_kind_check check (storage_kind in ('core_column', 'custom_value'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'field_definitions_data_type_check'
      and conrelid = 'public.field_definitions'::regclass
  ) then
    alter table public.field_definitions
      add constraint field_definitions_data_type_check check (data_type in ('text', 'long_text', 'integer', 'number', 'boolean', 'date', 'timestamp', 'single_select', 'multi_select', 'json'));
  end if;
end;
$$;

create unique index if not exists idx_field_definitions_family_key
  on public.field_definitions (family, lower(field_key));

create table if not exists public.hierarchy_field_overrides (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.hierarchy_nodes(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id) on delete cascade,
  override_label text,
  is_visible boolean,
  is_required boolean,
  is_filterable boolean,
  is_sortable boolean,
  is_grid_visible boolean,
  is_intake_visible boolean,
  is_detail_visible boolean,
  display_order integer,
  width_px integer,
  options_override_json jsonb,
  validation_override_json jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hierarchy_field_overrides add column if not exists id uuid default gen_random_uuid();
alter table public.hierarchy_field_overrides add column if not exists node_id uuid references public.hierarchy_nodes(id) on delete cascade;
alter table public.hierarchy_field_overrides add column if not exists field_definition_id uuid references public.field_definitions(id) on delete cascade;
alter table public.hierarchy_field_overrides add column if not exists override_label text;
alter table public.hierarchy_field_overrides add column if not exists is_visible boolean;
alter table public.hierarchy_field_overrides add column if not exists is_required boolean;
alter table public.hierarchy_field_overrides add column if not exists is_filterable boolean;
alter table public.hierarchy_field_overrides add column if not exists is_sortable boolean;
alter table public.hierarchy_field_overrides add column if not exists is_grid_visible boolean;
alter table public.hierarchy_field_overrides add column if not exists is_intake_visible boolean;
alter table public.hierarchy_field_overrides add column if not exists is_detail_visible boolean;
alter table public.hierarchy_field_overrides add column if not exists display_order integer;
alter table public.hierarchy_field_overrides add column if not exists width_px integer;
alter table public.hierarchy_field_overrides add column if not exists options_override_json jsonb;
alter table public.hierarchy_field_overrides add column if not exists validation_override_json jsonb;
alter table public.hierarchy_field_overrides add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.hierarchy_field_overrides add column if not exists created_at timestamptz not null default now();
alter table public.hierarchy_field_overrides add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_hierarchy_field_overrides_node_field
  on public.hierarchy_field_overrides (node_id, field_definition_id);

create table if not exists public.record_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  field_definition_id uuid not null references public.field_definitions(id) on delete cascade,
  sale_id uuid references public.properties_sale(id) on delete cascade,
  rent_id uuid references public.properties_rent(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  media_id uuid references public.media(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_date date,
  value_timestamp timestamptz,
  value_json jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_custom_field_values_exactly_one_target check (
    ((sale_id is not null)::integer +
     (rent_id is not null)::integer +
     (buyer_id is not null)::integer +
     (client_id is not null)::integer +
     (media_id is not null)::integer) = 1
  )
);

alter table public.record_custom_field_values add column if not exists id uuid default gen_random_uuid();
alter table public.record_custom_field_values add column if not exists field_definition_id uuid references public.field_definitions(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists sale_id uuid references public.properties_sale(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists rent_id uuid references public.properties_rent(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists buyer_id uuid references public.buyers(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists client_id uuid references public.clients(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists media_id uuid references public.media(id) on delete cascade;
alter table public.record_custom_field_values add column if not exists value_text text;
alter table public.record_custom_field_values add column if not exists value_number numeric;
alter table public.record_custom_field_values add column if not exists value_boolean boolean;
alter table public.record_custom_field_values add column if not exists value_date date;
alter table public.record_custom_field_values add column if not exists value_timestamp timestamptz;
alter table public.record_custom_field_values add column if not exists value_json jsonb;
alter table public.record_custom_field_values add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.record_custom_field_values add column if not exists created_at timestamptz not null default now();
alter table public.record_custom_field_values add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'record_custom_field_values_exactly_one_target'
      and conrelid = 'public.record_custom_field_values'::regclass
  ) then
    alter table public.record_custom_field_values
      add constraint record_custom_field_values_exactly_one_target check (
        ((sale_id is not null)::integer +
         (rent_id is not null)::integer +
         (buyer_id is not null)::integer +
         (client_id is not null)::integer +
         (media_id is not null)::integer) = 1
      );
  end if;
end;
$$;

create index if not exists idx_record_custom_field_values_field
  on public.record_custom_field_values (field_definition_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers for hierarchy-supporting tables
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hierarchy_nodes_updated_at on public.hierarchy_nodes;
create trigger trg_hierarchy_nodes_updated_at
before update on public.hierarchy_nodes
for each row execute function public.set_updated_at();

drop trigger if exists trg_field_definitions_updated_at on public.field_definitions;
create trigger trg_field_definitions_updated_at
before update on public.field_definitions
for each row execute function public.set_updated_at();

drop trigger if exists trg_hierarchy_field_overrides_updated_at on public.hierarchy_field_overrides;
create trigger trg_hierarchy_field_overrides_updated_at
before update on public.hierarchy_field_overrides
for each row execute function public.set_updated_at();

drop trigger if exists trg_record_custom_field_values_updated_at on public.record_custom_field_values;
create trigger trg_record_custom_field_values_updated_at
before update on public.record_custom_field_values
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hierarchy_nodes enable row level security;
alter table public.hierarchy_node_closure enable row level security;
alter table public.record_hierarchy_links enable row level security;
alter table public.media_hierarchy_links enable row level security;
alter table public.field_definitions enable row level security;
alter table public.hierarchy_field_overrides enable row level security;
alter table public.record_custom_field_values enable row level security;

-- hierarchy_nodes: view for authenticated roles, mutate for admins only.
drop policy if exists hierarchy_nodes_read_all on public.hierarchy_nodes;
create policy hierarchy_nodes_read_all
on public.hierarchy_nodes
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists hierarchy_nodes_insert_admin on public.hierarchy_nodes;
create policy hierarchy_nodes_insert_admin
on public.hierarchy_nodes
for insert
with check (
  public.current_app_role() = 'admin'
  and (
    created_by is null
    or created_by = auth.uid()
  )
);

drop policy if exists hierarchy_nodes_update_admin on public.hierarchy_nodes;
create policy hierarchy_nodes_update_admin
on public.hierarchy_nodes
for update
using (public.current_app_role() = 'admin')
with check (
  public.current_app_role() = 'admin'
  and (
    created_by is null
    or created_by = auth.uid()
    or auth.uid() is not null
  )
);

drop policy if exists hierarchy_nodes_delete_admin on public.hierarchy_nodes;
create policy hierarchy_nodes_delete_admin
on public.hierarchy_nodes
for delete
using (public.current_app_role() = 'admin');

-- closure table is queryable by authenticated roles; direct writes are blocked.
drop policy if exists hierarchy_node_closure_read_all on public.hierarchy_node_closure;
create policy hierarchy_node_closure_read_all
on public.hierarchy_node_closure
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

-- record_hierarchy_links: readable by all authenticated CRM roles, mutable by agent/admin.
drop policy if exists record_hierarchy_links_read_all on public.record_hierarchy_links;
create policy record_hierarchy_links_read_all
on public.record_hierarchy_links
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists record_hierarchy_links_insert_agent on public.record_hierarchy_links;
create policy record_hierarchy_links_insert_agent
on public.record_hierarchy_links
for insert
with check (
  public.current_app_role() in ('agent', 'admin')
  and (
    created_by is null
    or created_by = auth.uid()
  )
);

drop policy if exists record_hierarchy_links_update_agent on public.record_hierarchy_links;
create policy record_hierarchy_links_update_agent
on public.record_hierarchy_links
for update
using (public.current_app_role() in ('agent', 'admin'))
with check (public.current_app_role() in ('agent', 'admin'));

drop policy if exists record_hierarchy_links_delete_admin on public.record_hierarchy_links;
create policy record_hierarchy_links_delete_admin
on public.record_hierarchy_links
for delete
using (public.current_app_role() = 'admin');

-- media_hierarchy_links: readable by all authenticated CRM roles, mutable by agent/admin.
drop policy if exists media_hierarchy_links_read_all on public.media_hierarchy_links;
create policy media_hierarchy_links_read_all
on public.media_hierarchy_links
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists media_hierarchy_links_insert_agent on public.media_hierarchy_links;
create policy media_hierarchy_links_insert_agent
on public.media_hierarchy_links
for insert
with check (
  public.current_app_role() in ('agent', 'admin')
  and (
    created_by is null
    or created_by = auth.uid()
  )
);

drop policy if exists media_hierarchy_links_update_agent on public.media_hierarchy_links;
create policy media_hierarchy_links_update_agent
on public.media_hierarchy_links
for update
using (public.current_app_role() in ('agent', 'admin'))
with check (public.current_app_role() in ('agent', 'admin'));

drop policy if exists media_hierarchy_links_delete_admin on public.media_hierarchy_links;
create policy media_hierarchy_links_delete_admin
on public.media_hierarchy_links
for delete
using (public.current_app_role() = 'admin');

-- field definitions / overrides: visible broadly, writable by admins.
drop policy if exists field_definitions_read_all on public.field_definitions;
drop policy if exists field_definitions_admin_write on public.field_definitions;
drop policy if exists field_definitions_write_admin on public.field_definitions;
create policy field_definitions_read_all
on public.field_definitions
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists field_definitions_write_admin on public.field_definitions;
create policy field_definitions_write_admin
on public.field_definitions
for all
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists hierarchy_field_overrides_read_all on public.hierarchy_field_overrides;
drop policy if exists hierarchy_field_overrides_admin_write on public.hierarchy_field_overrides;
drop policy if exists hierarchy_field_overrides_write_admin on public.hierarchy_field_overrides;
create policy hierarchy_field_overrides_read_all
on public.hierarchy_field_overrides
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists hierarchy_field_overrides_write_admin on public.hierarchy_field_overrides;
create policy hierarchy_field_overrides_write_admin
on public.hierarchy_field_overrides
for all
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

-- custom field values: saved during normal confirm flows by agent/admin.
drop policy if exists record_custom_field_values_read_all on public.record_custom_field_values;
create policy record_custom_field_values_read_all
on public.record_custom_field_values
for select
using (public.current_app_role() in ('viewer', 'agent', 'admin'));

drop policy if exists record_custom_field_values_write_agent on public.record_custom_field_values;
create policy record_custom_field_values_write_agent
on public.record_custom_field_values
for all
using (public.current_app_role() in ('agent', 'admin'))
with check (public.current_app_role() in ('agent', 'admin'));

-- ---------------------------------------------------------------------------
-- Example query reference
-- ---------------------------------------------------------------------------

-- Example 1: fetch roots and immediate children for one family
-- select
--   root.id as root_id,
--   root.name as root_name,
--   child.id as child_id,
--   child.name as child_name,
--   child.node_kind,
--   child.can_have_children,
--   child.can_contain_records,
--   child.is_active,
--   child.sort_order
-- from public.hierarchy_nodes root
-- left join public.hierarchy_nodes child
--   on child.parent_id = root.id
-- where root.family = 'sale'
--   and root.is_root = true
-- order by child.sort_order, child.name;

-- Example 2: fetch active assignable record-container nodes for intake
-- select
--   n.id,
--   n.family,
--   n.name,
--   n.path_text,
--   n.node_kind
-- from public.hierarchy_nodes n
-- where n.family = 'sale'
--   and n.is_root = false
--   and n.is_active = true
--   and n.can_contain_records = true
-- order by n.depth, n.sort_order, n.name;

-- Example 3: fetch effective node details for one node
-- select
--   n.id,
--   n.family,
--   n.parent_id,
--   parent.name as parent_name,
--   n.node_kind,
--   n.node_key,
--   n.name,
--   n.path_text,
--   n.depth,
--   n.sort_order,
--   n.is_root,
--   n.can_have_children,
--   n.can_contain_records,
--   n.allow_record_assignment,
--   n.is_active,
--   n.archived_at,
--   n.metadata
-- from public.hierarchy_nodes n
-- left join public.hierarchy_nodes parent
--   on parent.id = n.parent_id
-- where n.id = :node_id;

-- ---------------------------------------------------------------------------
-- Rollback Notes
-- ---------------------------------------------------------------------------
--
-- Safe rollback strategy:
--   1. Revert application code to stop reading new node-behavior columns.
--   2. Drop RLS policies added here for hierarchy tables if they block a restore.
--   3. Restore the previous move_hierarchy_node function if one existed.
--   4. If necessary, keep tables but ignore new columns:
--        is_root, can_have_children, can_contain_records, archived_at
--      because allow_record_assignment remains populated for compatibility.
--   5. Do NOT drop hierarchy tables in production rollback unless data has been
--      exported or confirmed disposable, because links and metadata would be lost.

commit;
