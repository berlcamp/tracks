-- ===========================================================================
-- TRACKS — full schema bundle for the SHARED Supabase project.
--
-- GENERATED FILE. Do not edit. Rebuild with: npm run deploy:bundle
-- Source: supabase/migrations/0001..0010, concatenated in order.
--
-- HOW TO APPLY
--   1. Supabase Dashboard -> SQL Editor -> New query.
--   2. Paste this whole file and Run. It is one transaction: if any statement
--      fails, nothing is applied and the other apps on this project are
--      untouched.
--   3. Settings -> API -> Exposed schemas: add `tracks`. Without this,
--      PostgREST returns 404 for every table and the app looks broken.
--
-- DO NOT run `supabase db push`, `db reset` or `db diff` against this project.
-- They operate on the whole database and will propose dropping the objects
-- belonging to the other apps that share it.
--
-- This bundle creates nothing in `public` and attaches nothing to auth.users.
-- The only object it touches outside `tracks` is storage.objects, and every
-- policy there is scoped `bucket_id = 'tracks-documents'`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0001_schema_and_identity.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 0002_aip_core.sql
-- ---------------------------------------------------------------------------

-- 0002_aip_core.sql
-- The AIP itself: periods, department submissions, the column-C group tree,
-- PPA rows, per-item returns, and the field-level revision history.
--
-- All money is numeric(16,2). Never float. Values are stored in PESOS, not
-- thousands — the source workbook's "(In Thousand Pesos)" header is wrong and
-- the exporter prints the corrected caption.

-- ---------------------------------------------------------------------------
-- aip_periods  — one row per calendar year (CY 2027).
--
-- status tracks the paper leg. City Planning stamps `ldc` / `mayor` / `council`
-- as the printed copies come back; the system never claims to know what happens
-- while the folder is out of the office. Details land in tracks.aip_actions.
-- ---------------------------------------------------------------------------

create table tracks.aip_periods (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null unique check (year between 2000 and 2100),
  title       text not null,                    -- 'CY 2027 Annual Investment Program'
  draft_label text,                             -- '1st DRAFT' — printed on the export
  nta_amount  numeric(16,2) check (nta_amount is null or nta_amount >= 0),
  status      text not null default 'open' check (status in (
                'open',          -- departments encoding and submitting
                'consolidating', -- Planning reviewing/consolidating
                'for_ldc',
                'for_mayor',
                'for_council',
                'approved',      -- resolution returned and encoded
                'closed'         -- no further edits
              )),
  created_by  uuid references tracks.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger aip_periods_set_updated_at
  before update on tracks.aip_periods
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- aips  — one department's submission for one period.
--
-- One 'annual' per (period, department), plus any number of 'supplemental'
-- submissions numbered SP-1, SP-2 ... A supplemental carries only new or
-- changed PPAs; it is a separate submission that runs the same review loop.
--
-- status:
--   draft      department is encoding
--   submitted  department head submitted; the WHOLE submission is locked
--   returned   Planning returned >= 1 item. Still locked — only the items with
--              an open return are editable. This is the explicit rule: three
--              returned items out of two hundred do not unlock the other 197.
--   accepted   Planning accepted it into the consolidated AIP
-- ---------------------------------------------------------------------------

create table tracks.aips (
  id              uuid primary key default gen_random_uuid(),
  period_id       uuid not null references tracks.aip_periods(id) on delete restrict,
  department_id   uuid not null references tracks.departments(id) on delete restrict,
  kind            text not null default 'annual' check (kind in ('annual', 'supplemental')),
  supplemental_no integer check (supplemental_no is null or supplemental_no >= 1),
  status          text not null default 'draft'
                    check (status in ('draft', 'submitted', 'returned', 'accepted')),
  submitted_at    timestamptz,
  submitted_by    uuid references tracks.profiles(id),
  accepted_at     timestamptz,
  accepted_by     uuid references tracks.profiles(id),
  created_by      uuid references tracks.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint aips_supplemental_no_matches_kind check (
    (kind = 'annual' and supplemental_no is null)
    or (kind = 'supplemental' and supplemental_no is not null)
  ),
  -- Composite target so PPAs and groups can be tied to (aip, department) at the
  -- FK level rather than trusting application code.
  unique (id, department_id)
);

create unique index aips_one_annual_idx
  on tracks.aips (period_id, department_id)
  where kind = 'annual';

create unique index aips_supplemental_no_idx
  on tracks.aips (period_id, department_id, supplemental_no)
  where kind = 'supplemental';

create index aips_period_status_idx on tracks.aips (period_id, status);
create index aips_department_idx on tracks.aips (department_id, period_id);

create trigger aips_set_updated_at
  before update on tracks.aips
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- ppa_groups  — the group rows that live in column C of the worksheet.
--
-- The source workbook nests these 1 to 3 deep and the depth is NOT recoverable
-- from formatting (row 334 of PUBLIC SERVICES is a group row that is not even
-- bold):
--
--   SUPPORT TO NATIONAL AGENCIES                     depth 1
--     Department of Interior and Local Government    depth 2
--       General and Administrative Operation         depth 3
--         <PPA rows>
--   PEACE AND ORDER PROGRAM (POP)                    depth 1
--     General and Administrative Operation           depth 2
--         <PPA rows>
--   General and Administrative Operation             depth 1
--         <PPA rows>
--
-- So this is a real tree, not two fixed levels. depth is maintained by trigger
-- and capped, and the composite FK keeps a child in the same AIP as its parent.
-- ---------------------------------------------------------------------------

create table tracks.ppa_groups (
  id         uuid primary key default gen_random_uuid(),
  aip_id     uuid not null references tracks.aips(id) on delete cascade,
  parent_id  uuid,
  name       text not null check (length(trim(name)) > 0),
  depth      integer not null default 1 check (depth between 1 and 4),
  sort_order integer not null default 0,
  created_by uuid references tracks.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, aip_id),
  foreign key (parent_id, aip_id)
    references tracks.ppa_groups (id, aip_id) on delete cascade
);

create index ppa_groups_aip_idx on tracks.ppa_groups (aip_id, sort_order);
create index ppa_groups_parent_idx on tracks.ppa_groups (parent_id);

create trigger ppa_groups_set_updated_at
  before update on tracks.ppa_groups
  for each row execute function tracks.set_updated_at();

-- depth is derived, never supplied. The walk up the ancestors also rejects the
-- cycle you would otherwise create by re-parenting a node under its own child.
create or replace function tracks.ppa_groups_set_depth()
returns trigger
language plpgsql
as $$
declare
  v_parent  uuid := new.parent_id;
  v_depth   integer := 1;
  v_guard   integer := 0;
begin
  while v_parent is not null loop
    v_guard := v_guard + 1;
    if v_parent = new.id or v_guard > 8 then
      raise exception 'Group nesting would create a cycle.' using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    select parent_id into v_parent from tracks.ppa_groups where id = v_parent;
  end loop;
  new.depth := v_depth;
  return new;
end;
$$;

create trigger ppa_groups_depth
  before insert or update of parent_id on tracks.ppa_groups
  for each row execute function tracks.ppa_groups_set_depth();

-- ---------------------------------------------------------------------------
-- ppas  — one worksheet row.
--
-- There is deliberately NO stored item_no. Column (2) of the form is a running
-- number per department and must auto-renumber when a row is inserted or
-- deleted; storing it means a renumber write across every sibling row and a
-- unique-constraint dance on every insert. It is computed from sort_order in
-- tracks.v_ppa_rows instead, which auto-renumbers by construction.
--
-- ref_code is free text (the office reuses last year's codes and their padding
-- is inconsistent: -0010, -010, -084 all appear). It is NOT derived from the
-- item number, so the two can and will drift — that is the accepted behaviour.
--
-- Climate-change columns (13)(14)(15) exist because the export must reproduce
-- the official form exactly. Every sampled row in the source file leaves them
-- blank; they are nullable and print blank until told otherwise.
-- ---------------------------------------------------------------------------

create table tracks.ppas (
  id                 uuid primary key default gen_random_uuid(),
  aip_id             uuid not null,
  department_id      uuid not null references tracks.departments(id) on delete restrict,
  group_id           uuid,
  ref_code           text,                                  -- col (1), free text
  description        text not null check (length(trim(description)) > 0),  -- col (2)
  implementing_office text,                                 -- col (3), one office
  start_date         date,                                  -- col (4)
  end_date           date,                                  -- col (5)
  expected_output    text,                                  -- col (6)
  funding_source     text,                                  -- col (7), free text
  amount_ps          numeric(16,2) not null default 0 check (amount_ps   >= 0),  -- (8)
  amount_mooe        numeric(16,2) not null default 0 check (amount_mooe >= 0),  -- (9)
  amount_fe          numeric(16,2) not null default 0 check (amount_fe   >= 0),  -- (10)
  amount_co          numeric(16,2) not null default 0 check (amount_co   >= 0),  -- (11)
  amount_total       numeric(16,2) generated always as                            -- (12)
                       (amount_ps + amount_mooe + amount_fe + amount_co) stored,
  cca_amount         numeric(16,2) check (cca_amount is null or cca_amount >= 0), -- (13)
  ccm_amount         numeric(16,2) check (ccm_amount is null or ccm_amount >= 0), -- (14)
  cc_typology_code   text,                                                        -- (15)
  -- A multi-year project keeps its identity across periods: the CY 2028 row
  -- points back at the CY 2027 row so monitoring can follow it.
  continues_ppa_id   uuid references tracks.ppas(id) on delete set null,
  sort_order         integer not null default 0,
  created_by         uuid references tracks.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ppas_schedule_order check (
    start_date is null or end_date is null or end_date >= start_date),
  constraint ppas_amount_positive check (
    amount_ps + amount_mooe + amount_fe + amount_co > 0),
  -- department_id is denormalized off the AIP so every RLS policy and report
  -- filters on the row itself. The composite FK makes it impossible to desync.
  foreign key (aip_id, department_id)
    references tracks.aips (id, department_id) on delete cascade,
  foreign key (group_id, aip_id)
    references tracks.ppa_groups (id, aip_id) on delete set null,
  unique (id, aip_id)
);

create index ppas_aip_order_idx on tracks.ppas (aip_id, sort_order);
create index ppas_department_idx on tracks.ppas (department_id);
create index ppas_group_idx on tracks.ppas (group_id);
create index ppas_continues_idx on tracks.ppas (continues_ppa_id) where continues_ppa_id is not null;
create index ppas_description_trgm_idx on tracks.ppas using gin (description gin_trgm_ops);

create trigger ppas_set_updated_at
  before update on tracks.ppas
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- ppa_returns  — City Planning sending ONE item back to a department.
--
-- One open return per PPA. `resolved_at` is stamped when the department
-- resubmits; the row itself is never deleted, so the correction conversation
-- survives as history.
-- ---------------------------------------------------------------------------

create table tracks.ppa_returns (
  id          uuid primary key default gen_random_uuid(),
  ppa_id      uuid not null references tracks.ppas(id) on delete cascade,
  reason      text not null check (length(trim(reason)) > 0),
  returned_by uuid references tracks.profiles(id),
  returned_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references tracks.profiles(id),
  resolution_note text
);

create unique index ppa_returns_one_open_idx
  on tracks.ppa_returns (ppa_id) where resolved_at is null;

create index ppa_returns_ppa_idx on tracks.ppa_returns (ppa_id, returned_at desc);

-- ---------------------------------------------------------------------------
-- ppa_revisions  — field-level history with the ORIGINAL value preserved.
--
-- Written by trigger, unlike the intent-carrying audit_logs entries. The
-- distinction is deliberate: audit_logs records "why" (a human action with a
-- reason), ppa_revisions records "what changed" mechanically, so a City Planning
-- overwrite of a department's figure can never happen off the record — even
-- through a route nobody remembered to instrument.
-- ---------------------------------------------------------------------------

create table tracks.ppa_revisions (
  id             bigserial primary key,
  ppa_id         uuid not null,
  aip_id         uuid not null,
  action         text not null check (action in ('create', 'update', 'delete')),
  changed_fields text[] not null default '{}',
  old_values     jsonb,
  new_values     jsonb,
  changed_by     uuid references tracks.profiles(id),
  changed_at     timestamptz not null default now()
);

