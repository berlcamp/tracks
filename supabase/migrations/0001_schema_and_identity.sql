-- 0001_schema_and_identity.sql
-- TRACKS — LGU Annual Investment Program tracking. Schema bootstrap, identity,
-- reference data (sectors, departments).
--
-- SHARED SUPABASE PROJECT. This project's Postgres also hosts other apps
-- (pta-collections, construction-saas, sms-demo, ...). Everything here lives in
-- `tracks`. Nothing is created in `public` and NOTHING is attached to auth.users.
-- See CLAUDE.md.

create schema if not exists tracks;

grant usage on schema tracks to anon, authenticated, service_role;

alter default privileges in schema tracks
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema tracks
  grant usage, select on sequences to authenticated;

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function tracks.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
--
-- The primary key is our own uuid, NOT auth.users.id. Another app on this shared
-- project deleting a user must not orphan the identity attached to a 2027
-- obligation. auth_user_id is nullable so (a) the bootstrap admin row can exist
-- before its first sign-in and (b) seed/test data needs no auth users at all.
-- ---------------------------------------------------------------------------

create table tracks.profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email        text not null unique,
  full_name    text not null,
  avatar_url   text,
  global_role  text not null default 'user'
                 check (global_role in ('super_admin', 'user')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email))
);

create index profiles_auth_user_id_idx on tracks.profiles (auth_user_id);

create trigger profiles_set_updated_at
  before update on tracks.profiles
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- lgu_settings
--
-- Single-row table. The AIP form prints "City: Bayugan" in its header and the
-- SUMMARY sheet carries a National Tax Allotment figure. Rather than a full
-- multi-tenant `lgus` table (not asked for), the LGU identity lives here.
-- ---------------------------------------------------------------------------

create table tracks.lgu_settings (
  id           boolean primary key default true check (id),
  lgu_name     text not null default 'Bayugan',
  lgu_type     text not null default 'City',
  province     text,
  region       text,
  logo_url     text,
  updated_at   timestamptz not null default now()
);

create trigger lgu_settings_set_updated_at
  before update on tracks.lgu_settings
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- sectors  (City Planning Office only — §"only the city planning office can
--           manage the sector settings")
--
-- One sector = one worksheet in the consolidated workbook. The same sector is
-- labelled three different ways in the source file, so all three are stored:
--   sheet_name     'PUBLIC SERVICES Sector'   -> the worksheet tab
--   heading        'GENERAL PUBLIC SECTOR'    -> the band row inside the sheet
--   summary_label  'GOVERNANCE SECTOR'        -> the group row on SUMMARY
-- ---------------------------------------------------------------------------

create table tracks.sectors (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code = upper(code)),
  name          text not null,
  sheet_name    text not null unique,
  heading       text not null,
  summary_label text not null,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index sectors_order_idx on tracks.sectors (sort_order) where active;

create trigger sectors_set_updated_at
  before update on tracks.sectors
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- departments
--
-- ASSUMPTION (verified against CY 2027 Consolidated v3): a department belongs to
-- exactly one sector. No department appears on two sector worksheets, which is
-- what makes the consolidated layout reproducible. If that ever stops being
-- true, sector_id moves onto the PPA and the export gains a split rule.
--
-- code_number is the "CODE NUMBER" column on the SUMMARY sheet (CMO = 1,
-- CVMO = 2, OCBO = 40 ...). It is not the sort order and it has gaps.
-- ---------------------------------------------------------------------------

create table tracks.departments (
  id           uuid primary key default gen_random_uuid(),
  sector_id    uuid not null references tracks.sectors(id) on delete restrict,
  code         text not null unique,          -- 'CMO'
  name         text not null,                 -- "City Mayor's Office"
  display_name text not null,                 -- "City Mayor's Office (CMO)"
  code_number  integer,                       -- SUMMARY sheet column B
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index departments_sector_idx on tracks.departments (sector_id, sort_order) where active;

create trigger departments_set_updated_at
  before update on tracks.departments
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership and invitations  (invite-first; no auth.users trigger)
--
-- One department per user. Department roles REQUIRE a department; city-wide
-- roles (planning, budget, accounting, viewer) must not carry one — the check
-- constraint enforces both directions so a "budget officer of CMO" is
-- impossible to create.
-- ---------------------------------------------------------------------------

create table tracks.user_roles (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null unique references tracks.profiles(id) on delete cascade,
  role          text not null check (role in (
                    'dept_encoder',    -- creates/edits PPAs, cannot submit
                    'dept_head',       -- submits the department AIP
                    'planning_staff',  -- reviews, returns items, consolidates
                    'planning_admin',  -- + sectors, departments, users, periods
                    'budget',          -- allotments and obligations
                    'accounting',      -- disbursements
                    'viewer'           -- read-only, city-wide
                  )),
  department_id uuid references tracks.departments(id) on delete restrict,
  status        text not null default 'active' check (status in ('active', 'inactive')),
  created_by    uuid references tracks.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint user_roles_department_matches_role check (
    (role in ('dept_encoder', 'dept_head') and department_id is not null)
    or
    (role in ('planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer')
       and department_id is null)
  )
);

create index user_roles_department_idx on tracks.user_roles (department_id, status);

create trigger user_roles_set_updated_at
  before update on tracks.user_roles
  for each row execute function tracks.set_updated_at();

create table tracks.invites (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text not null,
  role          text not null check (role in (
                    'dept_encoder', 'dept_head', 'planning_staff',
                    'planning_admin', 'budget', 'accounting', 'viewer')),
  department_id uuid references tracks.departments(id) on delete restrict,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at    timestamptz not null default (now() + interval '30 days'),
  invited_by    uuid references tracks.profiles(id),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint invites_email_lowercase check (email = lower(email)),
  constraint invites_department_matches_role check (
    (role in ('dept_encoder', 'dept_head') and department_id is not null)
    or
    (role in ('planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer')
       and department_id is null)
  )
);

-- Only one live invite per email; accepted/revoked ones may accumulate.
create unique index invites_pending_idx on tracks.invites (email) where status = 'pending';
create index invites_email_idx on tracks.invites (email, status);

create trigger invites_set_updated_at
  before update on tracks.invites
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs  (append-only; no update or delete policy is ever written)
-- ---------------------------------------------------------------------------

create table tracks.audit_logs (
  id          bigserial primary key,
  profile_id  uuid references tracks.profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  old_values  jsonb,
  new_values  jsonb,
  note        text,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity_idx on tracks.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_profile_idx on tracks.audit_logs (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Identity resolution + the audit writer.
--
-- current_profile_id() lives here rather than with the authorization helpers in
-- 0005 because the revision trigger in 0003 depends on it, and because it is
-- identity, not authorization. SECURITY DEFINER so a policy ON profiles can call
-- it without recursing into profiles' own RLS.
-- ---------------------------------------------------------------------------

create or replace function tracks.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = tracks, public
as $$
  select id from tracks.profiles where auth_user_id = auth.uid() and active;
$$;

create or replace function tracks.write_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old_values  jsonb default null,
  p_new_values  jsonb default null,
  p_note        text default null
)
returns bigint
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_id bigint;
begin
  insert into tracks.audit_logs (
    profile_id, action, entity_type, entity_id, old_values, new_values, note
  ) values (
    tracks.current_profile_id(), p_action, p_entity_type, p_entity_id,
    p_old_values, p_new_values, p_note
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function tracks.current_profile_id() from public;
revoke execute on function tracks.write_audit(text, text, uuid, jsonb, jsonb, text) from public;
grant execute on function tracks.current_profile_id() to authenticated;
