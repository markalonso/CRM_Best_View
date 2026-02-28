-- CRM schema for AI-powered intake on Supabase Postgres
-- Notes:
-- 1) Uses auth.users for created_by references.
-- 2) Uses a shared sequence table + trigger for code generation like SALE-2026-001.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- ENUMS ----------
create type intake_status as enum ('draft', 'needs_review', 'confirmed');
create type furnished_status as enum ('furnished', 'semi_furnished', 'unfurnished', 'unknown');
create type client_role as enum ('owner', 'seller', 'landlord');
create type media_type as enum ('image', 'video', 'document', 'other');
create type record_type as enum ('properties_sale', 'properties_rent', 'buyers', 'clients');

do $$
begin
  if exists (select 1 from pg_type where typname = 'record_type') then
    alter type record_type add value if not exists 'intake_sessions';
    alter type record_type add value if not exists 'contacts';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('open', 'done', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_related_type') then
    create type task_related_type as enum ('sale', 'rent', 'buyer', 'client', 'contact');
  end if;
end $$;


do $$
begin
  if exists (select 1 from pg_type where typname = 'intake_status') then
    alter type intake_status add value if not exists 'needs_review';
  end if;
end $$;

-- ---------- HELPERS ----------
create table if not exists crm_code_sequences (
  code_key text not null,
  year_num int not null,
  last_value int not null default 0,
  primary key (code_key, year_num)
);

create or replace function next_crm_code(prefix text)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into crm_code_sequences (code_key, year_num, last_value)
  values (prefix, v_year, 1)
  on conflict (code_key, year_num)
  do update set last_value = crm_code_sequences.last_value + 1
  returning last_value into v_next;

  return prefix || '-' || v_year::text || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function assign_code_if_missing(prefix text)
returns trigger
language plpgsql
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code = next_crm_code(prefix);
  end if;
  return new;
end;
$$;

-- ---------- INTAKE ----------
create table if not exists intake_sessions (
  id uuid primary key default gen_random_uuid(),
  parent_session_id uuid references intake_sessions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  type_detected text not null default '',
  type_confirmed text not null default '',
  raw_text text not null,
  ai_json jsonb not null default '{}'::jsonb,
  ai_meta jsonb not null default '{}'::jsonb,
  completeness_score numeric(5,2) not null default 0,
  status intake_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_intake_sessions_updated_at
before update on intake_sessions
for each row execute function set_updated_at();

alter table intake_sessions add column if not exists ai_meta jsonb not null default '{}'::jsonb;
alter table intake_sessions add column if not exists final_record_type record_type;
alter table intake_sessions add column if not exists final_record_id uuid;
alter table intake_sessions add column if not exists parent_session_id uuid references intake_sessions(id) on delete set null;

-- ---------- CLIENTS ----------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_contacts_updated_at
before update on contacts
for each row execute function set_updated_at();

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  created_by uuid references auth.users(id) on delete set null,
  source text not null default '',
  completeness_score numeric(5,2) not null default 0,
  status text not null default 'active',

  name text not null default '',
  phone text not null default '',
  role client_role not null,
  area text not null default '',
  tags text[] not null default '{}',

  intake_session_id uuid references intake_sessions(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_clients_code
before insert on clients
for each row execute function assign_code_if_missing('CLIENT');

create trigger trg_clients_updated_at
before update on clients
for each row execute function set_updated_at();

-- ---------- SALE PROPERTIES ----------
create table if not exists properties_sale (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  created_by uuid references auth.users(id) on delete set null,
  source text not null default '',
  completeness_score numeric(5,2) not null default 0,
  status text not null default 'active',

  price numeric(14,2),
  currency text not null default 'EGP',
  size_sqm numeric(10,2),
  bedrooms int,
  bathrooms int,
  area text not null default '',
  compound text not null default '',
  floor int,
  furnished furnished_status not null default 'unknown',
  finishing text not null default '',
  payment_terms text not null default '',
  notes text not null default '',

  intake_session_id uuid references intake_sessions(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_properties_sale_code
before insert on properties_sale
for each row execute function assign_code_if_missing('SALE');

create trigger trg_properties_sale_updated_at
before update on properties_sale
for each row execute function set_updated_at();

-- ---------- RENT PROPERTIES ----------
create table if not exists properties_rent (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  created_by uuid references auth.users(id) on delete set null,
  source text not null default '',
  completeness_score numeric(5,2) not null default 0,
  status text not null default 'active',

  price numeric(14,2),
  currency text not null default 'EGP',
  size_sqm numeric(10,2),
  bedrooms int,
  bathrooms int,
  area text not null default '',
  compound text not null default '',
  floor int,
  furnished furnished_status not null default 'unknown',
  finishing text not null default '',
  payment_terms text not null default '',
  notes text not null default '',

  intake_session_id uuid references intake_sessions(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_properties_rent_code
before insert on properties_rent
for each row execute function assign_code_if_missing('RENT');

create trigger trg_properties_rent_updated_at
before update on properties_rent
for each row execute function set_updated_at();

-- ---------- BUYERS ----------
create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  created_by uuid references auth.users(id) on delete set null,
  source text not null default '',
  completeness_score numeric(5,2) not null default 0,
  status text not null default 'active',

  budget_min numeric(14,2),
  budget_max numeric(14,2),
  currency text not null default 'EGP',
  intent text not null default '',
  property_type text not null default '',
  phone text not null default '',
  preferred_areas text[] not null default '{}',
  bedrooms_needed int,
  timeline text not null default '',
  last_contact_at timestamptz,
  notes text not null default '',

  intake_session_id uuid references intake_sessions(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table properties_sale add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table properties_rent add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table buyers add column if not exists contact_id uuid references contacts(id) on delete set null;
alter table clients add column if not exists contact_id uuid references contacts(id) on delete set null;

create trigger trg_buyers_code
before insert on buyers
for each row execute function assign_code_if_missing('BUYER');

create trigger trg_buyers_updated_at
before update on buyers
for each row execute function set_updated_at();

-- ---------- MEDIA ----------
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  record_type record_type,
  record_id uuid,
  intake_session_id uuid references intake_sessions(id) on delete set null,
  linked_record_id uuid,
  linked_record_type record_type,
  file_url text not null,
  mime_type text not null default '',
  media_type media_type not null default 'other',
  type media_type not null default 'other',
  original_filename text not null default '',
  file_size bigint,
  dropbox_folder_link text,
  created_at timestamptz not null default now()
);

alter table media add column if not exists record_type record_type;
alter table media add column if not exists record_id uuid;
alter table media add column if not exists mime_type text not null default '';
alter table media add column if not exists media_type media_type not null default 'other';
alter table media add column if not exists original_filename text not null default '';
alter table media add column if not exists file_size bigint;
alter table media add column if not exists dropbox_folder_link text;

alter table clients add column if not exists status text not null default 'active';
alter table properties_sale add column if not exists status text not null default 'active';
alter table properties_rent add column if not exists status text not null default 'active';
alter table buyers add column if not exists status text not null default 'active';
alter table buyers add column if not exists currency text not null default 'EGP';
alter table buyers add column if not exists intent text not null default '';
alter table buyers add column if not exists property_type text not null default '';
alter table buyers add column if not exists phone text not null default '';
alter table buyers add column if not exists last_contact_at timestamptz;
alter table clients add column if not exists area text not null default '';
alter table clients add column if not exists tags text[] not null default '{}';

-- ---------- TIMELINE ----------
create table if not exists timeline (
  id uuid primary key default gen_random_uuid(),
  record_type record_type not null,
  record_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- TASKS ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  related_type task_related_type not null,
  related_id uuid not null,
  title text not null,
  due_date timestamptz,
  status task_status not null default 'open',
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- INDEXES ----------
create index if not exists idx_intake_sessions_created_by on intake_sessions(created_by);
create index if not exists idx_intake_sessions_status on intake_sessions(status);
create index if not exists idx_intake_sessions_parent on intake_sessions(parent_session_id);
create index if not exists idx_tasks_status_due on tasks(status, due_date);
create index if not exists idx_tasks_assigned_to on tasks(assigned_to, status, due_date);
create index if not exists idx_tasks_related on tasks(related_type, related_id, created_at desc);

create index if not exists idx_properties_sale_code on properties_sale(code);
create index if not exists idx_properties_rent_code on properties_rent(code);
create index if not exists idx_buyers_code on buyers(code);
create index if not exists idx_clients_code on clients(code);

create index if not exists idx_properties_sale_client on properties_sale(client_id);
create index if not exists idx_properties_sale_price on properties_sale(price);
create index if not exists idx_properties_rent_price on properties_rent(price);
create index if not exists idx_properties_sale_area on properties_sale(area);
create index if not exists idx_properties_rent_area on properties_rent(area);
create index if not exists idx_properties_sale_updated_at on properties_sale(updated_at desc);
create index if not exists idx_properties_rent_updated_at on properties_rent(updated_at desc);
create index if not exists idx_clients_phone on clients(phone);
create index if not exists idx_buyers_phone on buyers(phone);
create index if not exists idx_buyers_updated_at on buyers(updated_at desc);
create index if not exists idx_buyers_budget_min on buyers(budget_min);
create index if not exists idx_buyers_budget_max on buyers(budget_max);
create index if not exists idx_clients_updated_at on clients(updated_at desc);
create index if not exists idx_properties_sale_notes_tsv on properties_sale using gin (to_tsvector('simple', coalesce(area,'') || ' ' || coalesce(notes,'')));
create index if not exists idx_properties_rent_notes_tsv on properties_rent using gin (to_tsvector('simple', coalesce(area,'') || ' ' || coalesce(notes,'')));
create index if not exists idx_properties_rent_client on properties_rent(client_id);

create index if not exists idx_media_intake_session on media(intake_session_id);
create index if not exists idx_media_record_link on media(record_type, record_id);
create unique index if not exists idx_media_dedupe_intake on media(intake_session_id, original_filename, file_size) where intake_session_id is not null;

create index if not exists idx_timeline_record on timeline(record_type, record_id, created_at desc);

create index if not exists idx_intake_sessions_raw_text on intake_sessions using gin (to_tsvector('simple', raw_text));

create index if not exists idx_properties_sale_code_trgm on properties_sale using gin (code gin_trgm_ops);
create index if not exists idx_properties_rent_code_trgm on properties_rent using gin (code gin_trgm_ops);
create index if not exists idx_buyers_code_trgm on buyers using gin (code gin_trgm_ops);
create index if not exists idx_clients_code_trgm on clients using gin (code gin_trgm_ops);
create index if not exists idx_clients_name_trgm on clients using gin (name gin_trgm_ops);
create index if not exists idx_buyers_notes_trgm on buyers using gin (notes gin_trgm_ops);
create index if not exists idx_intake_raw_text_trgm on intake_sessions using gin (raw_text gin_trgm_ops);
create index if not exists idx_contacts_phone on contacts(phone);
create index if not exists idx_contacts_name_trgm on contacts using gin (name gin_trgm_ops);


-- ---------- ROLES & PROFILES ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('admin', 'agent', 'viewer');
  end if;
end $$;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role app_role not null default 'viewer',
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  record_type text not null,
  record_id uuid not null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  source text not null default 'app',
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_user_id on profiles(user_id);
create index if not exists idx_audit_logs_record on audit_logs(record_type, record_id, created_at desc);
create index if not exists idx_audit_logs_user on audit_logs(user_id, created_at desc);

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table intake_sessions enable row level security;
alter table properties_sale enable row level security;
alter table properties_rent enable row level security;
alter table buyers enable row level security;
alter table clients enable row level security;
alter table contacts enable row level security;
alter table media enable row level security;
alter table timeline enable row level security;
alter table audit_logs enable row level security;
alter table tasks enable row level security;

create or replace function current_app_role()
returns app_role
language sql
stable
as $$
  select coalesce((select role from profiles where user_id = auth.uid() limit 1), 'viewer'::app_role)
$$;

drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles for select using (user_id = auth.uid() or current_app_role() = 'admin');
drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for all using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

-- Generic CRUD by role: viewer read-only, agent read/write, admin full including delete.
drop policy if exists intake_read_all on intake_sessions;
create policy intake_read_all on intake_sessions for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists intake_insert_agent on intake_sessions;
create policy intake_insert_agent on intake_sessions for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists intake_update_agent on intake_sessions;
create policy intake_update_agent on intake_sessions for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists intake_delete_admin on intake_sessions;
create policy intake_delete_admin on intake_sessions for delete using (current_app_role() = 'admin');

-- Apply same pattern to core entities.

-- Entity policies
drop policy if exists sale_read_all on properties_sale;
create policy sale_read_all on properties_sale for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists sale_insert_agent on properties_sale;
create policy sale_insert_agent on properties_sale for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists sale_update_agent on properties_sale;
create policy sale_update_agent on properties_sale for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists sale_delete_admin on properties_sale;
create policy sale_delete_admin on properties_sale for delete using (current_app_role() = 'admin');

drop policy if exists rent_read_all on properties_rent;
create policy rent_read_all on properties_rent for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists rent_insert_agent on properties_rent;
create policy rent_insert_agent on properties_rent for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists rent_update_agent on properties_rent;
create policy rent_update_agent on properties_rent for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists rent_delete_admin on properties_rent;
create policy rent_delete_admin on properties_rent for delete using (current_app_role() = 'admin');

drop policy if exists buyers_read_all on buyers;
create policy buyers_read_all on buyers for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists buyers_insert_agent on buyers;
create policy buyers_insert_agent on buyers for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists buyers_update_agent on buyers;
create policy buyers_update_agent on buyers for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists buyers_delete_admin on buyers;
create policy buyers_delete_admin on buyers for delete using (current_app_role() = 'admin');

drop policy if exists clients_read_all on clients;
create policy clients_read_all on clients for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists clients_insert_agent on clients;
create policy clients_insert_agent on clients for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists clients_update_agent on clients;
create policy clients_update_agent on clients for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists clients_delete_admin on clients;
create policy clients_delete_admin on clients for delete using (current_app_role() = 'admin');

drop policy if exists contacts_read_all on contacts;
create policy contacts_read_all on contacts for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists contacts_insert_agent on contacts;
create policy contacts_insert_agent on contacts for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists contacts_update_agent on contacts;
create policy contacts_update_agent on contacts for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists contacts_delete_admin on contacts;
create policy contacts_delete_admin on contacts for delete using (current_app_role() = 'admin');

drop policy if exists media_read_all on media;
create policy media_read_all on media for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists media_insert_agent on media;
create policy media_insert_agent on media for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists media_update_agent on media;
create policy media_update_agent on media for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists media_delete_admin on media;
create policy media_delete_admin on media for delete using (current_app_role() = 'admin');

drop policy if exists timeline_read_all on timeline;
create policy timeline_read_all on timeline for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists timeline_write_agent on timeline;
create policy timeline_write_agent on timeline for insert with check (current_app_role() in ('agent','admin'));

drop policy if exists tasks_read_all on tasks;
create policy tasks_read_all on tasks for select using (current_app_role() in ('viewer','agent','admin'));
drop policy if exists tasks_insert_agent on tasks;
create policy tasks_insert_agent on tasks for insert with check (current_app_role() in ('agent','admin'));
drop policy if exists tasks_update_agent on tasks;
create policy tasks_update_agent on tasks for update using (current_app_role() in ('agent','admin')) with check (current_app_role() in ('agent','admin'));
drop policy if exists tasks_delete_admin on tasks;
create policy tasks_delete_admin on tasks for delete using (current_app_role() = 'admin');

drop policy if exists audit_read_all on audit_logs;
create policy audit_read_all on audit_logs for select using (current_app_role() in ('agent','admin'));
drop policy if exists audit_write_agent on audit_logs;
create policy audit_write_agent on audit_logs for insert with check (current_app_role() in ('agent','admin'));