create index ppa_revisions_ppa_idx on tracks.ppa_revisions (ppa_id, changed_at desc);
create index ppa_revisions_aip_idx on tracks.ppa_revisions (aip_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- 0003_execution.sql
-- ---------------------------------------------------------------------------

-- 0003_execution.sql
-- What happens to a PPA after the resolution: the paper trail, budget
-- allotments, obligations, disbursements and physical progress.
--
-- Obligations and disbursements are TRANSACTIONS, not periodic snapshots — one
-- row per OBR and one row per DV. Utilization is therefore always derivable at
-- any as-of date without a rebuild.

-- ---------------------------------------------------------------------------
-- ppa_revisions trigger
--
-- Placed here (not in 0002) because it depends on tracks.current_profile_id().
-- Generated columns are excluded from the diff: amount_total is a function of
-- the four component columns and would double-report every amount change.
-- ---------------------------------------------------------------------------

create or replace function tracks.ppas_record_revision()
returns trigger
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_key     text;
begin
  if tg_op = 'INSERT' then
    insert into tracks.ppa_revisions (ppa_id, aip_id, action, new_values, changed_by)
    values (new.id, new.aip_id, 'create', to_jsonb(new) - 'amount_total', tracks.current_profile_id());
    return new;
  elsif tg_op = 'DELETE' then
    insert into tracks.ppa_revisions (ppa_id, aip_id, action, old_values, changed_by)
    values (old.id, old.aip_id, 'delete', to_jsonb(old) - 'amount_total', tracks.current_profile_id());
    return old;
  end if;

  v_old := to_jsonb(old) - 'amount_total' - 'updated_at';
  v_new := to_jsonb(new) - 'amount_total' - 'updated_at';
  v_changed := '{}';

  for v_key in select jsonb_object_keys(v_new) loop
    if v_old -> v_key is distinct from v_new -> v_key then
      v_changed := v_changed || v_key;
    end if;
  end loop;

  if array_length(v_changed, 1) is null then
    return new;   -- a no-op update writes no history
  end if;

  insert into tracks.ppa_revisions (
    ppa_id, aip_id, action, changed_fields, old_values, new_values, changed_by
  ) values (
    new.id, new.aip_id, 'update', v_changed,
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_changed) k),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_changed) k),
    tracks.current_profile_id()
  );
  return new;
end;
$$;

create trigger ppas_record_revision
  after insert or update or delete on tracks.ppas
  for each row execute function tracks.ppas_record_revision();

-- ---------------------------------------------------------------------------
-- aip_actions  — the paper leg (LDC -> Mayor -> City Council).
--
-- The folder leaves the building and the system learns nothing until it comes
-- back. City Planning encodes what the returned paper says: which body acted,
-- when, under what resolution number, and the scan.
-- ---------------------------------------------------------------------------

create table tracks.aip_actions (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references tracks.aip_periods(id) on delete cascade,
  aip_id       uuid references tracks.aips(id) on delete cascade,  -- set for a supplemental
  stage        text not null check (stage in ('ldc', 'mayor', 'council')),
  action       text not null default 'approved'
                 check (action in ('endorsed', 'approved', 'approved_with_changes', 'returned')),
  action_date  date,
  reference_no text,                       -- resolution / ordinance number
  remarks      text,
  document_url text,                       -- scanned resolution in Storage
  recorded_by  uuid references tracks.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index aip_actions_period_idx on tracks.aip_actions (period_id, stage);

create trigger aip_actions_set_updated_at
  before update on tracks.aip_actions
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- allotments  — Budget Office recording releases against Planning's approved
-- figures. Multiple rows per PPA: a release is rarely the full year in one go.
--
-- Utilization is measured against the SUM of these, not against the PPA's
-- approved amount. The two are shown side by side in every report precisely
-- because they differ.
-- ---------------------------------------------------------------------------

create table tracks.allotments (
  id             uuid primary key default gen_random_uuid(),
  ppa_id         uuid not null references tracks.ppas(id) on delete restrict,
  amount         numeric(16,2) not null check (amount > 0),
  allotment_date date not null,
  reference_no   text,
  remarks        text,
  recorded_by    uuid references tracks.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index allotments_ppa_idx on tracks.allotments (ppa_id, allotment_date);

create trigger allotments_set_updated_at
  before update on tracks.allotments
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- obligations  — Budget Office. One row per Obligation Request (OBR).
-- ---------------------------------------------------------------------------

create table tracks.obligations (
  id               uuid primary key default gen_random_uuid(),
  ppa_id           uuid not null references tracks.ppas(id) on delete restrict,
  obr_no           text,
  obligation_date  date not null,
  payee            text,
  particulars      text,
  amount           numeric(16,2) not null check (amount > 0),
  status           text not null default 'active'
                     check (status in ('active', 'cancelled')),
  cancel_reason    text,
  recorded_by      uuid references tracks.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint obligations_cancel_reason_required
    check (status = 'active' or (cancel_reason is not null and length(trim(cancel_reason)) > 0)),
  -- Lets a disbursement's obligation_id and ppa_id be tied together by the FK
  -- below rather than by application code.
  unique (id, ppa_id)
);

create index obligations_ppa_idx on tracks.obligations (ppa_id, obligation_date);
create index obligations_obr_idx on tracks.obligations (obr_no) where obr_no is not null;

create trigger obligations_set_updated_at
  before update on tracks.obligations
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- disbursements  — Accounting. One row per Disbursement Voucher (DV).
--
-- obligation_id is NULLABLE: Accounting can record a payment against the PPA
-- alone when the OBR is not to hand. When it IS set, the composite FK guarantees
-- the obligation belongs to the same PPA — you cannot pay CMO's OBR out of
-- CSWDO's project. Rows with a null obligation_id are what the
-- "unliquidated obligations" report has to except.
-- ---------------------------------------------------------------------------

create table tracks.disbursements (
  id                uuid primary key default gen_random_uuid(),
  ppa_id            uuid not null,
  obligation_id     uuid,
  dv_no             text,
  check_ada_no      text,
  disbursement_date date not null,
  payee             text,
  particulars       text,
  amount            numeric(16,2) not null check (amount > 0),
  status            text not null default 'active'
                      check (status in ('active', 'cancelled')),
  cancel_reason     text,
  recorded_by       uuid references tracks.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint disbursements_cancel_reason_required
    check (status = 'active' or (cancel_reason is not null and length(trim(cancel_reason)) > 0)),
  foreign key (ppa_id) references tracks.ppas(id) on delete restrict,
  foreign key (obligation_id, ppa_id)
    references tracks.obligations (id, ppa_id) on delete restrict
);

create index disbursements_ppa_idx on tracks.disbursements (ppa_id, disbursement_date);
create index disbursements_obligation_idx on tracks.disbursements (obligation_id);

create trigger disbursements_set_updated_at
  before update on tracks.disbursements
  for each row execute function tracks.set_updated_at();

-- A cancelled obligation must not keep live disbursements hanging off it, and
-- the paid total must never exceed what was obligated. Both are checked here
-- rather than in TypeScript because both are money rules.
create or replace function tracks.disbursements_check_obligation()
returns trigger
language plpgsql
as $$
declare
  v_obligated numeric(16,2);
  v_status    text;
  v_paid      numeric(16,2);
begin
  if new.obligation_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select amount, status into v_obligated, v_status
  from tracks.obligations where id = new.obligation_id;

  if v_status = 'cancelled' then
    raise exception 'Cannot record a disbursement against a cancelled obligation.'
      using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from tracks.disbursements
  where obligation_id = new.obligation_id
    and status = 'active'
    and id <> new.id;

  if v_paid + new.amount > v_obligated then
    raise exception 'Disbursements (%) would exceed the obligated amount (%).',
      v_paid + new.amount, v_obligated using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger disbursements_check_obligation
  before insert or update on tracks.disbursements
  for each row execute function tracks.disbursements_check_obligation();

-- ---------------------------------------------------------------------------
-- ppa_progress  — manually entered physical accomplishment, as-of a date.
-- Snapshots, not transactions: "40% as of 31 March".
-- ---------------------------------------------------------------------------

create table tracks.ppa_progress (
  id               uuid primary key default gen_random_uuid(),
  ppa_id           uuid not null references tracks.ppas(id) on delete cascade,
  as_of_date       date not null,
  percent_complete numeric(5,2) not null check (percent_complete between 0 and 100),
  remarks          text,
  recorded_by      uuid references tracks.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (ppa_id, as_of_date)
);

create index ppa_progress_ppa_idx on tracks.ppa_progress (ppa_id, as_of_date desc);

create trigger ppa_progress_set_updated_at
  before update on tracks.ppa_progress
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- 0004_views.sql
-- ---------------------------------------------------------------------------

-- 0004_views.sql
-- Reporting views. These are the ONLY place a total is computed. Nothing in
-- TypeScript re-adds a column of pesos, and the exporter reads these — the
-- printed workbook and the on-screen grid cannot disagree.
--
-- security_invoker so the caller's RLS applies to the underlying tables.
-- Without it a view owned by a privileged role would hand a department every
-- other department's figures.

-- ---------------------------------------------------------------------------
-- v_ppa_group_paths — the column-C ancestry of every group, as text and as an
-- ordered array. Used to render the nested group rows above a PPA and to sort
-- an entire AIP in worksheet order in one query.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_group_paths
with (security_invoker = true) as
with recursive walk as (
  select
    g.id,
    g.aip_id,
    g.parent_id,
    g.name,
    g.depth,
    g.sort_order,
    array[g.sort_order, 0, 0, 0]              as sort_path,
    array[g.name]                             as name_path
  from tracks.ppa_groups g
  where g.parent_id is null

  union all

  select
    c.id,
    c.aip_id,
    c.parent_id,
    c.name,
    c.depth,
    c.sort_order,
    w.sort_path[1:c.depth - 1] || c.sort_order || array_fill(0, array[4 - c.depth]),
    w.name_path || c.name
  from tracks.ppa_groups c
  join walk w on w.id = c.parent_id
)
select
  id,
  aip_id,
  parent_id,
  name,
  depth,
  sort_order,
  sort_path,
  name_path,
  array_to_string(name_path, ' › ') as path_label
from walk;

-- ---------------------------------------------------------------------------
-- v_ppa_rows — one worksheet row, ready to render or export.
--
-- item_no is computed here, never stored: column (2) of the AIP form is a
-- running number per department that must renumber itself when a row is
-- inserted or removed. row_number() over the worksheet ordering IS that number.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_rows
with (security_invoker = true) as
select
  p.id,
  p.aip_id,
  a.period_id,
  per.year                      as period_year,
  a.kind                        as aip_kind,
  a.supplemental_no,
  a.status                      as aip_status,
  p.department_id,
  d.code                        as department_code,
  d.display_name                as department_name,
  d.sort_order                  as department_sort,
  s.id                          as sector_id,
  s.code                        as sector_code,
  s.heading                     as sector_heading,
  s.sheet_name                  as sector_sheet_name,
  s.sort_order                  as sector_sort,
  p.group_id,
  gp.name_path                  as group_path,
  gp.path_label                 as group_path_label,
  row_number() over (
    partition by p.aip_id
    order by coalesce(gp.sort_path, array[0,0,0,0]), p.sort_order, p.created_at
  )                             as item_no,
  p.ref_code,
  p.description,
  p.implementing_office,
  p.start_date,
  p.end_date,
  p.expected_output,
  p.funding_source,
  p.amount_ps,
  p.amount_mooe,
  p.amount_fe,
  p.amount_co,
  p.amount_total,
  p.cca_amount,
  p.ccm_amount,
  p.cc_typology_code,
  p.continues_ppa_id,
  p.sort_order,
  coalesce(gp.sort_path, array[0,0,0,0]) as group_sort_path,
  r.id                          as open_return_id,
  r.reason                      as open_return_reason,
  r.returned_at                 as open_return_at,
  (r.id is not null)            as is_returned,
  p.created_at,
  p.updated_at
from tracks.ppas p
join tracks.aips a         on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d  on d.id = p.department_id
join tracks.sectors s      on s.id = d.sector_id
left join tracks.v_ppa_group_paths gp on gp.id = p.group_id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null;

-- ---------------------------------------------------------------------------
-- v_ppa_financials — allotment / obligation / disbursement rollup per PPA.
--
-- Utilization is measured against the ALLOTMENT (what Budget actually released),
-- not the approved amount. Both are carried so a report can show the gap.
-- Cancelled obligations and disbursements are excluded from every sum.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_financials
with (security_invoker = true) as
select
  p.id                              as ppa_id,
  p.aip_id,
  p.department_id,
  p.description,
  p.amount_total                    as approved_amount,
  coalesce(al.total, 0)             as allotted,
  coalesce(ob.total, 0)             as obligated,
  coalesce(di.total, 0)             as disbursed,
  coalesce(al.total, 0) - coalesce(ob.total, 0)  as unobligated_balance,
  coalesce(ob.total, 0) - coalesce(di.total, 0)  as unpaid_obligations,
  case when coalesce(al.total, 0) > 0
       then round(coalesce(ob.total, 0) / al.total * 100, 2) end as obligation_rate,
  case when coalesce(al.total, 0) > 0
       then round(coalesce(di.total, 0) / al.total * 100, 2) end as disbursement_rate,
  pr.percent_complete               as physical_percent,
  pr.as_of_date                     as physical_as_of
from tracks.ppas p
left join lateral (
  select sum(amount) as total from tracks.allotments where ppa_id = p.id
) al on true
left join lateral (
  select sum(amount) as total from tracks.obligations
  where ppa_id = p.id and status = 'active'
) ob on true
left join lateral (
  select sum(amount) as total from tracks.disbursements
  where ppa_id = p.id and status = 'active'
) di on true
left join lateral (
  select percent_complete, as_of_date from tracks.ppa_progress
  where ppa_id = p.id order by as_of_date desc limit 1
) pr on true;

-- ---------------------------------------------------------------------------
-- v_aip_totals — the department subtotal row ("City Mayor's Office (CMO) TOTAL")
-- ---------------------------------------------------------------------------

create or replace view tracks.v_aip_totals
with (security_invoker = true) as
select
  a.id            as aip_id,
  a.period_id,
  a.department_id,
  a.kind,
  a.supplemental_no,
  a.status,
  d.code          as department_code,
  d.display_name  as department_name,
  d.code_number,
  d.sort_order    as department_sort,
  s.id            as sector_id,
  s.code          as sector_code,
  s.summary_label as sector_summary_label,
  s.sort_order    as sector_sort,
  count(p.id)                       as ppa_count,
  coalesce(sum(p.amount_ps),   0)   as total_ps,
  coalesce(sum(p.amount_mooe), 0)   as total_mooe,
  coalesce(sum(p.amount_fe),   0)   as total_fe,
  coalesce(sum(p.amount_co),   0)   as total_co,
  coalesce(sum(p.amount_total),0)   as total_amount
from tracks.aips a
join tracks.departments d on d.id = a.department_id
join tracks.sectors s     on s.id = d.sector_id
left join tracks.ppas p   on p.aip_id = a.id
group by a.id, a.period_id, a.department_id, a.kind, a.supplemental_no, a.status,
         d.code, d.display_name, d.code_number, d.sort_order,
         s.id, s.code, s.summary_label, s.sort_order;

-- ---------------------------------------------------------------------------
-- v_sector_totals — the sector band row ("GENERAL PUBLIC SECTOR - TOTAL") and
-- the SUB-TOTAL rows on SUMMARY.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_sector_totals
with (security_invoker = true) as
select
  t.period_id,
  t.sector_id,
  t.sector_code,
  t.sector_summary_label,
  t.sector_sort,
  t.kind,
  count(*) filter (where t.ppa_count > 0) as department_count,
  sum(t.total_ps)     as total_ps,
  sum(t.total_mooe)   as total_mooe,
  sum(t.total_fe)     as total_fe,
  sum(t.total_co)     as total_co,
  sum(t.total_amount) as total_amount
from tracks.v_aip_totals t
group by t.period_id, t.sector_id, t.sector_code, t.sector_summary_label,
         t.sector_sort, t.kind;

-- ---------------------------------------------------------------------------
-- v_period_totals — the GRAND TOTAL line.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_period_totals
with (security_invoker = true) as
select
  period_id,
  kind,
  sum(total_ps)     as total_ps,
  sum(total_mooe)   as total_mooe,
  sum(total_fe)     as total_fe,
  sum(total_co)     as total_co,
  sum(total_amount) as total_amount
from tracks.v_sector_totals
group by period_id, kind;

-- ---------------------------------------------------------------------------
-- v_monitoring — the report grid: every PPA with its physical and financial
-- accomplishment, laid out in the same order as the AIP form itself.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_monitoring
with (security_invoker = true) as
select
  r.id                as ppa_id,
  r.period_id,
  r.period_year,
  r.aip_id,
  r.aip_kind,
  r.department_id,
  r.department_code,
  r.department_name,
  r.sector_id,
  r.sector_code,
  r.sector_heading,
  r.item_no,
  r.ref_code,
  r.description,
  r.implementing_office,
  r.start_date,
  r.end_date,
  r.expected_output,
  r.funding_source,
  r.amount_total       as approved_amount,
  f.allotted,
  f.obligated,
  f.disbursed,
  f.unobligated_balance,
  f.unpaid_obligations,
  f.obligation_rate,
  f.disbursement_rate,
  f.physical_percent,
  f.physical_as_of,
  r.group_sort_path,
  r.sort_order
from tracks.v_ppa_rows r
join tracks.v_ppa_financials f on f.ppa_id = r.id;

grant select on
  tracks.v_ppa_group_paths,
  tracks.v_ppa_rows,
  tracks.v_ppa_financials,
  tracks.v_aip_totals,
  tracks.v_sector_totals,
  tracks.v_period_totals,
  tracks.v_monitoring
to authenticated;

-- ---------------------------------------------------------------------------
-- 0005_rls_helpers.sql
-- ---------------------------------------------------------------------------

-- 0005_rls_helpers.sql
-- Authorization helpers.
--
-- SECURITY DEFINER precisely so a policy ON tracks.user_roles can call them
-- WITHOUT recursing into user_roles' own RLS — a plain subquery there is
-- infinite recursion.
--
-- STABLE, so Postgres caches them per statement. And they are NOT JWT claims:
-- deactivating an encoder takes effect on their very next query, not when their
-- token expires an hour later.

create or replace function tracks.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce(
    (select global_role = 'super_admin' from tracks.profiles
      where auth_user_id = auth.uid() and active),
    false);
$$;

create or replace function tracks.current_role_name()
returns text
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.role
  from tracks.user_roles ur
  where ur.profile_id = tracks.current_profile_id()
    and ur.status = 'active';
$$;

create or replace function tracks.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.department_id
  from tracks.user_roles ur
  join tracks.departments d on d.id = ur.department_id
  where ur.profile_id = tracks.current_profile_id()
    and ur.status = 'active'
    and d.active;
$$;

create or replace function tracks.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.is_super_admin()
      or coalesce(tracks.current_role_name() = any (p_roles), false);
$$;

-- City Planning Office: reviews, returns items, consolidates, prints.
create or replace function tracks.is_planning()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.has_role(array['planning_staff', 'planning_admin']);
$$;

-- Sector settings, departments, periods, user invites.
create or replace function tracks.is_planning_admin()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.has_role(array['planning_admin']);
$$;

-- Everyone signed in and provisioned may READ the whole AIP — this is a public
-- investment programme, and Budget/Accounting/LDC all need the full picture.
-- WRITE is where the walls are. An account with no active role reads nothing.
create or replace function tracks.is_provisioned()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.is_super_admin() or tracks.current_role_name() is not null;
$$;

create or replace function tracks.require_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = tracks, public
as $$
begin
  if not tracks.has_role(p_roles) then
    raise exception 'Not authorized: requires one of %.', array_to_string(p_roles, ', ')
      using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The submission lock.
--
-- This is the rule the whole department workflow turns on:
--
--   draft      the department owns it and edits freely
--   submitted  LOCKED. Nobody in the department touches anything.
--   returned   STILL LOCKED — except the specific items City Planning sent
--              back. Three returned items out of two hundred do not reopen
--              the other 197.
--   accepted   LOCKED to the department, permanently.
--
-- City Planning may overwrite at any time until the period is closed; every
-- such write is captured by the ppa_revisions trigger with the original value,
-- so an overwritten department figure is always recoverable.
-- ---------------------------------------------------------------------------

create or replace function tracks.can_edit_ppa(p_ppa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.ppas p
    join tracks.aips a          on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where p.id = p_ppa_id
      and per.status <> 'closed'
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and p.department_id = tracks.current_department_id()
          and (
            a.status = 'draft'
            or (a.status = 'returned' and exists (
                  select 1 from tracks.ppa_returns r
                  where r.ppa_id = p.id and r.resolved_at is null))
          )
        )
      )
  );
$$;

-- Adding or removing a row is a structural change: the department may only do it
-- while the submission is still a draft. A returned item is corrected, not
-- replaced.
create or replace function tracks.can_modify_aip_structure(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.aips a
    join tracks.aip_periods per on per.id = a.period_id
    where a.id = p_aip_id
      and per.status <> 'closed'
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and a.department_id = tracks.current_department_id()
          and a.status = 'draft'
        )
      )
  );
$$;

revoke execute on function tracks.is_super_admin()                 from public;
revoke execute on function tracks.current_role_name()              from public;
revoke execute on function tracks.current_department_id()          from public;
revoke execute on function tracks.has_role(text[])                 from public;
revoke execute on function tracks.is_planning()                    from public;
revoke execute on function tracks.is_planning_admin()              from public;
revoke execute on function tracks.is_provisioned()                 from public;
revoke execute on function tracks.require_role(text[])             from public;
revoke execute on function tracks.can_edit_ppa(uuid)               from public;
revoke execute on function tracks.can_modify_aip_structure(uuid)   from public;

grant execute on function tracks.is_super_admin()               to authenticated;
grant execute on function tracks.current_role_name()            to authenticated;
grant execute on function tracks.current_department_id()        to authenticated;
grant execute on function tracks.has_role(text[])               to authenticated;
grant execute on function tracks.is_planning()                  to authenticated;
grant execute on function tracks.is_planning_admin()            to authenticated;
grant execute on function tracks.is_provisioned()               to authenticated;
grant execute on function tracks.can_edit_ppa(uuid)             to authenticated;
grant execute on function tracks.can_modify_aip_structure(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 0006_rls_policies.sql
-- ---------------------------------------------------------------------------

-- 0006_rls_policies.sql
-- Row Level Security. Enabled AND FORCED on every table in tracks.
--
-- Policy shape:
--   * Reads:   any provisioned user sees the whole AIP. This is a public
--              investment programme; Budget, Accounting and the LDC all need
--              the full picture, and hiding a department's rows from another
--              department buys nothing. An account with no active role reads
--              nothing at all.
--   * Writes:  narrow. A department writes only its own rows, only while the
--              submission lock allows it (tracks.can_edit_ppa). Budget writes
--              allotments and obligations, Accounting writes disbursements,
--              City Planning manages reference data and the review loop.
--   * audit_logs and ppa_revisions: insert + select only. No update policy and
--              no delete policy exist, so those operations are denied to
--              everyone, including a planning admin.
--
-- There is no `using (true)` anywhere in this file.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'lgu_settings', 'sectors', 'departments', 'user_roles', 'invites',
    'audit_logs', 'aip_periods', 'aips', 'ppa_groups', 'ppas', 'ppa_returns',
    'ppa_revisions', 'aip_actions', 'allotments', 'obligations', 'disbursements',
    'ppa_progress'
  ] loop
    execute format('alter table tracks.%I enable row level security', t);
    execute format('alter table tracks.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy profiles_read on tracks.profiles for select to authenticated
using (auth_user_id = auth.uid() or tracks.is_provisioned());

create policy profiles_self_update on tracks.profiles for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid() and global_role = 'user' and active);
-- A user cannot promote themselves and cannot un-deactivate themselves.

create policy profiles_admin_write on tracks.profiles for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy user_roles_read on tracks.user_roles for select to authenticated
using (profile_id = tracks.current_profile_id() or tracks.is_provisioned());

create policy user_roles_admin_write on tracks.user_roles for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy invites_read on tracks.invites for select to authenticated
using (tracks.is_planning_admin());

create policy invites_admin_write on tracks.invites for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

-- ---------------------------------------------------------------------------
-- Reference data — City Planning Office owns all of it.
-- ---------------------------------------------------------------------------

create policy lgu_settings_read on tracks.lgu_settings for select to authenticated
using (tracks.is_provisioned());

create policy lgu_settings_admin_write on tracks.lgu_settings for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy sectors_read on tracks.sectors for select to authenticated
using (tracks.is_provisioned());

create policy sectors_admin_write on tracks.sectors for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy departments_read on tracks.departments for select to authenticated
using (tracks.is_provisioned());

create policy departments_admin_write on tracks.departments for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

-- ---------------------------------------------------------------------------
-- Periods and submissions
-- ---------------------------------------------------------------------------

create policy aip_periods_read on tracks.aip_periods for select to authenticated
using (tracks.is_provisioned());

create policy aip_periods_admin_write on tracks.aip_periods for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy aips_read on tracks.aips for select to authenticated
using (tracks.is_provisioned());

-- A department head or encoder may create their own department's submission
-- while the period is open. They may not create anybody else's.
create policy aips_department_insert on tracks.aips for insert to authenticated
with check (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and department_id = tracks.current_department_id()
  and exists (select 1 from tracks.aip_periods per
               where per.id = period_id and per.status not in ('approved', 'closed'))
);

-- The department may edit the submission row itself only while it is a draft.
-- The submit transition is an RPC, not a bare UPDATE — see 0007.
create policy aips_department_update on tracks.aips for update to authenticated
using (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and department_id = tracks.current_department_id()
  and status = 'draft'
)
with check (
  department_id = tracks.current_department_id()
  and status = 'draft'
);

create policy aips_planning_write on tracks.aips for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

-- ---------------------------------------------------------------------------
-- The grid: groups and PPAs
-- ---------------------------------------------------------------------------

create policy ppa_groups_read on tracks.ppa_groups for select to authenticated
using (tracks.is_provisioned());

create policy ppa_groups_write on tracks.ppa_groups for all to authenticated
using (tracks.can_modify_aip_structure(aip_id))
with check (tracks.can_modify_aip_structure(aip_id));

create policy ppas_read on tracks.ppas for select to authenticated
using (tracks.is_provisioned());

-- Insert and delete follow the AIP's structural lock; update follows the
-- per-item lock, which is what lets a returned item be corrected while the rest
-- of a submitted AIP stays frozen.
create policy ppas_insert on tracks.ppas for insert to authenticated
with check (tracks.can_modify_aip_structure(aip_id));

create policy ppas_update on tracks.ppas for update to authenticated
using (tracks.can_edit_ppa(id))
with check (tracks.can_edit_ppa(id));

create policy ppas_delete on tracks.ppas for delete to authenticated
using (tracks.can_modify_aip_structure(aip_id));

-- ---------------------------------------------------------------------------
-- Returns — City Planning opens them, the department resolves them.
-- ---------------------------------------------------------------------------

create policy ppa_returns_read on tracks.ppa_returns for select to authenticated
using (tracks.is_provisioned());

create policy ppa_returns_planning_write on tracks.ppa_returns for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

-- The department may only close out a return on its own item, and only by
-- stamping resolved_at — it cannot rewrite the reason it was sent back.
create policy ppa_returns_department_resolve on tracks.ppa_returns for update to authenticated
using (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and exists (select 1 from tracks.ppas p
               where p.id = ppa_id and p.department_id = tracks.current_department_id())
)
with check (resolved_at is not null);

-- ---------------------------------------------------------------------------
-- History — append only. No update policy, no delete policy, for anyone.
-- ---------------------------------------------------------------------------

create policy ppa_revisions_read on tracks.ppa_revisions for select to authenticated
using (tracks.is_provisioned());

create policy audit_logs_read on tracks.audit_logs for select to authenticated
using (tracks.is_provisioned());

create policy audit_logs_insert on tracks.audit_logs for insert to authenticated
with check (tracks.is_provisioned());

-- ---------------------------------------------------------------------------
-- Execution: council actions, allotments, obligations, disbursements, progress
-- ---------------------------------------------------------------------------

create policy aip_actions_read on tracks.aip_actions for select to authenticated
using (tracks.is_provisioned());

create policy aip_actions_planning_write on tracks.aip_actions for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

create policy allotments_read on tracks.allotments for select to authenticated
using (tracks.is_provisioned());

create policy allotments_budget_write on tracks.allotments for all to authenticated
using (tracks.has_role(array['budget']))
with check (tracks.has_role(array['budget']));

create policy obligations_read on tracks.obligations for select to authenticated
using (tracks.is_provisioned());

create policy obligations_budget_write on tracks.obligations for all to authenticated
using (tracks.has_role(array['budget']))
with check (tracks.has_role(array['budget']));

create policy disbursements_read on tracks.disbursements for select to authenticated
using (tracks.is_provisioned());

create policy disbursements_accounting_write on tracks.disbursements for all to authenticated
using (tracks.has_role(array['accounting']))
with check (tracks.has_role(array['accounting']));

-- Physical accomplishment is reported by the office actually doing the work,
-- and City Planning consolidates it.
create policy ppa_progress_read on tracks.ppa_progress for select to authenticated
using (tracks.is_provisioned());

create policy ppa_progress_write on tracks.ppa_progress for all to authenticated
using (
  tracks.is_planning()
  or (tracks.has_role(array['dept_encoder', 'dept_head'])
      and exists (select 1 from tracks.ppas p
                   where p.id = ppa_id
                     and p.department_id = tracks.current_department_id()))
)
with check (
  tracks.is_planning()
  or (tracks.has_role(array['dept_encoder', 'dept_head'])
      and exists (select 1 from tracks.ppas p
                   where p.id = ppa_id
                     and p.department_id = tracks.current_department_id()))
);

-- ---------------------------------------------------------------------------
-- 0007_rpc_auth_and_workflow.sql
-- ---------------------------------------------------------------------------

-- 0007_rpc_auth_and_workflow.sql
-- The transitions. Everything that changes WHO you are or WHERE a submission is
-- in the review loop goes through a SECURITY DEFINER function here, never a bare
-- UPDATE from TypeScript.

-- ---------------------------------------------------------------------------
-- tracks.claim_invite()
--
-- WHY THIS IS NOT A TRIGGER ON auth.users:
--   This Supabase project is shared with other apps. A trigger on auth.users
--   that raises — a constraint violation, a bad search_path, a dropped column —
--   breaks signup for EVERY app on the project, and you would debug it from an
--   unrelated codebase. Lazy provisioning has zero blast radius. It also handles
--   the case an AFTER INSERT trigger structurally cannot: an invitee who already
--   exists in auth.users because they use another app on this project.
--
-- Any Google account can obtain a session; that is a project-wide setting we do
-- not control. What is guaranteed is that an uninvited account gets no profile,
-- no role, and — because every read policy calls tracks.is_provisioned() —
-- zero rows from every table.
-- ---------------------------------------------------------------------------

create or replace function tracks.claim_invite()
returns tracks.profiles
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_name    text;
  v_avatar  text;
  v_profile tracks.profiles;
  v_invite  tracks.invites;
begin
  if v_uid is null then
    return null;
  end if;

  select lower(u.email),
         coalesce(u.raw_user_meta_data ->> 'full_name',
                  u.raw_user_meta_data ->> 'name',
                  split_part(u.email, '@', 1)),
         u.raw_user_meta_data ->> 'avatar_url'
    into v_email, v_name, v_avatar
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return null;
  end if;

  -- 1. Already bound — refresh the display snapshot and return.
  select * into v_profile from tracks.profiles where auth_user_id = v_uid;
  if found then
    update tracks.profiles
       set full_name  = coalesce(nullif(v_name, ''), full_name),
           avatar_url = coalesce(v_avatar, avatar_url),
           email      = v_email
     where id = v_profile.id
     returning * into v_profile;
    return v_profile;
  end if;

  -- 2. An unbound profile for this address: the bootstrap planning admin, or
  --    someone re-invited after another app removed their auth user.
  select * into v_profile
  from tracks.profiles
  where email = v_email and auth_user_id is null;

  if found then
    update tracks.profiles
       set auth_user_id = v_uid,
           full_name    = coalesce(nullif(v_name, ''), full_name),
           avatar_url   = coalesce(v_avatar, avatar_url)
     where id = v_profile.id
     returning * into v_profile;

    perform tracks.write_audit('PROFILE_BOUND', 'profile', v_profile.id,
                               null, jsonb_build_object('email', v_email));
  end if;

  -- 3. A live invitation for this exact address.
  select * into v_invite
  from tracks.invites
  where email = v_email and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1;

  if not found and v_profile.id is null then
    return null;   -- uninvited. The caller signs them out.
  end if;

  if v_profile.id is null then
    insert into tracks.profiles (auth_user_id, email, full_name, avatar_url, global_role)
    values (v_uid, v_email, coalesce(nullif(v_name, ''), v_invite.full_name), v_avatar, 'user')
    returning * into v_profile;
  end if;

  if v_invite.id is not null then
    insert into tracks.user_roles (profile_id, role, department_id, status, created_by)
    values (v_profile.id, v_invite.role, v_invite.department_id, 'active', v_invite.invited_by)
    on conflict (profile_id) do update
      set role          = excluded.role,
          department_id = excluded.department_id,
          status        = 'active';

    update tracks.invites
       set status = 'accepted', accepted_at = now()
     where id = v_invite.id;

    perform tracks.write_audit('INVITE_CLAIMED', 'user_role', v_profile.id, null,
                               jsonb_build_object('email', v_email, 'role', v_invite.role));
  end if;

  return v_profile;
end;
$$;

revoke execute on function tracks.claim_invite() from public;
grant execute on function tracks.claim_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- tracks.submit_aip(aip_id)
--
-- Only the department head submits. An AIP that came back with returned items
-- cannot be resubmitted until every one of them has been resolved — otherwise
-- the department bounces the same folder back to Planning unchanged.
-- ---------------------------------------------------------------------------

create or replace function tracks.submit_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip      tracks.aips;
  v_open     integer;
  v_rows     integer;
  v_period   text;
begin
  select * into v_aip from tracks.aips where id = p_aip_id;

  if not found then
    raise exception 'AIP not found.' using errcode = 'P0002';
  end if;

  select per.status into v_period
  from tracks.aip_periods per where per.id = v_aip.period_id;

  if not (tracks.has_role(array['dept_head'])
          and v_aip.department_id = tracks.current_department_id()) then
    raise exception 'Only the department head of this office may submit its AIP.'
      using errcode = '42501';
  end if;

  if v_period in ('approved', 'closed') then
    raise exception 'The % AIP period is no longer accepting submissions.', v_period
      using errcode = '42501';
  end if;

  if v_aip.status not in ('draft', 'returned') then
    raise exception 'This AIP is already %.', v_aip.status using errcode = '42501';
  end if;

  select count(*) into v_rows from tracks.ppas where aip_id = p_aip_id;
  if v_rows = 0 then
    raise exception 'Cannot submit an AIP with no PPAs.' using errcode = '23514';
  end if;

  select count(*) into v_open
  from tracks.ppa_returns r
  join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Resolve the % returned item(s) before resubmitting.', v_open
      using errcode = '23514';
  end if;

  update tracks.aips
     set status       = 'submitted',
         submitted_at = now(),
         submitted_by = tracks.current_profile_id()
   where id = p_aip_id
   returning * into v_aip;

  perform tracks.write_audit('AIP_SUBMITTED', 'aip', p_aip_id, null,
                             jsonb_build_object('ppa_count', v_rows));
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.return_ppa(ppa_id, reason)
--
-- City Planning sends ONE item back. The submission stays locked; only this row
-- becomes editable again. That is the whole point.
-- ---------------------------------------------------------------------------

create or replace function tracks.return_ppa(p_ppa_id uuid, p_reason text)
returns tracks.ppa_returns
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip_id uuid;
  v_status text;
  v_return tracks.ppa_returns;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when returning an item.' using errcode = '23514';
  end if;

  select a.id, a.status into v_aip_id, v_status
  from tracks.ppas p join tracks.aips a on a.id = p.aip_id
  where p.id = p_ppa_id;

  if not found then
    raise exception 'PPA not found.' using errcode = 'P0002';
  end if;

  if v_status not in ('submitted', 'returned') then
    raise exception 'Only a submitted AIP can have items returned (this one is %).', v_status
      using errcode = '42501';
  end if;

  insert into tracks.ppa_returns (ppa_id, reason, returned_by)
  values (p_ppa_id, trim(p_reason), tracks.current_profile_id())
  returning * into v_return;

  update tracks.aips set status = 'returned' where id = v_aip_id and status <> 'returned';

  perform tracks.write_audit('PPA_RETURNED', 'ppa', p_ppa_id, null,
                             jsonb_build_object('reason', trim(p_reason)));
  return v_return;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.resolve_return(ppa_id, note)  — the department closing out a correction.
-- ---------------------------------------------------------------------------

create or replace function tracks.resolve_return(p_ppa_id uuid, p_note text default null)
returns tracks.ppa_returns
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_return tracks.ppa_returns;
begin
  if not exists (
    select 1 from tracks.ppas p
    where p.id = p_ppa_id
      and (tracks.is_planning()
           or (tracks.has_role(array['dept_encoder', 'dept_head'])
               and p.department_id = tracks.current_department_id()))
  ) then
    raise exception 'Not authorized to resolve this item.' using errcode = '42501';
  end if;

  update tracks.ppa_returns
     set resolved_at     = now(),
         resolved_by     = tracks.current_profile_id(),
         resolution_note = p_note
   where ppa_id = p_ppa_id and resolved_at is null
   returning * into v_return;

  if not found then
    raise exception 'This item has no open return.' using errcode = 'P0002';
  end if;

  perform tracks.write_audit('PPA_RETURN_RESOLVED', 'ppa', p_ppa_id, null,
                             jsonb_build_object('note', p_note));
  return v_return;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.accept_aip(aip_id)  — City Planning taking it into the consolidation.
-- ---------------------------------------------------------------------------

create or replace function tracks.accept_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip  tracks.aips;
  v_open integer;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  select count(*) into v_open
  from tracks.ppa_returns r join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Cannot accept an AIP with % unresolved returned item(s).', v_open
      using errcode = '23514';
  end if;

  update tracks.aips
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = tracks.current_profile_id()
   where id = p_aip_id and status = 'submitted'
   returning * into v_aip;

  if not found then
    raise exception 'Only a submitted AIP can be accepted.' using errcode = '42501';
  end if;

  perform tracks.write_audit('AIP_ACCEPTED', 'aip', p_aip_id, null, null);
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.reopen_aip(aip_id, reason) — Planning unlocking a whole submission.
-- The escape hatch for "they submitted the wrong file". Audited, never silent.
-- ---------------------------------------------------------------------------

create or replace function tracks.reopen_aip(p_aip_id uuid, p_reason text)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip tracks.aips;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reopen a submission.' using errcode = '23514';
  end if;

  update tracks.aips
     set status = 'draft', submitted_at = null, submitted_by = null,
         accepted_at = null, accepted_by = null
   where id = p_aip_id and status <> 'draft'
   returning * into v_aip;

  if not found then
    raise exception 'This AIP is already a draft.' using errcode = '42501';
  end if;

  perform tracks.write_audit('AIP_REOPENED', 'aip', p_aip_id, null,
                             jsonb_build_object('reason', trim(p_reason)));
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.set_period_status(period_id, status)
--
-- Moves the consolidated AIP along the paper trail. Planning admin only.
-- ---------------------------------------------------------------------------

create or replace function tracks.set_period_status(p_period_id uuid, p_status text)
returns tracks.aip_periods
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_period tracks.aip_periods;
  v_old    text;
begin
  perform tracks.require_role(array['planning_admin']);

  select status into v_old from tracks.aip_periods where id = p_period_id;
  if not found then
    raise exception 'AIP period not found.' using errcode = 'P0002';
  end if;

  update tracks.aip_periods set status = p_status
   where id = p_period_id
   returning * into v_period;

  perform tracks.write_audit('PERIOD_STATUS_CHANGED', 'aip_period', p_period_id,
                             jsonb_build_object('status', v_old),
                             jsonb_build_object('status', p_status));
  return v_period;
end;
$$;

revoke execute on function tracks.submit_aip(uuid)              from public;
revoke execute on function tracks.return_ppa(uuid, text)        from public;
revoke execute on function tracks.resolve_return(uuid, text)    from public;
revoke execute on function tracks.accept_aip(uuid)              from public;
revoke execute on function tracks.reopen_aip(uuid, text)        from public;
revoke execute on function tracks.set_period_status(uuid, text) from public;

grant execute on function tracks.submit_aip(uuid)              to authenticated;
grant execute on function tracks.return_ppa(uuid, text)        to authenticated;
grant execute on function tracks.resolve_return(uuid, text)    to authenticated;
grant execute on function tracks.accept_aip(uuid)              to authenticated;
grant execute on function tracks.reopen_aip(uuid, text)        to authenticated;
grant execute on function tracks.set_period_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 0008_fix_ungrouped_row_order.sql
-- ---------------------------------------------------------------------------

-- 0008_fix_ungrouped_row_order.sql
-- A PPA with no column-C grouping sorted to the TOP of its department.
--
-- v_ppa_rows ordered by coalesce(group_sort_path, '{0,0,0,0}'), so every
-- ungrouped row shared the sort key {0,0,0,0} and preceded every group — a row
-- added to a department that already had headings jumped to item 1. In the
-- source workbook an ungrouped row simply sits where it was entered.
--
-- Positioning it by its own sort_order at the top level interleaves it with the
-- groups instead: a new row (sort_order = max + 1) lands after the existing
-- headings, which is where the person who added it expects to find it.

create or replace view tracks.v_ppa_rows
with (security_invoker = true) as
select
  p.id,
  p.aip_id,
  a.period_id,
  per.year                      as period_year,
  a.kind                        as aip_kind,
  a.supplemental_no,
  a.status                      as aip_status,
  p.department_id,
  d.code                        as department_code,
  d.display_name                as department_name,
  d.sort_order                  as department_sort,
  s.id                          as sector_id,
  s.code                        as sector_code,
  s.heading                     as sector_heading,
  s.sheet_name                  as sector_sheet_name,
  s.sort_order                  as sector_sort,
  p.group_id,
  gp.name_path                  as group_path,
  gp.path_label                 as group_path_label,
  row_number() over (
    partition by p.aip_id
    order by coalesce(gp.sort_path, array[p.sort_order, 0, 0, 0]),
             p.sort_order, p.created_at
  )                             as item_no,
  p.ref_code,
  p.description,
  p.implementing_office,
  p.start_date,
  p.end_date,
  p.expected_output,
  p.funding_source,
  p.amount_ps,
  p.amount_mooe,
  p.amount_fe,
  p.amount_co,
  p.amount_total,
  p.cca_amount,
  p.ccm_amount,
  p.cc_typology_code,
  p.continues_ppa_id,
  p.sort_order,
  coalesce(gp.sort_path, array[p.sort_order, 0, 0, 0]) as group_sort_path,
  r.id                          as open_return_id,
  r.reason                      as open_return_reason,
  r.returned_at                 as open_return_at,
  (r.id is not null)            as is_returned,
  p.created_at,
  p.updated_at
from tracks.ppas p
join tracks.aips a         on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d  on d.id = p.department_id
join tracks.sectors s      on s.id = d.sector_id
left join tracks.v_ppa_group_paths gp on gp.id = p.group_id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null;

grant select on tracks.v_ppa_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 0009_storage_policies.sql
-- ---------------------------------------------------------------------------

-- 0009_storage_policies.sql
-- Storage for the scanned paper trail: LDC endorsements, the Mayor's approval,
-- the City Council resolution.
--
-- SHARED PROJECT. `storage.objects` is shared infrastructure — every policy here
-- is scoped `bucket_id = 'tracks-documents'` so it cannot touch another app's
-- files. The bucket is PRIVATE: a council resolution is a public document, but
-- a link that anyone who guesses a filename can fetch is not how it should
-- leave the building. Reads go through a signed URL.

insert into storage.buckets (id, name, public)
values ('tracks-documents', 'tracks-documents', false)
on conflict (id) do nothing;

-- Anyone provisioned in TRACKS may read the scans. This is the same reasoning as
-- the table policies: the investment programme is public work, and Budget,
-- Accounting and the LDC all need to see what came back.
drop policy if exists tracks_documents_read on storage.objects;
create policy tracks_documents_read on storage.objects for select to authenticated
using (bucket_id = 'tracks-documents' and tracks.is_provisioned());

-- Only City Planning attaches paper. They are the office the folder comes back to.
drop policy if exists tracks_documents_write on storage.objects;
create policy tracks_documents_write on storage.objects for insert to authenticated
with check (bucket_id = 'tracks-documents' and tracks.is_planning());

drop policy if exists tracks_documents_update on storage.objects;
create policy tracks_documents_update on storage.objects for update to authenticated
using (bucket_id = 'tracks-documents' and tracks.is_planning())
with check (bucket_id = 'tracks-documents' and tracks.is_planning());

-- Deliberately no DELETE policy. A resolution that has been recorded against a
-- programme is not something the system should let anyone quietly remove; if a
-- wrong file was attached, attach the right one and the record shows both.

-- ---------------------------------------------------------------------------
-- 0010_action_document_path.sql
-- ---------------------------------------------------------------------------

-- 0010_action_document_path.sql
-- `document_url` held a Storage object path, not a URL.
--
-- The bucket is private, so what is stored is a path and what is handed to a
-- browser is a short-lived signed URL generated at read time. A column called
-- `_url` invites someone to render it into an <a href> that 400s — or worse, to
-- make the bucket public so that it works.

alter table tracks.aip_actions rename column document_url to document_path;

-- ---------------------------------------------------------------------------
-- 0011_group_depth_cascade.sql
-- ---------------------------------------------------------------------------

-- 0011_group_depth_cascade.sql
-- Column-C groups: two fixes that both surface as soon as headings are edited
-- rather than only seeded.
--
--   1. Deleting a heading that has PPAs under it fails outright.
--   2. Moving a heading leaves its descendants holding a stale depth.
--
-- ---------------------------------------------------------------------------
-- 1. ppas_group_id_aip_id_fkey — ON DELETE SET NULL nulls the WHOLE key
-- ---------------------------------------------------------------------------
--
-- The FK is composite, (group_id, aip_id) -> ppa_groups (id, aip_id), and a
-- plain ON DELETE SET NULL sets every column of the referencing key to null.
-- Postgres generates, verbatim:
--
--   UPDATE ONLY tracks.ppas SET group_id = NULL, aip_id = NULL WHERE ...
--
-- ppas.aip_id is NOT NULL, so deleting any heading with rows beneath it raises
-- `null value in column "aip_id"` and rolls back. The intent was only ever to
-- let go of the heading — a PPA is not owned by its column-C caption, and
-- removing a caption must not detach the row from its AIP.
--
-- Postgres 15 added the column list for exactly this. Restrict the set-null to
-- group_id and the row keeps its AIP, its department and its money.

alter table tracks.ppas
  drop constraint ppas_group_id_aip_id_fkey;

alter table tracks.ppas
  add constraint ppas_group_id_aip_id_fkey
  foreign key (group_id, aip_id)
  references tracks.ppa_groups (id, aip_id)
  on delete set null (group_id);

-- ---------------------------------------------------------------------------
-- 2. Keep `depth` true for descendants when a group is reparented
-- ---------------------------------------------------------------------------
--
-- ppa_groups_set_depth() is a BEFORE trigger on the row being changed, so it
-- only ever fixes that one row. Moving a subtree left its descendants holding
-- the depth they had under the old parent:
--
--   ROOT-A                                ROOT-B
--     CHILD        depth 2                  CHILD        depth 1  (recomputed)
--       GRANDCHILD depth 3       ->           GRANDCHILD depth 3  (WRONG, is 2)
--
-- That is not cosmetic. v_ppa_group_paths builds sort_path by slicing on
-- `depth` (`w.sort_path[1:c.depth - 1] || c.sort_order || ...`), and v_ppa_rows
-- orders the whole AIP by sort_path. A stale depth writes a PPA into the wrong
-- slot of the sort array, so column (2) renumbers itself wrongly and the
-- exported worksheet prints rows out of order.
--
-- Fixed with an AFTER trigger that walks the subtree once. The recursive update
-- touches `depth` only, and the trigger below is `update of parent_id`, so it
-- cannot re-enter. The depth 1..4 CHECK still applies to every descendant: a
-- move that would push a grandchild past the cap raises and rolls the whole
-- statement back, which is the intended answer rather than a silent truncation.

create or replace function tracks.ppa_groups_sync_descendant_depth()
returns trigger
language plpgsql
as $$
begin
  with recursive subtree as (
    select g.id, new.depth + 1 as new_depth
    from tracks.ppa_groups g
    where g.parent_id = new.id

    union all

    select c.id, s.new_depth + 1
    from tracks.ppa_groups c
    join subtree s on c.parent_id = s.id
  )
  update tracks.ppa_groups g
     set depth = s.new_depth
    from subtree s
   where g.id = s.id
     and g.depth is distinct from s.new_depth;

  return null;
end;
$$;

create trigger ppa_groups_depth_cascade
  after update of parent_id on tracks.ppa_groups
  for each row
  when (old.depth is distinct from new.depth)
  execute function tracks.ppa_groups_sync_descendant_depth();

-- ---------------------------------------------------------------------------
-- 0012_flat_rows.sql
-- ---------------------------------------------------------------------------

-- 0012_flat_rows.sql
-- Column C stops being a tree and becomes what the printed form actually shows:
-- a row.
--
-- WHY
--   writeGroupRow() in lib/aip/workbook.ts has only ever taken a name. Depth is
--   never rendered — no indent, no weight, nothing — so in the worksheet
--
--     Support to Business Permit and Licensing      (was depth 1)
--     General and Administrative Operation          (was depth 2)
--
--   are indistinguishable. The tree existed to order rows and to be printed, and
--   it was never printed. So a heading becomes a PPA row carrying only a
--   description, `ppa_groups` goes away, and the whole document is one ordered
--   list — which is also the only model in which "insert a row below this one"
--   means one thing everywhere.
--
-- WHAT THIS COSTS
--   Flattening is ONE-WAY. Nested headings become consecutive sibling headings
--   in path order. The printed result is identical — the block below proves it
--   row by row and aborts if it is not — but the parent/child relationship is
--   gone and cannot be recovered from the result.
--
-- SUPERSEDES 0011. That migration fixed the composite FK's set-null and the
-- depth cascade, both of which concern group_id and depth. This drops both
-- columns, so 0011 need never be applied to an existing database; every
-- statement here tolerates its presence or absence.

-- ---------------------------------------------------------------------------
-- 1. row_kind, and the constraints that keep a heading a heading
-- ---------------------------------------------------------------------------

alter table tracks.ppas
  add column row_kind text not null default 'ppa'
    check (row_kind in ('ppa', 'header'));

comment on column tracks.ppas.row_kind is
  'ppa = a numbered line of the programme. header = a column-C caption: '
  'description only, no money, no item number.';

-- A heading has no money, so the "at least one expense class" rule cannot apply
-- to it. Restated rather than dropped: it still holds for every real row.
alter table tracks.ppas drop constraint ppas_amount_positive;
alter table tracks.ppas add constraint ppas_amount_positive check (
  row_kind <> 'ppa'
  or amount_ps + amount_mooe + amount_fe + amount_co > 0);

-- The mirror. Without it a heading could quietly carry PS 5,000,000 and it
-- would land in a department subtotal while printing as a bold caption.
alter table tracks.ppas add constraint ppas_header_is_caption_only check (
  row_kind <> 'header'
  or (ref_code is null
      and implementing_office is null
      and start_date is null
      and end_date is null
      and expected_output is null
      and funding_source is null
      and cca_amount is null
      and ccm_amount is null
      and cc_typology_code is null
      and continues_ppa_id is null
      and amount_ps = 0 and amount_mooe = 0 and amount_fe = 0 and amount_co = 0));

-- ---------------------------------------------------------------------------
-- 2. Nothing may point at a heading
-- ---------------------------------------------------------------------------
--
-- Six tables reference ppas.id. Once headings live in that table, Budget could
-- allot against "Support to Tech4ed" and Accounting could disburse it. Each
-- referencing row now carries a constant 'ppa' discriminator and points at the
-- (id, row_kind) key, so the database refuses it rather than a trigger someone
-- can forget to add to the seventh table.

alter table tracks.ppas add constraint ppas_id_row_kind_key unique (id, row_kind);

alter table tracks.ppas drop constraint ppas_continues_ppa_id_fkey;
alter table tracks.ppas
  add column continues_row_kind text not null default 'ppa'
    check (continues_row_kind = 'ppa');
-- MATCH SIMPLE: with continues_ppa_id null the constraint does not apply, which
-- is what keeps the column optional.
alter table tracks.ppas
  add constraint ppas_continues_ppa_id_fkey
  foreign key (continues_ppa_id, continues_row_kind)
  references tracks.ppas (id, row_kind) on delete set null;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('ppa_returns',   'cascade'),
      ('allotments',    'restrict'),
      ('obligations',   'restrict'),
      ('disbursements', 'restrict'),
      ('ppa_progress',  'cascade')
    ) as v(name, on_delete)
  loop
    execute format(
      'alter table tracks.%I drop constraint %I', t.name, t.name || '_ppa_id_fkey');
    execute format(
      'alter table tracks.%I add column ppa_row_kind text not null default ''ppa''
         check (ppa_row_kind = ''ppa'')', t.name);
    execute format(
      'alter table tracks.%I add constraint %I
         foreign key (ppa_id, ppa_row_kind) references tracks.ppas (id, row_kind)
         on delete %s',
      t.name, t.name || '_ppa_id_fkey', t.on_delete);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Fold ppa_groups into ppas, and prove the document did not move
-- ---------------------------------------------------------------------------

create temporary table _before_seq (
  aip_id uuid not null,
  pos    integer not null,
  kind   text not null,
  label  text not null,
  ppa_id uuid
);
-- Not `on commit drop`: migrations are applied statement-at-a-time by
-- run-local.sh and as one transaction by the deploy bundle. A session-lifetime
-- temp table, dropped explicitly below, survives both.

-- The rendered sequence as it stands today: exactly what writeDepartmentRows()
-- emits — a heading whenever the column-C ancestry changes, then the row.
do $$
declare
  r      record;
  v_aip  uuid := null;
  v_prev text[] := '{}';
  v_pos  integer := 0;
  d      integer;
begin
  for r in
    select aip_id, id, description,
           coalesce(group_path, '{}'::text[]) as path
    from tracks.v_ppa_rows
    order by aip_id, group_sort_path, sort_order, created_at
  loop
    if v_aip is distinct from r.aip_id then
      v_aip  := r.aip_id;
      v_prev := '{}';
      v_pos  := 0;
    end if;

    for d in 1 .. coalesce(array_length(r.path, 1), 0) loop
      -- Emit unless this level AND every shallower level are unchanged.
      if not (coalesce(array_length(v_prev, 1), 0) >= d
              and v_prev[1:d] = r.path[1:d]) then
        v_pos := v_pos + 1;
        insert into _before_seq values (r.aip_id, v_pos, 'header', r.path[d], null);
      end if;
    end loop;

    v_prev := r.path;
    v_pos  := v_pos + 1;
    insert into _before_seq values (r.aip_id, v_pos, 'ppa', r.description, r.id);
  end loop;
end $$;

-- Headings become rows at the position they printed at.
insert into tracks.ppas (aip_id, department_id, row_kind, description, sort_order)
select b.aip_id, a.department_id, 'header', b.label, b.pos
from _before_seq b
join tracks.aips a on a.id = b.aip_id
where b.kind = 'header';

-- Real rows take the position they printed at, so both kinds share one line.
update tracks.ppas p
   set sort_order = b.pos
  from _before_seq b
 where b.kind = 'ppa' and b.ppa_id = p.id;

-- A heading nobody filed a row under never rendered, so it is not in the
-- sequence above and would be silently lost. Keep it, at the end of its AIP,
-- rather than deleting something an encoder typed on purpose.
insert into tracks.ppas (aip_id, department_id, row_kind, description, sort_order)
select g.aip_id, a.department_id, 'header', g.name,
       coalesce((select max(pos) from _before_seq b where b.aip_id = g.aip_id), 0)
         + row_number() over (partition by g.aip_id order by g.sort_order, g.id)
from tracks.ppa_groups g
join tracks.aips a on a.id = g.aip_id
where not exists (select 1 from tracks.ppas p where p.group_id = g.id);

-- The proof. Compares the old rendered sequence against the new one, position
-- by position, and rolls the whole migration back on the first disagreement.
do $$
declare
  v_bad record;
begin
  select b.aip_id, b.pos, b.kind, b.label, x.kind as got_kind, x.label as got_label
    into v_bad
  from _before_seq b
  full join (
    select aip_id,
           row_number() over (partition by aip_id order by sort_order, created_at) as pos,
           row_kind as kind,
           description as label
    from tracks.ppas
    where sort_order <= (select coalesce(max(pos), 0) from _before_seq s
                          where s.aip_id = ppas.aip_id)
  ) x on x.aip_id = b.aip_id and x.pos = b.pos
  where b.kind is distinct from x.kind or b.label is distinct from x.label
  limit 1;

  if found then
    raise exception
      'Row sequence changed for AIP % at position %: expected % "%", got % "%"',
      v_bad.aip_id, v_bad.pos, v_bad.kind, v_bad.label,
      v_bad.got_kind, v_bad.got_label;
  end if;
end $$;

drop table _before_seq;

-- ---------------------------------------------------------------------------
-- 4. Drop the tree
-- ---------------------------------------------------------------------------

drop view if exists tracks.v_monitoring;
drop view if exists tracks.v_ppa_rows;
drop view if exists tracks.v_ppa_group_paths;

alter table tracks.ppas drop column group_id;

drop table tracks.ppa_groups cascade;
drop function if exists tracks.ppa_groups_set_depth() cascade;
drop function if exists tracks.ppa_groups_sync_descendant_depth() cascade;

-- ---------------------------------------------------------------------------
-- 5. The views, without the tree
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_rows
with (security_invoker = true) as
select
  p.id,
  p.aip_id,
  a.period_id,
  per.year                      as period_year,
  a.kind                        as aip_kind,
  a.supplemental_no,
  a.status                      as aip_status,
  p.department_id,
  d.code                        as department_code,
  d.display_name                as department_name,
  d.sort_order                  as department_sort,
  s.id                          as sector_id,
  s.code                        as sector_code,
  s.heading                     as sector_heading,
  s.sheet_name                  as sector_sheet_name,
  s.sort_order                  as sector_sort,
  p.row_kind,
  -- Column (2) numbers the programme, not the page: a heading takes no number
  -- and consumes none, so the sequence reads 37, heading, heading, 38.
  case when p.row_kind = 'ppa' then
    row_number() over (
      partition by p.aip_id, p.row_kind
      order by p.sort_order, p.created_at)
  end                           as item_no,
  p.ref_code,
  p.description,
  p.implementing_office,
  p.start_date,
  p.end_date,
  p.expected_output,
  p.funding_source,
  p.amount_ps,
  p.amount_mooe,
  p.amount_fe,
  p.amount_co,
  p.amount_total,
  p.cca_amount,
  p.ccm_amount,
  p.cc_typology_code,
  p.continues_ppa_id,
  p.sort_order,
  r.id                          as open_return_id,
  r.reason                      as open_return_reason,
  r.returned_at                 as open_return_at,
  (r.id is not null)            as is_returned,
  p.created_at,
  p.updated_at
from tracks.ppas p
join tracks.aips a          on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d   on d.id = p.department_id
join tracks.sectors s       on s.id = d.sector_id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null;

-- Headings carry no money and are not a line of the programme, so they are
-- excluded here rather than contributing a zero: ppa_count is on screen as
-- "Items" and would otherwise start counting captions.
create or replace view tracks.v_aip_totals
with (security_invoker = true) as
select
  a.id            as aip_id,
  a.period_id,
  a.department_id,
  a.kind,
  a.supplemental_no,
  a.status,
  d.code          as department_code,
  d.display_name  as department_name,
  d.code_number,
  d.sort_order    as department_sort,
  s.id            as sector_id,
  s.code          as sector_code,
  s.summary_label as sector_summary_label,
  s.sort_order    as sector_sort,
  count(p.id)                       as ppa_count,
  coalesce(sum(p.amount_ps),   0)   as total_ps,
  coalesce(sum(p.amount_mooe), 0)   as total_mooe,
  coalesce(sum(p.amount_fe),   0)   as total_fe,
  coalesce(sum(p.amount_co),   0)   as total_co,
  coalesce(sum(p.amount_total),0)   as total_amount
from tracks.aips a
join tracks.departments d on d.id = a.department_id
join tracks.sectors s     on s.id = d.sector_id
left join tracks.ppas p   on p.aip_id = a.id and p.row_kind = 'ppa'
group by a.id, a.period_id, a.department_id, a.kind, a.supplemental_no, a.status,
         d.code, d.display_name, d.code_number, d.sort_order,
         s.id, s.code, s.summary_label, s.sort_order;

create or replace view tracks.v_ppa_financials
with (security_invoker = true) as
select
  p.id                              as ppa_id,
  p.aip_id,
  p.department_id,
  p.description,
  p.amount_total                    as approved_amount,
  coalesce(al.total, 0)             as allotted,
  coalesce(ob.total, 0)             as obligated,
  coalesce(di.total, 0)             as disbursed,
  coalesce(al.total, 0) - coalesce(ob.total, 0)  as unobligated_balance,
  coalesce(ob.total, 0) - coalesce(di.total, 0)  as unpaid_obligations,
  case when coalesce(al.total, 0) > 0
       then round(coalesce(ob.total, 0) / al.total * 100, 2) end as obligation_rate,
  case when coalesce(al.total, 0) > 0
       then round(coalesce(di.total, 0) / al.total * 100, 2) end as disbursement_rate,
  pr.percent_complete               as physical_percent,
  pr.as_of_date                     as physical_as_of
from tracks.ppas p
left join lateral (
  select sum(amount) as total from tracks.allotments where ppa_id = p.id
) al on true
left join lateral (
  select sum(amount) as total from tracks.obligations
  where ppa_id = p.id and status = 'active'
) ob on true
left join lateral (
  select sum(amount) as total from tracks.disbursements
  where ppa_id = p.id and status = 'active'
) di on true
left join lateral (
  select percent_complete, as_of_date from tracks.ppa_progress
  where ppa_id = p.id order by as_of_date desc limit 1
) pr on true
where p.row_kind = 'ppa';

create or replace view tracks.v_monitoring
with (security_invoker = true) as
select
  r.id                as ppa_id,
  r.period_id,
  r.period_year,
  r.aip_id,
  r.aip_kind,
  r.department_id,
  r.department_code,
  r.department_name,
  r.sector_id,
  r.sector_code,
  r.sector_heading,
  r.item_no,
  r.ref_code,
  r.description,
  r.implementing_office,
  r.start_date,
  r.end_date,
  r.expected_output,
  r.funding_source,
  r.amount_total       as approved_amount,
  f.allotted,
  f.obligated,
  f.disbursed,
  f.unobligated_balance,
  f.unpaid_obligations,
  f.obligation_rate,
  f.disbursement_rate,
  f.physical_percent,
  f.physical_as_of,
  r.sort_order
from tracks.v_ppa_rows r
join tracks.v_ppa_financials f on f.ppa_id = r.id;

grant select on
  tracks.v_ppa_rows,
  tracks.v_ppa_financials,
  tracks.v_aip_totals,
  tracks.v_monitoring
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Inserting between two rows
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, deliberately. The workflow RPCs are DEFINER because they
-- must bypass RLS to move aips.status; this one must NOT bypass anything. Run
-- as the caller, every statement inside is still judged by ppas_insert and
-- ppas_update, so a locked AIP refuses the write exactly as it does from psql —
-- while the function body keeps the shift and the insert in one transaction, so
-- no one can observe two rows holding the same position.

create or replace function tracks.insert_ppa_row(
  p_aip_id    uuid,
  p_position  integer,
  p_row_kind  text,
  p_description text,
  p_ref_code  text default null,
  p_implementing_office text default null,
  p_start_date date default null,
  p_end_date   date default null,
  p_expected_output text default null,
  p_funding_source  text default null,
  p_amount_ps   numeric default 0,
  p_amount_mooe numeric default 0,
  p_amount_fe   numeric default 0,
  p_amount_co   numeric default 0
)
returns tracks.ppas
language plpgsql
security invoker
set search_path = tracks, public
as $$
declare
  v_department uuid;
  v_row        tracks.ppas;
begin
  if p_row_kind not in ('ppa', 'header') then
    raise exception 'Unknown row kind %.', p_row_kind using errcode = '22023';
  end if;

  -- Readable by anyone provisioned; the write policies below are the gate.
  select department_id into v_department from tracks.aips where id = p_aip_id;
  if v_department is null then
    raise exception 'AIP not found.' using errcode = 'P0002';
  end if;

  update tracks.ppas
     set sort_order = sort_order + 1
   where aip_id = p_aip_id and sort_order >= p_position;

  insert into tracks.ppas (
    aip_id, department_id, row_kind, sort_order, description,
    ref_code, implementing_office, start_date, end_date, expected_output,
    funding_source, amount_ps, amount_mooe, amount_fe, amount_co, created_by)
  values (
    p_aip_id, v_department, p_row_kind, p_position, p_description,
    case when p_row_kind = 'header' then null else p_ref_code end,
    case when p_row_kind = 'header' then null else p_implementing_office end,
    case when p_row_kind = 'header' then null else p_start_date end,
    case when p_row_kind = 'header' then null else p_end_date end,
    case when p_row_kind = 'header' then null else p_expected_output end,
    case when p_row_kind = 'header' then null else p_funding_source end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_ps, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_mooe, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_fe, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_co, 0) end,
    tracks.current_profile_id())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function tracks.insert_ppa_row(
  uuid, integer, text, text, text, text, date, date, text, text,
  numeric, numeric, numeric, numeric) from public;
grant execute on function tracks.insert_ppa_row(
  uuid, integer, text, text, text, text, date, date, text, text,
  numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 0013_row_review.sql
-- ---------------------------------------------------------------------------

-- 0013_row_review.sql
-- Per-row review, at two stages.
--
-- Until now a row could only be sent back: tracks.ppa_returns recorded City
-- Planning returning an item, and nothing recorded a row being passed. That
-- makes "every row has been checked" indistinguishable from "nobody has looked
-- yet", which is the question both the department head and the administrator
-- actually need answered before they sign anything.
--
-- Two stages, because two different people check the same row for different
-- reasons:
--
--   department  the head reads their own office's rows before submitting
--   planning    the City Planning Sector Officer reads them after
--
-- A decision is a fact about a moment, so this is an append-only log and the
-- current status is the latest row per (ppa, stage). ppa_reviews has no UPDATE
-- and no DELETE policy — like audit_logs and ppa_revisions, those operations are
-- denied to everyone, administrator included. An officer who changes their mind
-- records a second decision; they do not edit the first.

create table tracks.ppa_reviews (
  id           uuid primary key default gen_random_uuid(),
  ppa_id       uuid not null,
  -- Constant discriminator: a column-C caption carries no money and is not a
  -- line of the programme, so there is nothing about it to approve.
  ppa_row_kind text not null default 'ppa' check (ppa_row_kind = 'ppa'),
  stage        text not null check (stage in ('department', 'planning')),
  decision     text not null check (decision in ('approved', 'returned')),
  -- Optional when passing a row, required when sending one back: a department
  -- cannot act on "returned" with no reason attached.
  remarks      text check (remarks is null or length(trim(remarks)) > 0),
  reviewed_by  uuid references tracks.profiles(id),
  reviewed_at  timestamptz not null default now(),
  constraint ppa_reviews_return_needs_remarks check (
    decision <> 'returned' or (remarks is not null and length(trim(remarks)) > 0)),
  foreign key (ppa_id, ppa_row_kind)
    references tracks.ppas (id, row_kind) on delete cascade
);

create index ppa_reviews_ppa_idx on tracks.ppa_reviews (ppa_id, stage, reviewed_at desc);

alter table tracks.ppa_reviews enable row level security;
alter table tracks.ppa_reviews force row level security;

create policy ppa_reviews_read on tracks.ppa_reviews for select to authenticated
using (tracks.is_provisioned());

-- Insert only. The writing is done by review_ppa(), which is what enforces who
-- may decide what and when; this policy keeps the table from being written
-- around it by anyone without a role.
create policy ppa_reviews_insert on tracks.ppa_reviews for insert to authenticated
with check (tracks.is_provisioned());

grant select, insert on tracks.ppa_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- The current decision on a row, per stage
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_review_status
with (security_invoker = true) as
select
  p.id                                        as ppa_id,
  p.aip_id,
  coalesce(d.decision, 'pending')             as dept_status,
  d.remarks                                   as dept_remarks,
  d.reviewed_at                               as dept_reviewed_at,
  coalesce(n.decision, 'pending')             as planning_status,
  n.remarks                                   as planning_remarks,
  n.reviewed_at                               as planning_reviewed_at
from tracks.ppas p
left join lateral (
  select decision, remarks, reviewed_at from tracks.ppa_reviews r
  where r.ppa_id = p.id and r.stage = 'department'
  order by r.reviewed_at desc, r.id desc limit 1
) d on true
left join lateral (
  select decision, remarks, reviewed_at from tracks.ppa_reviews r
  where r.ppa_id = p.id and r.stage = 'planning'
  order by r.reviewed_at desc, r.id desc limit 1
) n on true
where p.row_kind = 'ppa';

grant select on tracks.v_ppa_review_status to authenticated;

-- ---------------------------------------------------------------------------
-- The stage a row is being read at, from the AIP's own status
-- ---------------------------------------------------------------------------

create or replace function tracks.review_stage_for(p_aip_status text)
returns text
language sql
immutable
as $$
  select case when p_aip_status = 'draft' then 'department' else 'planning' end;
$$;

-- ---------------------------------------------------------------------------
-- can_edit_ppa — approval freezes a row, and finalising freezes the programme
-- ---------------------------------------------------------------------------
--
-- Two rules are added to the submission lock:
--
--   * An approved row is frozen. The point of a head's approval is that what
--     they approved is what gets submitted; a row that can still change
--     underneath it is a signature on a blank page. To change it, the approval
--     is withdrawn first — which is a second entry in the log, on the record.
--   * Once the period leaves 'consolidating' the programme has left the
--     building for the LDC. Nobody edits it, City Planning included.

create or replace function tracks.can_edit_ppa(p_ppa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.ppas p
    join tracks.aips a          on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    left join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
    where p.id = p_ppa_id
      and p.row_kind = 'ppa'
      and per.status in ('open', 'consolidating')
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and p.department_id = tracks.current_department_id()
          -- Frozen once the head has passed it, at whichever stage applies.
          and coalesce(
                case when a.status = 'draft' then rs.dept_status
                     else rs.planning_status end, 'pending') <> 'approved'
          and (
            a.status = 'draft'
            or (a.status = 'returned' and exists (
                  select 1 from tracks.ppa_returns r
                  where r.ppa_id = p.id and r.resolved_at is null))
          )
        )
      )
  );
$$;

-- A caption has no review of its own, so it follows the AIP's structural lock.
create or replace function tracks.can_edit_row(p_row_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select case
    when (select row_kind from tracks.ppas where id = p_row_id) = 'header'
      then tracks.can_modify_aip_structure(
             (select aip_id from tracks.ppas where id = p_row_id))
    else tracks.can_edit_ppa(p_row_id)
  end;
$$;

create or replace function tracks.can_modify_aip_structure(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.aips a
    join tracks.aip_periods per on per.id = a.period_id
    where a.id = p_aip_id
      and per.status in ('open', 'consolidating')
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and a.department_id = tracks.current_department_id()
          and a.status = 'draft'
        )
      )
  );
$$;

-- ppas_update must consult the row's kind, or a heading becomes uneditable the
-- moment can_edit_ppa starts filtering on row_kind = 'ppa'.
drop policy ppas_update on tracks.ppas;
create policy ppas_update on tracks.ppas for update to authenticated
using (tracks.can_edit_row(id))
with check (tracks.can_edit_row(id));

revoke execute on function tracks.can_edit_row(uuid) from public;
grant execute on function tracks.can_edit_row(uuid) to authenticated;
grant execute on function tracks.review_stage_for(text) to authenticated;

-- ---------------------------------------------------------------------------
-- tracks.review_ppa(ppa_id, decision, remarks)
-- ---------------------------------------------------------------------------
--
-- One entry point for both stages. Who may decide follows from the AIP's own
-- status rather than from an argument, so a department head cannot record a
-- planning decision by passing a different stage.

create or replace function tracks.review_ppa(
  p_ppa_id uuid,
  p_decision text,
  p_remarks text default null
)
returns tracks.ppa_reviews
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_ppa    tracks.ppas;
  v_aip    tracks.aips;
  v_period text;
  v_stage  text;
  v_review tracks.ppa_reviews;
begin
  if p_decision not in ('approved', 'returned') then
    raise exception 'Unknown decision %.', p_decision using errcode = '22023';
  end if;

  select * into v_ppa from tracks.ppas where id = p_ppa_id;
  if not found then
    raise exception 'Row not found.' using errcode = 'P0002';
  end if;
  if v_ppa.row_kind <> 'ppa' then
    raise exception 'A column-C heading is not reviewed — it carries no programme.'
      using errcode = '22023';
  end if;

  select * into v_aip from tracks.aips where id = v_ppa.aip_id;
  select status into v_period from tracks.aip_periods where id = v_aip.period_id;

  if v_period not in ('open', 'consolidating') then
    raise exception 'The programme has gone to the LDC. Reviewing is closed.'
      using errcode = '42501';
  end if;

  v_stage := tracks.review_stage_for(v_aip.status);

  if v_stage = 'department' then
    if not (tracks.has_role(array['dept_head'])
            and v_ppa.department_id = tracks.current_department_id()) then
      raise exception 'Only the department head of this office reviews its rows.'
        using errcode = '42501';
    end if;
  else
    if not tracks.is_planning() then
      raise exception 'Only the City Planning Office reviews a submitted AIP.'
        using errcode = '42501';
    end if;
    if v_aip.status = 'accepted' then
      raise exception 'This AIP has been accepted. Reopen it to review it again.'
        using errcode = '42501';
    end if;
  end if;

  if p_decision = 'returned'
     and (p_remarks is null or length(trim(p_remarks)) = 0) then
    raise exception 'Say what needs correcting before sending a row back.'
      using errcode = '23514';
  end if;

  insert into tracks.ppa_reviews (ppa_id, stage, decision, remarks, reviewed_by)
  values (p_ppa_id, v_stage, p_decision, nullif(trim(p_remarks), ''),
          tracks.current_profile_id())
  returning * into v_review;

  -- At the planning stage a return is the existing paper trail: the item
  -- reopens for the department and the AIP goes back with it.
  if v_stage = 'planning' then
    if p_decision = 'returned' then
      insert into tracks.ppa_returns (ppa_id, reason, returned_by)
      values (p_ppa_id, p_remarks, tracks.current_profile_id());

      update tracks.aips set status = 'returned'
       where id = v_aip.id and status in ('submitted', 'returned');
    else
      -- Approving closes any return still open on the row.
      update tracks.ppa_returns
         set resolved_at = now(), resolved_by = tracks.current_profile_id()
       where ppa_id = p_ppa_id and resolved_at is null;
    end if;
  end if;

  perform tracks.write_audit(
    case when p_decision = 'approved' then 'PPA_APPROVED' else 'PPA_RETURNED' end,
    'ppa', p_ppa_id, null,
    jsonb_build_object('stage', v_stage, 'remarks', p_remarks));

  return v_review;
end;
$$;

revoke execute on function tracks.review_ppa(uuid, text, text) from public;
grant execute on function tracks.review_ppa(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_aip — every row approved by the head first
-- ---------------------------------------------------------------------------

create or replace function tracks.submit_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip       tracks.aips;
  v_open      integer;
  v_rows      integer;
  v_unchecked integer;
  v_period    text;
begin
  select * into v_aip from tracks.aips where id = p_aip_id;

  if not found then
    raise exception 'AIP not found.' using errcode = 'P0002';
  end if;

  select per.status into v_period
  from tracks.aip_periods per where per.id = v_aip.period_id;

  if not (tracks.has_role(array['dept_head'])
          and v_aip.department_id = tracks.current_department_id()) then
    raise exception 'Only the department head of this office may submit its AIP.'
      using errcode = '42501';
  end if;

  if v_period not in ('open', 'consolidating') then
    raise exception 'The % AIP period is no longer accepting submissions.', v_period
      using errcode = '42501';
  end if;

  if v_aip.status not in ('draft', 'returned') then
    raise exception 'This AIP is already %.', v_aip.status using errcode = '42501';
  end if;

  select count(*) into v_rows
  from tracks.ppas where aip_id = p_aip_id and row_kind = 'ppa';
  if v_rows = 0 then
    raise exception 'Cannot submit an AIP with no PPAs.' using errcode = '23514';
  end if;

  -- The head signs for every line, not for the folder. A row nobody has read is
  -- the thing this check exists to catch.
  select count(*) into v_unchecked
  from tracks.ppas p
  join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
  where p.aip_id = p_aip_id and p.row_kind = 'ppa' and rs.dept_status <> 'approved';

  if v_unchecked > 0 then
    raise exception
      'Approve every row before submitting — % still waiting.', v_unchecked
      using errcode = '23514';
  end if;

  select count(*) into v_open
  from tracks.ppa_returns r
  join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Resolve the % returned item(s) before resubmitting.', v_open
      using errcode = '23514';
  end if;

  update tracks.aips
     set status       = 'submitted',
         submitted_at = now(),
         submitted_by = tracks.current_profile_id()
   where id = p_aip_id
   returning * into v_aip;

  perform tracks.write_audit('AIP_SUBMITTED', 'aip', p_aip_id, null,
                             jsonb_build_object('ppa_count', v_rows));
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.finalize_aip_period(period_id) — the administrator's one action
-- ---------------------------------------------------------------------------
--
-- Accepts every submitted department AIP and closes the programme for editing
-- in a single transaction, because the thing that goes to the LDC is one
-- document. It refuses while any row anywhere is still waiting on the City
-- Planning Office or has been sent back — an administrator cannot sign off a
-- programme with a correction outstanding in it.

create or replace function tracks.finalize_aip_period(p_period_id uuid)
returns tracks.aip_periods
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_period    tracks.aip_periods;
  v_pending   integer;
  v_returned  integer;
  v_undelivered integer;
  v_accepted  integer;
begin
  perform tracks.require_role(array['planning_admin']);

  select * into v_period from tracks.aip_periods where id = p_period_id;
  if not found then
    raise exception 'AIP period not found.' using errcode = 'P0002';
  end if;
  if v_period.status not in ('open', 'consolidating') then
    raise exception 'This programme has already gone forward — it is %.',
      v_period.status using errcode = '42501';
  end if;

  select count(*) into v_undelivered
  from tracks.aips a
  where a.period_id = p_period_id and a.status in ('draft', 'returned');
  if v_undelivered > 0 then
    raise exception
      '% department AIP(s) are still with their office.', v_undelivered
      using errcode = '23514';
  end if;

  select
    count(*) filter (where rs.planning_status = 'pending'),
    count(*) filter (where rs.planning_status = 'returned')
    into v_pending, v_returned
  from tracks.ppas p
  join tracks.aips a on a.id = p.aip_id
  join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
  where a.period_id = p_period_id and p.row_kind = 'ppa';

  if v_returned > 0 then
    raise exception '% row(s) are out for revision.', v_returned
      using errcode = '23514';
  end if;
  if v_pending > 0 then
    raise exception '% row(s) have not been checked yet.', v_pending
      using errcode = '23514';
  end if;

  update tracks.aips
     set status      = 'accepted',
         accepted_at = coalesce(accepted_at, now()),
         accepted_by = coalesce(accepted_by, tracks.current_profile_id())
   where period_id = p_period_id and status = 'submitted';
  get diagnostics v_accepted = row_count;

  update tracks.aip_periods
     set status = 'for_ldc'
   where id = p_period_id
   returning * into v_period;

  perform tracks.write_audit('PERIOD_FINALIZED', 'aip_period', p_period_id, null,
                             jsonb_build_object('aips_accepted', v_accepted));
  return v_period;
end;
$$;

revoke execute on function tracks.finalize_aip_period(uuid) from public;
grant execute on function tracks.finalize_aip_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- v_ppa_rows carries the decision, so the grid reads one view
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW may only
-- append columns, and these belong beside the row they describe.

drop view if exists tracks.v_monitoring;
drop view if exists tracks.v_ppa_rows;

create view tracks.v_ppa_rows
with (security_invoker = true) as
select
  p.id,
  p.aip_id,
  a.period_id,
  per.year                      as period_year,
  per.status                    as period_status,
  a.kind                        as aip_kind,
  a.supplemental_no,
  a.status                      as aip_status,
  p.department_id,
  d.code                        as department_code,
  d.display_name                as department_name,
  d.sort_order                  as department_sort,
  s.id                          as sector_id,
  s.code                        as sector_code,
  s.heading                     as sector_heading,
  s.sheet_name                  as sector_sheet_name,
  s.sort_order                  as sector_sort,
  p.row_kind,
  case when p.row_kind = 'ppa' then
    row_number() over (
      partition by p.aip_id, p.row_kind
      order by p.sort_order, p.created_at)
  end                           as item_no,
  p.ref_code,
  p.description,
  p.implementing_office,
  p.start_date,
  p.end_date,
  p.expected_output,
  p.funding_source,
  p.amount_ps,
  p.amount_mooe,
  p.amount_fe,
  p.amount_co,
  p.amount_total,
  p.cca_amount,
  p.ccm_amount,
  p.cc_typology_code,
  p.continues_ppa_id,
  p.sort_order,
  rs.dept_status,
  rs.dept_remarks,
  rs.planning_status,
  rs.planning_remarks,
  -- What this row is waiting on right now, given where the AIP has got to.
  case
    when p.row_kind = 'header' then null
    when a.status = 'draft' then rs.dept_status
    else rs.planning_status
  end                           as review_status,
  case
    when p.row_kind = 'header' then null
    when a.status = 'draft' then rs.dept_remarks
    else rs.planning_remarks
  end                           as review_remarks,
  r.id                          as open_return_id,
  r.reason                      as open_return_reason,
  r.returned_at                 as open_return_at,
  (r.id is not null)            as is_returned,
  p.created_at,
  p.updated_at
from tracks.ppas p
join tracks.aips a          on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d   on d.id = p.department_id
join tracks.sectors s       on s.id = d.sector_id
left join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null;

grant select on tracks.v_ppa_rows to authenticated;

-- Restated because it reads from the view above and was dropped with it.
create view tracks.v_monitoring
with (security_invoker = true) as
select
  r.id                as ppa_id,
  r.period_id,
  r.period_year,
  r.aip_id,
  r.aip_kind,
  r.department_id,
  r.department_code,
  r.department_name,
  r.sector_id,
  r.sector_code,
  r.sector_heading,
  r.item_no,
  r.ref_code,
  r.description,
  r.implementing_office,
  r.start_date,
  r.end_date,
  r.expected_output,
  r.funding_source,
  r.amount_total       as approved_amount,
  f.allotted,
  f.obligated,
  f.disbursed,
  f.unobligated_balance,
  f.unpaid_obligations,
  f.obligation_rate,
  f.disbursement_rate,
  f.physical_percent,
  f.physical_as_of,
  r.sort_order
from tracks.v_ppa_rows r
join tracks.v_ppa_financials f on f.ppa_id = r.id;

grant select on tracks.v_monitoring to authenticated;

-- ---------------------------------------------------------------------------
-- insert_ppa_row — moving a row is not editing it
-- ---------------------------------------------------------------------------
--
-- 0012 made this SECURITY INVOKER so ppas_insert and ppas_update judged it
-- exactly as they judge a plain write. Freezing approved rows breaks that: the
-- shift that makes room is an UPDATE of sort_order, so inserting above an
-- approved row would silently skip it and leave two rows sharing a position.
--
-- A row's position is not its content. So the function now names the rule it is
-- actually subject to — can_modify_aip_structure, the same predicate as
-- ppas_insert — and checks it explicitly before touching anything. That is the
-- one thing a DEFINER function owes you in this codebase: the lock it bypasses
-- has to be written out where it can be read.

create or replace function tracks.insert_ppa_row(
  p_aip_id    uuid,
  p_position  integer,
  p_row_kind  text,
  p_description text,
  p_ref_code  text default null,
  p_implementing_office text default null,
  p_start_date date default null,
  p_end_date   date default null,
  p_expected_output text default null,
  p_funding_source  text default null,
  p_amount_ps   numeric default 0,
  p_amount_mooe numeric default 0,
  p_amount_fe   numeric default 0,
  p_amount_co   numeric default 0
)
returns tracks.ppas
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_department uuid;
  v_row        tracks.ppas;
begin
  if p_row_kind not in ('ppa', 'header') then
    raise exception 'Unknown row kind %.', p_row_kind using errcode = '22023';
  end if;

  select department_id into v_department from tracks.aips where id = p_aip_id;
  if v_department is null then
    raise exception 'AIP not found.' using errcode = 'P0002';
  end if;

  if not tracks.can_modify_aip_structure(p_aip_id) then
    raise exception 'This AIP is locked. Rows can only be added while it is a draft.'
      using errcode = '42501';
  end if;

  update tracks.ppas
     set sort_order = sort_order + 1
   where aip_id = p_aip_id and sort_order >= p_position;

  insert into tracks.ppas (
    aip_id, department_id, row_kind, sort_order, description,
    ref_code, implementing_office, start_date, end_date, expected_output,
    funding_source, amount_ps, amount_mooe, amount_fe, amount_co, created_by)
  values (
    p_aip_id, v_department, p_row_kind, p_position, p_description,
    case when p_row_kind = 'header' then null else p_ref_code end,
    case when p_row_kind = 'header' then null else p_implementing_office end,
    case when p_row_kind = 'header' then null else p_start_date end,
    case when p_row_kind = 'header' then null else p_end_date end,
    case when p_row_kind = 'header' then null else p_expected_output end,
    case when p_row_kind = 'header' then null else p_funding_source end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_ps, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_mooe, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_fe, 0) end,
    case when p_row_kind = 'header' then 0 else coalesce(p_amount_co, 0) end,
    tracks.current_profile_id())
  returning * into v_row;

  return v_row;
end;
$$;

-- A frozen row cannot be deleted either. Freezing edits but not deletion would
-- leave the head's approval standing over a row that is simply gone.
drop policy ppas_delete on tracks.ppas;
create policy ppas_delete on tracks.ppas for delete to authenticated
using (
  tracks.can_modify_aip_structure(aip_id)
  and (
    tracks.is_planning()
    or row_kind = 'header'
    or coalesce((select rs.dept_status from tracks.v_ppa_review_status rs
                  where rs.ppa_id = id), 'pending') <> 'approved'
  )
);

commit;
