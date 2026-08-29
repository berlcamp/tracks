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

-- ---------------------------------------------------------------------------
-- 0014_row_authorship.sql
-- ---------------------------------------------------------------------------

-- 0014_row_authorship.sql
-- An encoder owns what they wrote.
--
-- A department can have several encoders — user_roles.profile_id is unique per
-- PERSON, not per department, so nothing stopped that already. What was missing
-- is that all of them could edit each other's rows: two people working the same
-- office's programme could overwrite one another with nothing on screen to say
-- whose line it was.
--
--   dept_encoder  may edit and delete only the rows they authored
--   dept_head     may edit and delete any row in their own office — the head
--                 signs for the whole submission, so they must be able to fix it
--   planning      unchanged: City Planning may edit anything until the period
--                 leaves 'consolidating'
--
-- UNOWNED ROWS. ppas.created_by is null on everything that arrived through
-- seed.sql or through 0012's fold of ppa_groups — nobody is recorded as having
-- written those. Enforcing ownership strictly would freeze every one of them out
-- of an encoder's reach on the day this is applied, which is a worse failure
-- than the one it fixes. A row with no recorded author is therefore open to any
-- encoder of its department, and every row created from now on has one.

create or replace function tracks.owns_row(p_row_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.ppas p
    where p.id = p_row_id
      and (
        -- The head answers for the office's whole submission.
        tracks.has_role(array['dept_head'])
        or p.created_by is null                       -- no author on record
        or p.created_by = tracks.current_profile_id()
      )
  );
$$;

revoke execute on function tracks.owns_row(uuid) from public;
grant execute on function tracks.owns_row(uuid) to authenticated;

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
          and tracks.owns_row(p.id)
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

-- A caption follows the AIP's structural lock, and its author too: a heading one
-- encoder typed is not another's to rewrite.
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
           and (tracks.is_planning() or tracks.owns_row(p_row_id))
    else tracks.can_edit_ppa(p_row_id)
  end;
$$;

drop policy ppas_delete on tracks.ppas;
create policy ppas_delete on tracks.ppas for delete to authenticated
using (
  tracks.can_modify_aip_structure(aip_id)
  and (tracks.is_planning() or tracks.owns_row(id))
  and (
    tracks.is_planning()
    or row_kind = 'header'
    or coalesce((select rs.dept_status from tracks.v_ppa_review_status rs
                  where rs.ppa_id = id), 'pending') <> 'approved'
  )
);

-- ---------------------------------------------------------------------------
-- Who wrote the row, on screen
-- ---------------------------------------------------------------------------
--
-- Appended rather than inserted mid-list, so v_monitoring survives the replace.
-- Not printed: like the review column, this is for the people working the
-- document, not for the form that goes to the LDC.

create or replace view tracks.v_ppa_rows
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
  p.updated_at,
  p.created_by,
  au.full_name                  as author_name
from tracks.ppas p
join tracks.aips a          on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d   on d.id = p.department_id
join tracks.sectors s       on s.id = d.sector_id
left join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null
left join tracks.profiles au on au.id = p.created_by;

grant select on tracks.v_ppa_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 0015_accept_requires_review.sql
-- ---------------------------------------------------------------------------

-- 0015_accept_requires_review.sql
-- Accepting an AIP means City Planning has read it.
--
-- accept_aip() was written in 0007, before per-row review existed, and it only
-- ever asked whether anything was out for revision. 0013 added the second
-- reading and made finalize_aip_period() refuse while a row is unread — but
-- accept_aip() was left as it was, so the two disagreed:
--
--   * accept_aip()          would accept an AIP nobody had read line by line
--   * finalize_aip_period() would then refuse the whole programme, naming rows
--     the administrator has no way to reach — review_ppa() will not record a
--     planning decision on an AIP that is already 'accepted'
--
-- The only way out of that state was to reopen the submission, which sends it
-- back to the department as a draft. An office that did nothing wrong has to
-- resubmit so that a check the Planning Office skipped can be run.
--
-- So accept_aip() now asks the same question finalize_aip_period() asks, and
-- asks it while the answer can still be acted on. Accepting is City Planning's
-- signature on the lines, exactly as submitting is the head's.
--
-- 'returned' counts as unapproved as much as 'pending' does. A department can
-- resolve a return — which closes the ppa_returns entry the old check looked
-- at — without the Planning Office having read the correction, and a row whose
-- last recorded decision is "send this back" is not a row anybody has passed.

create or replace function tracks.accept_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip        tracks.aips;
  v_open       integer;
  v_unapproved integer;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  select count(*) into v_open
  from tracks.ppa_returns r join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Cannot accept an AIP with % unresolved returned item(s).', v_open
      using errcode = '23514';
  end if;

  -- Every line read, not the folder. After this the rows are frozen and
  -- review_ppa() will not take another decision on them, so this is the last
  -- moment the question can be asked.
  select count(*) into v_unapproved
  from tracks.ppas p
  join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
  where p.aip_id = p_aip_id and p.row_kind = 'ppa'
    and rs.planning_status <> 'approved';

  if v_unapproved > 0 then
    raise exception
      'Read every row before accepting — % still waiting.', v_unapproved
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

revoke execute on function tracks.accept_aip(uuid) from public;
grant execute on function tracks.accept_aip(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 0016_statutory_funds.sql
-- ---------------------------------------------------------------------------

-- 0016_statutory_funds.sql
-- The statutory funds a department files alongside its annual programme.
--
-- CLAUDE.md said these sheets were out of scope, and that was a decision taken
-- from the workbook rather than guessed: only the sector sheets and SUMMARY
-- were modelled. This reverses it, because the office files the 20% CDF, the
-- 5% CDRRMF, the 5% GAD and the 1% LCPC every year and was keeping them in a
-- spreadsheet beside the one this application prints.
--
-- The shape, and why:
--
--   * A fund is REFERENCE DATA, not four hard-coded columns. The 1% LCPC was
--     not 1% forever and there will be a fifth mandated fund; a table means an
--     admin screen where a boolean column would mean a migration.
--
--   * A department's filing is an ORDINARY `aips` ROW carrying `fund_id`. Not a
--     second PPA table: `ppa_reviews`, `ppa_returns`, `ppa_revisions`,
--     `allotments`, `obligations`, `disbursements` and `ppa_progress` all point
--     at `ppas`, and a parallel table would need every one of them again and
--     would drift from them by the second release.
--
--   * `kind` keeps meaning "annual or supplemental". `fund_id` says which
--     programme. A mid-year addition to the CDF is therefore
--     kind='supplemental', fund_id=<CDF> and needs no new concept.
--
--   * A statutory row is NOT linked to any annual row. A project encoded in
--     both places is two independent rows and nothing here knows they are the
--     same road. That is a known, accepted consequence of filing them as
--     separate documents with their own rows.

-- ---------------------------------------------------------------------------
-- 1. The funds themselves
-- ---------------------------------------------------------------------------

create table tracks.statutory_funds (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code = upper(code)),  -- 'CDF20'
  name        text not null,                                    -- '20% Development Fund'
  short_label text not null,                                    -- '20% CDF' — buttons, chips
  sheet_name  text not null unique,                             -- the exported worksheet tab
  -- The share of the base the programme may not exceed. Stored as a percentage
  -- (20.00, not 0.20) because that is how the office says it and how the
  -- statute writes it.
  percentage  numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index statutory_funds_order_idx on tracks.statutory_funds (sort_order) where active;

create trigger statutory_funds_set_updated_at
  before update on tracks.statutory_funds
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Who may file which fund
--
-- Many departments per fund. Removing a department here stops it STARTING a new
-- document; it never touches one already filed. A settings edit that deleted an
-- office's encoded rows would be a settings edit nobody could safely make.
-- ---------------------------------------------------------------------------

create table tracks.statutory_fund_departments (
  fund_id       uuid not null references tracks.statutory_funds(id) on delete cascade,
  department_id uuid not null references tracks.departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (fund_id, department_id)
);

create index statutory_fund_departments_dept_idx
  on tracks.statutory_fund_departments (department_id);

-- ---------------------------------------------------------------------------
-- 3. The year's base, and therefore the ceiling
--
-- The 20% CDF is 20% of the NTA share; the 5% CDRRMF is 5% of estimated revenue
-- from regular sources. Different bases, so the figure hangs off (fund, period)
-- rather than off the period alone.
--
-- The ceiling is CITY-WIDE while each department files its own document, so
-- "programmed against ceiling" is only a true statement consolidated. It is
-- never enforced: a department encoding in September cannot be blocked by what
-- another office entered in August, and an obvious overage beats a refused row.
-- ---------------------------------------------------------------------------

create table tracks.statutory_fund_periods (
  fund_id     uuid not null references tracks.statutory_funds(id) on delete cascade,
  period_id   uuid not null references tracks.aip_periods(id) on delete cascade,
  base_amount numeric(16,2) not null default 0 check (base_amount >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (fund_id, period_id)
);

create trigger statutory_fund_periods_set_updated_at
  before update on tracks.statutory_fund_periods
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. aips.fund_id
--
-- Nullable: null is the annual investment programme itself, which is what every
-- existing row is.
-- ---------------------------------------------------------------------------

alter table tracks.aips
  add column fund_id uuid references tracks.statutory_funds(id) on delete restrict;

create index aips_fund_idx on tracks.aips (fund_id) where fund_id is not null;

-- The two uniqueness rules have to learn about the fund, and a bare nullable
-- column will not do it: NULLs do not collide in a unique index, so
-- (period, department, null) would stop constraining anything and a department
-- could open a second annual AIP. Fold the null to a fixed uuid instead.
--
-- The sentinel is only ever an index expression — it is never stored, and
-- nothing reads it back.

drop index tracks.aips_one_annual_idx;
create unique index aips_one_annual_idx
  on tracks.aips (
    period_id,
    department_id,
    coalesce(fund_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'annual';

drop index tracks.aips_supplemental_no_idx;
create unique index aips_supplemental_no_idx
  on tracks.aips (
    period_id,
    department_id,
    coalesce(fund_id, '00000000-0000-0000-0000-000000000000'::uuid),
    supplemental_no)
  where kind = 'supplemental';

-- ---------------------------------------------------------------------------
-- 5. Eligibility is enforced here, not in the form
--
-- `createAip` inserts through the RLS-bound client, so a policy is the only
-- thing standing between a department user and a document for a fund their
-- office does not administer.
-- ---------------------------------------------------------------------------

drop policy aips_department_insert on tracks.aips;
create policy aips_department_insert on tracks.aips for insert to authenticated
with check (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and department_id = tracks.current_department_id()
  and exists (select 1 from tracks.aip_periods per
               where per.id = period_id and per.status not in ('approved', 'closed'))
  and (
    fund_id is null
    or exists (
      select 1
      from tracks.statutory_fund_departments fd
      join tracks.statutory_funds f on f.id = fd.fund_id
      where fd.fund_id = aips.fund_id
        and fd.department_id = aips.department_id
        and f.active
    )
  )
);

-- ---------------------------------------------------------------------------
-- 6. Reading the reference data
-- ---------------------------------------------------------------------------

alter table tracks.statutory_funds             enable row level security;
alter table tracks.statutory_fund_departments  enable row level security;
alter table tracks.statutory_fund_periods      enable row level security;

create policy statutory_funds_read on tracks.statutory_funds
  for select to authenticated using (tracks.is_provisioned());
create policy statutory_funds_admin_write on tracks.statutory_funds
  for all to authenticated
  using (tracks.is_planning_admin()) with check (tracks.is_planning_admin());

create policy statutory_fund_departments_read on tracks.statutory_fund_departments
  for select to authenticated using (tracks.is_provisioned());
create policy statutory_fund_departments_admin_write on tracks.statutory_fund_departments
  for all to authenticated
  using (tracks.is_planning_admin()) with check (tracks.is_planning_admin());

create policy statutory_fund_periods_read on tracks.statutory_fund_periods
  for select to authenticated using (tracks.is_provisioned());
create policy statutory_fund_periods_admin_write on tracks.statutory_fund_periods
  for all to authenticated
  using (tracks.is_planning_admin()) with check (tracks.is_planning_admin());

grant select on tracks.statutory_funds, tracks.statutory_fund_departments,
                tracks.statutory_fund_periods to authenticated;
grant insert, update, delete on tracks.statutory_funds,
                tracks.statutory_fund_departments,
                tracks.statutory_fund_periods to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The views carry the fund
--
-- Every one of these is a replace of the definition standing after 0014, with
-- the fund columns added and nothing else touched. v_sector_totals and
-- v_period_totals gain fund_id in their grouping — without it a statutory
-- document (kind='annual') would be summed into the annual programme's
-- GRAND TOTAL, which is the one thing this design forbids.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_ppa_rows
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
  p.updated_at,
  p.created_by,
  au.full_name                  as author_name,
  -- Appended, so anything selecting by position still lines up.
  a.fund_id,
  sf.code                       as fund_code,
  sf.short_label                as fund_label
from tracks.ppas p
join tracks.aips a          on a.id = p.aip_id
join tracks.aip_periods per on per.id = a.period_id
join tracks.departments d   on d.id = p.department_id
join tracks.sectors s       on s.id = d.sector_id
left join tracks.statutory_funds sf on sf.id = a.fund_id
left join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
left join tracks.ppa_returns r on r.ppa_id = p.id and r.resolved_at is null
left join tracks.profiles au on au.id = p.created_by;

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
  coalesce(sum(p.amount_total),0)   as total_amount,
  a.fund_id,
  sf.code         as fund_code,
  sf.short_label  as fund_label
from tracks.aips a
join tracks.departments d on d.id = a.department_id
join tracks.sectors s     on s.id = d.sector_id
left join tracks.statutory_funds sf on sf.id = a.fund_id
left join tracks.ppas p   on p.aip_id = a.id and p.row_kind = 'ppa'
group by a.id, a.period_id, a.department_id, a.kind, a.supplemental_no, a.status,
         d.code, d.display_name, d.code_number, d.sort_order,
         s.id, s.code, s.summary_label, s.sort_order,
         a.fund_id, sf.code, sf.short_label;

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
  sum(t.total_amount) as total_amount,
  -- Appended, not inserted: `create or replace view` may only add columns at
  -- the end, and dropping these two would take v_period_totals with them.
  t.fund_id
from tracks.v_aip_totals t
group by t.period_id, t.sector_id, t.sector_code, t.sector_summary_label,
         t.sector_sort, t.kind, t.fund_id;

create or replace view tracks.v_period_totals
with (security_invoker = true) as
select
  period_id,
  kind,
  sum(total_ps)     as total_ps,
  sum(total_mooe)   as total_mooe,
  sum(total_fe)     as total_fe,
  sum(total_co)     as total_co,
  sum(total_amount) as total_amount,
  fund_id
from tracks.v_sector_totals
group by period_id, kind, fund_id;

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
  r.sort_order,
  r.fund_id,
  r.fund_code,
  r.fund_label
from tracks.v_ppa_rows r
join tracks.v_ppa_financials f on f.ppa_id = r.id;

-- ---------------------------------------------------------------------------
-- 8. Programmed against the ceiling
--
-- A view, like every other total in this schema. Nothing in TypeScript re-adds
-- a column of pesos, and the compliance figure is exactly the kind of number
-- that must not be computed twice in two places.
--
-- Left join from the funds so a fund with no filings still reports its ceiling
-- and a programmed total of zero. A period with no base entered yet reports a
-- null ceiling rather than a ceiling of zero — "not stated" and "nothing" are
-- different answers and the screen shows a dash for the first.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_statutory_fund_totals
with (security_invoker = true) as
select
  f.id                                  as fund_id,
  f.code                                as fund_code,
  f.name                                as fund_name,
  f.short_label                         as fund_label,
  f.sheet_name,
  f.percentage,
  f.sort_order,
  f.active,
  per.id                                as period_id,
  per.year                              as period_year,
  fp.base_amount,
  case when fp.base_amount is not null
       then round(fp.base_amount * f.percentage / 100, 2) end  as ceiling_amount,
  coalesce(t.total_amount, 0)           as programmed_amount,
  case when fp.base_amount is not null
       then round(fp.base_amount * f.percentage / 100, 2)
            - coalesce(t.total_amount, 0) end                  as remaining_amount,
  coalesce(t.document_count, 0)         as document_count
from tracks.statutory_funds f
cross join tracks.aip_periods per
left join tracks.statutory_fund_periods fp
       on fp.fund_id = f.id and fp.period_id = per.id
left join (
  select fund_id, period_id,
         sum(total_amount) as total_amount,
         count(*)          as document_count
  from tracks.v_aip_totals
  where fund_id is not null
  group by fund_id, period_id
) t on t.fund_id = f.id and t.period_id = per.id;

grant select on tracks.v_statutory_fund_totals to authenticated;

-- ---------------------------------------------------------------------------
-- 9. finalize_aip_period() ignores statutory documents
--
-- The programme the LDC votes on is the annual investment programme. A
-- statutory filing is a mandated attachment beside it, so an unfinished 1% LCPC
-- must not hold the whole city's finalisation — which is exactly what the old
-- text did, since it counted every aips row in the period and named none of
-- them.
--
-- Otherwise unchanged from 0013.
-- ---------------------------------------------------------------------------

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
  where a.period_id = p_period_id
    and a.fund_id is null
    and a.status in ('draft', 'returned');
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
  where a.period_id = p_period_id and a.fund_id is null and p.row_kind = 'ppa';

  if v_returned > 0 then
    raise exception '% row(s) are out for revision.', v_returned
      using errcode = '23514';
  end if;
  if v_pending > 0 then
    raise exception '% row(s) have not been checked yet.', v_pending
      using errcode = '23514';
  end if;

  -- Only the annual programme is accepted here. A statutory document is
  -- accepted one at a time by accept_aip(), which is unchanged.
  update tracks.aips
     set status      = 'accepted',
         accepted_at = coalesce(accepted_at, now()),
         accepted_by = coalesce(accepted_by, tracks.current_profile_id())
   where period_id = p_period_id and fund_id is null and status = 'submitted';
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

grant select on
  tracks.v_ppa_rows,
  tracks.v_aip_totals,
  tracks.v_sector_totals,
  tracks.v_period_totals,
  tracks.v_monitoring
to authenticated;

-- ---------------------------------------------------------------------------
-- 0017_presentation_reports.sql
-- ---------------------------------------------------------------------------

-- 0017_presentation_reports.sql
-- The City Planning Office's presentation deck: the Annual Investment Program
-- as it is shown to the Mayor, the LDC and the City Council.
--
-- READ THIS FIRST. Nothing here is a new source of truth.
--
--   * Every peso in the deck is `ppas.amount_total` — the generated column the
--     AIP workbook prints — summed over the same rows `v_aip_totals` counts
--     (`row_kind = 'ppa'`). 09_presentation.sql asserts the deck's grand total
--     against `v_period_totals`, its sector totals against `v_sector_totals`
--     and its office totals against `v_aip_totals`, so the slide behind the
--     Mayor and the workbook on his desk cannot say different numbers.
--
--   * Execution figures come from `v_ppa_financials`, unchanged.
--
--   * NOTHING is added up in TypeScript. That is the whole reason this is a
--     function returning one document rather than nine endpoints: every slide
--     is aggregated once, in SQL, from one snapshot of one query — so the
--     Executive Summary's total and the Sector slide's bars cannot drift apart
--     between two round trips while somebody is presenting.
--
--   * A drill-down filter (sector, office, funding source, status, barangay)
--     recomputes the totals over the visible rows and sets `filtered`, which
--     the slides caption. That is the rule the grid already follows: a subtotal
--     that silently included hidden rows would be worse than no subtotal.
--
-- The document being presented is (period, kind, fund) exactly as the
-- consolidated view defines it. A statutory fund is a document of its own and
-- is never folded into the annual programme's figures — `fund_id is not
-- distinct from p_fund_id` is what keeps the 20% CDF out of the GRAND TOTAL.

-- ---------------------------------------------------------------------------
-- 1. Funding source, classified
--
-- Column (7) is free text and always will be: the office writes "GF",
-- "General Fund", "20% CDF / LGU counterpart". So the classification lives in
-- ONE immutable function that the slide can quote verbatim, rather than in a
-- regex buried in a React component where nobody presenting could check it.
--
-- Four answers, and 'unclassified' is a real one that is shown rather than
-- hidden — a bar chart that quietly sorted unknown text into "Local" would be
-- a chart nobody could defend in a council session.
-- ---------------------------------------------------------------------------

create or replace function tracks.funding_origin(p_source text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_source, '')), '') is null then 'unstated'
    -- National agencies, grants and loans first: an entry naming both the LGU
    -- and a national agency is externally funded, not locally.
    when upper(p_source) ~ '(NATIONAL GOVERNMENT|GRANT|DONOR|LOAN|FOREIGN|ODA|CONGRESSIONAL|SUBSIDY|PROVINCIAL)'
      or upper(p_source) ~ '\y(NGA|DPWH|DOH|DILG|DSWD|DEPED|DOT|DTI|DAR|DOE|DOTR|NIA|PAGCOR|PCSO|DBM|DENR)\y'
      then 'external'
    -- The city's own money, including its share of national taxes: once the
    -- NTA is received it is the LGU's to programme.
    when upper(p_source) ~ '(GENERAL FUND|LOCAL FUND|CITY FUND|TRUST FUND|DEVELOPMENT FUND|SPECIAL EDUCATION)'
      or upper(p_source) ~ '\y(GF|LGU|SEF|NTA|IRA|CDF|CDRRMF|CDRRM|GAD|LCPC)\y'
      or upper(p_source) ~ '(20\s*%|5\s*%|1\s*%)'
      then 'local'
    else 'unclassified'
  end;
$$;

comment on function tracks.funding_origin(text) is
  'Local / external / unclassified / unstated, from the free text of column (7). '
  'Stated in one place so the presentation can print the rule beside the chart.';

-- ---------------------------------------------------------------------------
-- 2. Barangay, derived — and honest about being derived
--
-- THE AIP FORM HAS NO LOCATION COLUMN AND `ppas` HAS NO BARANGAY. Column (3)
-- is the implementing OFFICE. So a barangay figure can only be read out of the
-- text an encoder happened to type, and this function does exactly that and
-- nothing more.
--
-- The amount is attributed only where a row names ONE barangay. A row naming
-- three would otherwise be counted three times over and the column of pesos
-- would exceed the programme; a row naming none is not silently dropped into
-- the largest barangay. Both go to their own buckets, which the slide shows.
-- ---------------------------------------------------------------------------

create or replace function tracks.barangay_mentions(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct q.name), '{}'::text[])
  from (
    select nullif(btrim(m[1]), '') as name
    from regexp_matches(
      coalesce(p_text, ''),
      -- ONE capitalised word after the keyword, and one only. "Brgy.
      -- Taglatawan Farm-to-Market Road" names Taglatawan; a second word is
      -- almost always the project, not the place, and a hand-written list of
      -- project nouns to skip is a list that is wrong by next budget season.
      --
      -- The exception is the naming convention that genuinely runs to two
      -- words — San Vicente, Santa Teresita, New Salem — which is a closed set
      -- of prefixes and is matched first so it wins.
      '(?:Brgy\.?|BRGY\.?|Barangay|BARANGAY)\s+'
      '((?:San|Sta\.?|Santa|Sto\.?|Santo|New|Old|Villa|Bagong|Del|Dela|Upper|Lower)'
      '\s+[A-Z][A-Za-z0-9''\-\.]*'
      '|[A-Z][A-Za-z0-9''\-\.]*)',
      'g') as m
  ) q
  -- "Barangay Road", "Barangay Hall" and "Barangay Health Station" name no
  -- barangay at all.
  where q.name is not null
    and q.name !~ '^(Road|Roads|Street|Highway|Bridge|Hall|Halls|Court|Health|Center|Centre|'
                  'School|Schools|Water|System|Systems|Project|Projects|Site|Area|Purok|'
                  'Phase|City|National|Officials|Official|Council|Councils|Level|Development|'
                  'Nutrition|Day|Care|Covered|Multi|Gymnasium|Farm|Market|Drainage)$';
$$;

comment on function tracks.barangay_mentions(text) is
  'Barangay names read out of free text. TRACKS records no location field — '
  'this is derived, not a recorded fact, and every screen using it says so.';

-- ---------------------------------------------------------------------------
-- 3. v_presentation_ppa — the fact row
--
-- One row per line of the programme, carrying every dimension the deck slices
-- by and every measure it reports. Built on v_ppa_rows and v_ppa_financials,
-- so it inherits their security_invoker RLS and their arithmetic; it adds no
-- money of its own.
-- ---------------------------------------------------------------------------

create or replace view tracks.v_presentation_ppa
with (security_invoker = true) as
select
  r.id                                as ppa_id,
  r.period_id,
  r.period_year,
  r.period_status,
  r.aip_id,
  r.aip_kind,
  r.supplemental_no,
  r.aip_status,
  r.fund_id,
  r.fund_code,
  r.fund_label,
  r.sector_id,
  r.sector_code,
  s.name                              as sector_name,
  r.sector_heading,
  s.summary_label                     as sector_summary_label,
  r.sector_sort,
  r.department_id,
  r.department_code,
  r.department_name,
  r.department_sort,
  r.item_no,
  r.ref_code,
  r.description,
  r.implementing_office,
  r.start_date,
  r.end_date,
  r.expected_output,
  r.funding_source,
  -- "GF", "gf" and "GF " are one funding source; the label keeps the office's
  -- own spelling, the key is what groups them.
  nullif(upper(regexp_replace(btrim(r.funding_source), '\s+', ' ', 'g')), '')
                                      as funding_source_key,
  tracks.funding_origin(r.funding_source) as funding_origin,
  r.amount_ps,
  r.amount_mooe,
  r.amount_fe,
  r.amount_co,
  r.amount_total,
  (r.continues_ppa_id is not null)    as is_continuing,
  r.continues_ppa_id,
  r.dept_status,
  r.planning_status,
  r.review_status,
  r.is_returned,
  -- Where this line stands, from proposal to acceptance. The AIP's status says
  -- which of the two readings applies; the row's own review says the rest.
  case
    when r.aip_status = 'accepted' then 'accepted'
    when r.aip_status in ('submitted', 'returned') then
      case r.planning_status
        when 'approved' then 'planning_approved'
        when 'returned' then 'planning_returned'
        else 'submitted'
      end
    else
      case r.dept_status
        when 'approved' then 'dept_approved'
        when 'returned' then 'dept_returned'
        else 'encoded'
      end
  end                                 as workflow_stage,
  f.allotted,
  f.obligated,
  f.disbursed,
  f.unobligated_balance,
  f.unpaid_obligations,
  f.obligation_rate,
  f.disbursement_rate,
  f.physical_percent,
  f.physical_as_of,
  -- Physical progress is REPORTED, not inferred. "Not reported" is its own
  -- state and is never rendered as 0% — the office that has not filed a
  -- progress report has not told us it did nothing.
  case
    when f.physical_percent is null then 'unreported'
    when f.physical_percent >= 100 then 'completed'
    when f.physical_percent > 0 then 'ongoing'
    else 'not_started'
  end                                 as progress_state,
  loc.names                           as barangay_names,
  case
    when cardinality(loc.names) = 0 then 'unstated'
    when cardinality(loc.names) = 1 then 'single'
    else 'multiple'
  end                                 as location_bucket,
  case when cardinality(loc.names) = 1 then loc.names[1] end as location_label
from tracks.v_ppa_rows r
join tracks.v_ppa_financials f on f.ppa_id = r.id
join tracks.sectors s          on s.id = r.sector_id
cross join lateral (
  select tracks.barangay_mentions(
    r.description || ' ' || coalesce(r.expected_output, '')) as names
) loc
where r.row_kind = 'ppa';

grant select on tracks.v_presentation_ppa to authenticated;

-- ---------------------------------------------------------------------------
-- 4. presentation_deck() — every slide, one snapshot
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, deliberately, like insert_ppa_row(): it bypasses nothing.
-- A department head calling it sees their own office and no one else's,
-- because every view underneath is security_invoker and RLS still judges the
-- read. It is a reporting function, not a workflow transition, so there is
-- nothing here that needs to escape the caller's own permissions.
--
-- `p_kind`/`p_fund_id` choose the DOCUMENT. The rest are drill-downs, and any
-- of them set `filtered`, which every total on screen is captioned with.

create or replace function tracks.presentation_deck(
  p_period_id       uuid,
  p_kind            text default 'annual',
  p_fund_id         uuid default null,
  p_sector_id       uuid default null,
  p_department_id   uuid default null,
  p_funding_source  text default null,
  p_status          text default null,
  p_barangay        text default null,
  p_top_limit       integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = tracks, public
as $$
with
-- The document. Drill-downs have not been applied yet, so the filter pickers
-- offer every value the document actually holds rather than collapsing to
-- whatever is already selected.
scoped as (
  select *
  from tracks.v_presentation_ppa
  where period_id = p_period_id
    and aip_kind  = coalesce(p_kind, 'annual')
    and fund_id is not distinct from p_fund_id
),
visible as (
  select *
  from scoped
  where (p_sector_id      is null or sector_id = p_sector_id)
    and (p_department_id  is null or department_id = p_department_id)
    and (p_funding_source is null or coalesce(funding_source_key, '—') = p_funding_source)
    and (p_status         is null or workflow_stage = p_status)
    and (p_barangay       is null or coalesce(location_label, '—') = p_barangay)
),
grand as (
  select coalesce(sum(amount_total), 0) as total, count(*) as n from visible
),

-- ---- 2. By sector --------------------------------------------------------
sector_agg as (
  select
    v.sector_id,
    min(v.sector_code)  as sector_code,
    min(v.sector_name)  as sector_name,
    min(v.sector_heading) as sector_heading,
    min(v.sector_sort)  as sector_sort,
    count(*)                          as ppa_count,
    count(distinct v.department_id)   as department_count,
    sum(v.amount_total)               as total_amount,
    sum(v.allotted)                   as allotted,
    sum(v.obligated)                  as obligated,
    sum(v.disbursed)                  as disbursed
  from visible v
  group by v.sector_id
),
sector_ranked as (
  select a.*,
         row_number() over (order by a.total_amount desc, a.sector_sort) as rnk,
         case when g.total > 0 then round(a.total_amount / g.total * 100, 2) end as share_pct
  from sector_agg a cross join grand g
),

-- ---- 3. By office --------------------------------------------------------
office_agg as (
  select
    v.department_id,
    min(v.department_code) as department_code,
    min(v.department_name) as department_name,
    min(v.sector_code)     as sector_code,
    min(v.sector_name)     as sector_name,
    min(v.department_sort) as department_sort,
    count(*)               as ppa_count,
    sum(v.amount_total)    as total_amount,
    sum(v.allotted)        as allotted,
    sum(v.obligated)       as obligated,
    sum(v.disbursed)       as disbursed
  from visible v
  group by v.department_id
),
office_ranked as (
  select a.*,
         row_number() over (order by a.total_amount desc, a.department_sort) as rnk,
         case when g.total > 0 then round(a.total_amount / g.total * 100, 2) end as share_pct
  from office_agg a cross join grand g
),

-- ---- 5. Funding sources --------------------------------------------------
source_agg as (
  select
    coalesce(v.funding_source_key, '—')                        as source_key,
    coalesce(mode() within group (order by v.funding_source), 'Not stated') as source_label,
    min(v.funding_origin)   as origin,
    count(*)                as ppa_count,
    sum(v.amount_total)     as total_amount
  from visible v
  group by coalesce(v.funding_source_key, '—')
),
source_ranked as (
  select a.*,
         row_number() over (order by a.total_amount desc) as rnk,
         case when g.total > 0 then round(a.total_amount / g.total * 100, 2) end as share_pct
  from source_agg a cross join grand g
),
origin_agg as (
  select v.funding_origin as origin,
         count(*)            as ppa_count,
         sum(v.amount_total) as total_amount
  from visible v
  group by v.funding_origin
),

-- ---- 4. Barangay, derived ------------------------------------------------
barangay_agg as (
  select v.location_label      as name,
         count(*)              as ppa_count,
         sum(v.amount_total)   as total_amount
  from visible v
  where v.location_bucket = 'single'
  group by v.location_label
),
barangay_ranked as (
  select a.*, row_number() over (order by a.total_amount desc) as rnk
  from barangay_agg a
),
location_coverage as (
  select
    count(*) filter (where location_bucket = 'single')   as single_count,
    count(*) filter (where location_bucket = 'multiple') as multiple_count,
    count(*) filter (where location_bucket = 'unstated') as unstated_count,
    coalesce(sum(amount_total) filter (where location_bucket = 'single'), 0)   as single_amount,
    coalesce(sum(amount_total) filter (where location_bucket = 'multiple'), 0) as multiple_amount,
    coalesce(sum(amount_total) filter (where location_bucket = 'unstated'), 0) as unstated_amount
  from visible
),

-- ---- 6. Pipeline ---------------------------------------------------------
-- Two readings of the same rows: where each line stands right now, and how
-- many have passed each checkpoint.
--
-- CHECKPOINTS, NOT A FUNNEL. It is tempting to draw these as a funnel and
-- assert that each step holds fewer rows than the one before it, and it is
-- not true here. `reopen_aip` puts an accepted AIP back to draft without
-- erasing a reading, rows that predate the two-stage review carry no reading
-- at all, and Budget can record an obligation against a PPA nobody entered an
-- allotment for. So a row CAN be accepted with no department approval on
-- record. Each checkpoint is counted on its own evidence and none is inferred
-- from another — a chart that inferred them would report readings that never
-- happened.
stage_agg as (
  select v.workflow_stage as stage,
         count(*)            as ppa_count,
         sum(v.amount_total) as total_amount
  from visible v
  group by v.workflow_stage
),
checkpoints as (
  select * from (values
    (1, 'encoded',            'Encoded'),
    (2, 'dept_approved',      'Approved by the department head'),
    (3, 'submitted',          'Submitted to City Planning'),
    (4, 'planning_approved',  'Approved by City Planning'),
    (5, 'accepted',           'Accepted into the consolidation'),
    (6, 'allotted',           'With an allotment'),
    (7, 'obligated',          'Obligated'),
    (8, 'disbursed',          'Disbursed')
  ) as f(step, key, label)
),
checkpoint_counts as (
  select f.step, f.key, f.label,
    (select count(*) from visible v where case f.key
        when 'encoded'           then true
        when 'dept_approved'     then v.dept_status = 'approved'
        when 'submitted'         then v.aip_status in ('submitted', 'returned', 'accepted')
        when 'planning_approved' then v.planning_status = 'approved'
        when 'accepted'          then v.aip_status = 'accepted'
        when 'allotted'          then v.allotted > 0
        when 'obligated'         then v.obligated > 0
        when 'disbursed'         then v.disbursed > 0
      end) as ppa_count,
    (select coalesce(sum(v.amount_total), 0) from visible v where case f.key
        when 'encoded'           then true
        when 'dept_approved'     then v.dept_status = 'approved'
        when 'submitted'         then v.aip_status in ('submitted', 'returned', 'accepted')
        when 'planning_approved' then v.planning_status = 'approved'
        when 'accepted'          then v.aip_status = 'accepted'
        when 'allotted'          then v.allotted > 0
        when 'obligated'         then v.obligated > 0
        when 'disbursed'         then v.disbursed > 0
      end) as total_amount
  from checkpoints f
),
progress_agg as (
  select v.progress_state as state, count(*) as ppa_count,
         sum(v.amount_total) as total_amount
  from visible v group by v.progress_state
),

-- ---- 10. Execution -------------------------------------------------------
-- The variance between money and delivery is computed over the rows that have
-- REPORTED physical progress and nothing else. Averaging an unreported row in
-- as 0% would manufacture an alarm; leaving it out of the denominator and
-- saying how many were left out is the honest version, and `physical_coverage`
-- is on the slide beside the figure.
exec_totals as (
  select
    coalesce(sum(amount_total), 0)        as programmed,
    coalesce(sum(allotted), 0)            as allotted,
    coalesce(sum(obligated), 0)           as obligated,
    coalesce(sum(disbursed), 0)           as disbursed,
    coalesce(sum(unobligated_balance), 0) as unobligated,
    coalesce(sum(unpaid_obligations), 0)  as unpaid,
    count(*) filter (where physical_percent is not null) as physical_reported_count,
    count(*)                                             as ppa_count,
    coalesce(sum(amount_total) filter (where physical_percent is not null), 0)
                                                         as reported_amount,
    coalesce(sum(allotted)   filter (where physical_percent is not null), 0) as reported_allotted,
    coalesce(sum(obligated)  filter (where physical_percent is not null), 0) as reported_obligated,
    coalesce(sum(physical_percent * amount_total) filter (where physical_percent is not null), 0)
                                                         as physical_weighted_numerator
  from visible
),
exec_sector as (
  select
    v.sector_id,
    min(v.sector_code) as sector_code,
    min(v.sector_name) as sector_name,
    min(v.sector_sort) as sector_sort,
    coalesce(sum(v.amount_total), 0) as programmed,
    coalesce(sum(v.allotted), 0)     as allotted,
    coalesce(sum(v.obligated), 0)    as obligated,
    coalesce(sum(v.disbursed), 0)    as disbursed,
    coalesce(sum(v.amount_total) filter (where v.physical_percent is not null), 0) as reported_amount,
    coalesce(sum(v.physical_percent * v.amount_total)
             filter (where v.physical_percent is not null), 0) as physical_numerator
  from visible v
  group by v.sector_id
),

-- ---- The year, month by month --------------------------------------------
--
-- Obligation against disbursement across the twelve months of the programme
-- year: the curve the office is actually asked about in a session, because the
-- GAP between the two lines is unliquidated money and its shape over the year
-- is the thing a table of totals cannot show.
--
-- Both an in-month figure and a cumulative one are returned. The cumulative is
-- "as at the end of this month" and therefore includes anything dated BEFORE
-- the programme year — a CY2027 PPA obligated in December 2026 is money already
-- committed when January opens, and a curve that started it at zero would draw
-- a January jump that never happened. Anything dated after December of the
-- programme year is not on the curve at all, which is why the slide states the
-- axis it is drawn on.
months as (
  select generate_series(1, 12) as m
),
programme_year as (
  select year from tracks.aip_periods where id = p_period_id
),
ledger as (
  select 'obligated'::text as kind,
         date_part('year',  o.obligation_date)::int  as y,
         date_part('month', o.obligation_date)::int  as m,
         o.amount
  from tracks.obligations o
  join visible v on v.ppa_id = o.ppa_id
  where o.status = 'active'
  union all
  select 'disbursed',
         date_part('year',  d.disbursement_date)::int,
         date_part('month', d.disbursement_date)::int,
         d.amount
  from tracks.disbursements d
  join visible v on v.ppa_id = d.ppa_id
  where d.status = 'active'
),
monthly as (
  select
    mo.m,
    to_char(to_date(lpad(mo.m::text, 2, '0'), 'MM'), 'Mon') as label,
    coalesce(sum(l.amount) filter (
      where l.kind = 'obligated' and l.y = py.year and l.m = mo.m), 0) as obligated,
    coalesce(sum(l.amount) filter (
      where l.kind = 'disbursed' and l.y = py.year and l.m = mo.m), 0) as disbursed,
    coalesce(sum(l.amount) filter (
      where l.kind = 'obligated'
        and (l.y < py.year or (l.y = py.year and l.m <= mo.m))), 0) as obligated_cumulative,
    coalesce(sum(l.amount) filter (
      where l.kind = 'disbursed'
        and (l.y < py.year or (l.y = py.year and l.m <= mo.m))), 0) as disbursed_cumulative
  from months mo
  cross join programme_year py
  left join ledger l on true
  group by mo.m, py.year
),

-- ---- 7 & 11. The largest lines -------------------------------------------
top_ranked as (
  select v.*, row_number() over (order by v.amount_total desc, v.description) as rnk
  from visible v
),

-- ---- 8. Resources --------------------------------------------------------
-- Every figure here is RECORDED. `nta_amount` is what the planning
-- administrator entered for the year and the statutory bases are what they
-- entered per fund; TRACKS holds no revenue projection and this slide invents
-- none. The gap is stated against the one resource figure the database has,
-- and the slide says exactly that.
resources as (
  select
    per.nta_amount,
    (select coalesce(sum(total_amount), 0) from tracks.v_period_totals
      where period_id = p_period_id and kind = 'annual' and fund_id is null)
                                                        as annual_programmed,
    (select coalesce(sum(total_amount), 0) from tracks.v_period_totals
      where period_id = p_period_id and kind = 'supplemental' and fund_id is null)
                                                        as supplemental_programmed,
    (select coalesce(sum(programmed_amount), 0) from tracks.v_statutory_fund_totals
      where period_id = p_period_id and active)         as statutory_programmed,
    (select coalesce(sum(base_amount), 0) from tracks.v_statutory_fund_totals
      where period_id = p_period_id and active)         as statutory_base,
    (select sum(ceiling_amount) from tracks.v_statutory_fund_totals
      where period_id = p_period_id and active)         as statutory_ceiling,
    (select count(*) from tracks.v_statutory_fund_totals
      where period_id = p_period_id and active and base_amount is null)
                                                        as funds_without_base
  from tracks.aip_periods per where per.id = p_period_id
),

-- ---- 9. Multi-year -------------------------------------------------------
-- Every period the caller can see, for the same document. A year in which this
-- document was never filed reports zero rather than being dropped, so a gap in
-- the series is visible as a gap.
trend as (
  select
    per.id     as period_id,
    per.year,
    per.title,
    per.status,
    coalesce((select sum(total_amount) from tracks.v_period_totals pt
               where pt.period_id = per.id
                 and pt.kind = coalesce(p_kind, 'annual')
                 and pt.fund_id is not distinct from p_fund_id), 0) as total_amount,
    (select count(*) from tracks.v_presentation_ppa x
      where x.period_id = per.id
        and x.aip_kind = coalesce(p_kind, 'annual')
        and x.fund_id is not distinct from p_fund_id) as ppa_count,
    (select coalesce(sum(x.allotted), 0) from tracks.v_presentation_ppa x
      where x.period_id = per.id
        and x.aip_kind = coalesce(p_kind, 'annual')
        and x.fund_id is not distinct from p_fund_id) as allotted,
    (select coalesce(sum(x.disbursed), 0) from tracks.v_presentation_ppa x
      where x.period_id = per.id
        and x.aip_kind = coalesce(p_kind, 'annual')
        and x.fund_id is not distinct from p_fund_id) as disbursed
  from tracks.aip_periods per
),
trend_sector as (
  select x.period_year as year, x.sector_id,
         min(x.sector_code) as sector_code,
         min(x.sector_name) as sector_name,
         min(x.sector_sort) as sector_sort,
         sum(x.amount_total) as total_amount
  from tracks.v_presentation_ppa x
  where x.aip_kind = coalesce(p_kind, 'annual')
    and x.fund_id is not distinct from p_fund_id
  group by x.period_year, x.sector_id
),

-- ---- 12. Decision summary ------------------------------------------------
-- Facts, counted. Not advice: the deck states what the largest and the most
-- overdue things are, and the room decides what to do about them.
issue_office_no_obligation as (
  select count(*) as n from (
    select department_id from visible
    group by department_id
    having sum(allotted) > 0 and sum(obligated) = 0) q
),
issue_rows as (
  select
    count(*) filter (where aip_status = 'accepted' and allotted = 0)  as accepted_unallotted,
    coalesce(sum(amount_total) filter (where aip_status = 'accepted' and allotted = 0), 0)
                                                                     as accepted_unallotted_amount,
    count(*) filter (where funding_source_key is null)               as unfunded_count,
    coalesce(sum(amount_total) filter (where funding_source_key is null), 0) as unfunded_amount,
    count(*) filter (where allotted > 0 and physical_percent is null) as allotted_unreported,
    count(*) filter (
      where allotted > 0 and physical_percent is not null
        and obligation_rate is not null
        and obligation_rate - physical_percent > 25)                  as lagging_physical,
    coalesce(sum(unpaid_obligations), 0)                              as unpaid_obligations
  from visible
),
fund_overage as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'fund_id', fund_id, 'label', fund_label,
           'ceiling_amount', ceiling_amount,
           'programmed_amount', programmed_amount,
           'over_by', programmed_amount - ceiling_amount) order by fund_label), '[]'::jsonb) as j
  from tracks.v_statutory_fund_totals
  where period_id = p_period_id and active
    and ceiling_amount is not null and programmed_amount > ceiling_amount
)

select jsonb_build_object(
  'document', (
    select jsonb_build_object(
      'period_id', per.id, 'year', per.year, 'title', per.title,
      'draft_label', per.draft_label, 'period_status', per.status,
      'kind', coalesce(p_kind, 'annual'),
      'fund_id', p_fund_id,
      'fund_label', (select short_label from tracks.statutory_funds where id = p_fund_id),
      'fund_name',  (select name from tracks.statutory_funds where id = p_fund_id),
      'lgu_name',   (select lgu_type || ' of ' || lgu_name from tracks.lgu_settings where id))
    from tracks.aip_periods per where per.id = p_period_id),

  'filters', jsonb_build_object(
    'sector_id', p_sector_id, 'department_id', p_department_id,
    'funding_source', p_funding_source, 'status', p_status, 'barangay', p_barangay),
  'filtered', (p_sector_id is not null or p_department_id is not null
               or p_funding_source is not null or p_status is not null
               or p_barangay is not null),
  'document_ppa_count', (select count(*) from scoped),

  -- 1. Executive summary
  'overview', (
    select jsonb_build_object(
      'ppa_count',          count(*),
      'total_amount',       coalesce(sum(amount_total), 0),
      'total_ps',           coalesce(sum(amount_ps), 0),
      'total_mooe',         coalesce(sum(amount_mooe), 0),
      'total_fe',           coalesce(sum(amount_fe), 0),
      'total_co',           coalesce(sum(amount_co), 0),
      'department_count',   count(distinct department_id),
      'sector_count',       count(distinct sector_id),
      'implementing_office_count',
                            count(distinct implementing_office)
                              filter (where implementing_office is not null),
      'funded_count',       count(*) filter (where funding_source_key is not null),
      'funded_amount',      coalesce(sum(amount_total) filter (where funding_source_key is not null), 0),
      'unfunded_count',     count(*) filter (where funding_source_key is null),
      'unfunded_amount',    coalesce(sum(amount_total) filter (where funding_source_key is null), 0),
      'continuing_count',   count(*) filter (where is_continuing),
      'continuing_amount',  coalesce(sum(amount_total) filter (where is_continuing), 0),
      'new_count',          count(*) filter (where not is_continuing),
      'new_amount',         coalesce(sum(amount_total) filter (where not is_continuing), 0),
      'largest_amount',     coalesce(max(amount_total), 0),
      'median_amount',      percentile_cont(0.5) within group (order by amount_total),
      'average_amount',     case when count(*) > 0
                                 then round(sum(amount_total) / count(*), 2) end)
    from visible),

  -- 2. By sector
  'sectors', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sector_id', sector_id, 'code', sector_code, 'name', sector_name,
      'heading', sector_heading, 'ppa_count', ppa_count,
      'department_count', department_count, 'total_amount', total_amount,
      'allotted', allotted, 'obligated', obligated, 'disbursed', disbursed,
      'share_pct', share_pct, 'rank', rnk) order by rnk), '[]'::jsonb)
    from sector_ranked),

  -- 3. By office
  'offices', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'department_id', department_id, 'code', department_code,
      'name', department_name, 'sector_code', sector_code, 'sector_name', sector_name,
      'ppa_count', ppa_count, 'total_amount', total_amount,
      'allotted', allotted, 'obligated', obligated, 'disbursed', disbursed,
      'share_pct', share_pct, 'rank', rnk) order by rnk), '[]'::jsonb)
    from office_ranked),

  -- 4. By barangay (derived from text — see barangay_mentions above)
  'barangays', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'ppa_count', ppa_count,
      'total_amount', total_amount, 'rank', rnk) order by rnk), '[]'::jsonb)
    from barangay_ranked),
  'location_coverage', (select to_jsonb(l) from location_coverage l),

  -- 5. Funding sources
  'funding_sources', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', source_key, 'label', source_label, 'origin', origin,
      'ppa_count', ppa_count, 'total_amount', total_amount,
      'share_pct', share_pct, 'rank', rnk) order by rnk), '[]'::jsonb)
    from source_ranked),
  'funding_origins', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'origin', origin, 'ppa_count', ppa_count, 'total_amount', total_amount)
      order by total_amount desc), '[]'::jsonb)
    from origin_agg),

  -- 6. Pipeline
  'stages', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'stage', stage, 'ppa_count', ppa_count, 'total_amount', total_amount)
      order by ppa_count desc), '[]'::jsonb)
    from stage_agg),
  'checkpoints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'step', step, 'key', key, 'label', label,
      'ppa_count', ppa_count, 'total_amount', total_amount) order by step), '[]'::jsonb)
    from checkpoint_counts),
  'progress', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'state', state, 'ppa_count', ppa_count, 'total_amount', total_amount)
      order by state), '[]'::jsonb)
    from progress_agg),

  -- 7 & 11. The largest lines, and the portfolio
  'top_ppas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ppa_id', ppa_id, 'rank', rnk, 'item_no', item_no, 'ref_code', ref_code,
      'description', description, 'sector_name', sector_name, 'sector_code', sector_code,
      'department_name', department_name, 'department_code', department_code,
      'implementing_office', implementing_office,
      'location_label', location_label, 'location_bucket', location_bucket,
      'funding_source', funding_source, 'funding_origin', funding_origin,
      'start_date', start_date, 'end_date', end_date,
      'amount_total', amount_total, 'is_continuing', is_continuing,
      'workflow_stage', workflow_stage, 'aip_status', aip_status,
      'allotted', allotted, 'obligated', obligated, 'disbursed', disbursed,
      'obligation_rate', obligation_rate, 'physical_percent', physical_percent,
      'physical_as_of', physical_as_of, 'progress_state', progress_state)
      order by rnk), '[]'::jsonb)
    from top_ranked where rnk <= greatest(coalesce(p_top_limit, 25), 1)),

  'monthly', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', m, 'label', label,
      'obligated', obligated, 'disbursed', disbursed,
      'obligated_cumulative', obligated_cumulative,
      'disbursed_cumulative', disbursed_cumulative) order by m), '[]'::jsonb)
    from monthly),

  -- 8. AIP against the resources the database records
  'resources', (
    select jsonb_build_object(
      'nta_amount', r.nta_amount,
      'annual_programmed', r.annual_programmed,
      'supplemental_programmed', r.supplemental_programmed,
      'statutory_programmed', r.statutory_programmed,
      'statutory_base', r.statutory_base,
      'statutory_ceiling', r.statutory_ceiling,
      'funds_without_base', r.funds_without_base,
      'gap', case when r.nta_amount is not null
                  then r.nta_amount - r.annual_programmed end,
      'covered_pct', case when r.nta_amount is not null and r.nta_amount > 0
                          then round(r.annual_programmed / r.nta_amount * 100, 2) end)
    from resources r),
  'statutory_funds', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'fund_id', fund_id, 'code', fund_code, 'label', fund_label, 'name', fund_name,
      'percentage', percentage, 'base_amount', base_amount,
      'ceiling_amount', ceiling_amount, 'programmed_amount', programmed_amount,
      'remaining_amount', remaining_amount, 'document_count', document_count)
      order by sort_order), '[]'::jsonb)
    from tracks.v_statutory_fund_totals
    where period_id = p_period_id and active),

  -- 9. Multi-year
  'trend', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'period_id', period_id, 'year', year, 'title', title, 'status', status,
      'total_amount', total_amount, 'ppa_count', ppa_count,
      'allotted', allotted, 'disbursed', disbursed) order by year), '[]'::jsonb)
    from trend),
  'trend_sectors', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'year', year, 'sector_id', sector_id, 'code', sector_code,
      'name', sector_name, 'total_amount', total_amount)
      order by year, sector_sort), '[]'::jsonb)
    from trend_sector),

  -- 10. Execution
  'execution', (
    select jsonb_build_object(
      'programmed', e.programmed, 'allotted', e.allotted, 'obligated', e.obligated,
      'disbursed', e.disbursed, 'unobligated', e.unobligated, 'unpaid', e.unpaid,
      'allotment_rate', case when e.programmed > 0
                             then round(e.allotted / e.programmed * 100, 2) end,
      'obligation_rate', case when e.allotted > 0
                              then round(e.obligated / e.allotted * 100, 2) end,
      'disbursement_rate', case when e.allotted > 0
                                then round(e.disbursed / e.allotted * 100, 2) end,
      'ppa_count', e.ppa_count,
      'physical_reported_count', e.physical_reported_count,
      'physical_coverage_pct', case when e.ppa_count > 0
                                    then round(e.physical_reported_count::numeric
                                               / e.ppa_count * 100, 2) end,
      'physical_weighted_pct', case when e.reported_amount > 0
                                    then round(e.physical_weighted_numerator
                                               / e.reported_amount, 2) end,
      -- Financial against physical, over the SAME rows: the reported ones.
      'variance_financial_pct', case when e.reported_allotted > 0
                                     then round(e.reported_obligated
                                                / e.reported_allotted * 100, 2) end,
      'variance_points', case when e.reported_allotted > 0 and e.reported_amount > 0
                              then round(e.reported_obligated / e.reported_allotted * 100
                                         - e.physical_weighted_numerator / e.reported_amount, 2) end)
    from exec_totals e),
  'execution_sectors', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sector_id', sector_id, 'code', sector_code, 'name', sector_name,
      'programmed', programmed, 'allotted', allotted,
      'obligated', obligated, 'disbursed', disbursed,
      'obligation_rate', case when allotted > 0
                              then round(obligated / allotted * 100, 2) end,
      'physical_weighted_pct', case when reported_amount > 0
                                    then round(physical_numerator / reported_amount, 2) end)
      order by sector_sort), '[]'::jsonb)
    from exec_sector),

  -- 12. Decision summary — counted facts, no advice
  'decisions', (
    select jsonb_build_object(
      'top_sector',  (select to_jsonb(x) from (
                        select sector_name as name, total_amount, share_pct, ppa_count
                        from sector_ranked where rnk = 1) x),
      'top_office',  (select to_jsonb(x) from (
                        select department_name as name, total_amount, share_pct, ppa_count
                        from office_ranked where rnk = 1) x),
      'top_ppa',     (select to_jsonb(x) from (
                        select description as name, amount_total as total_amount,
                               department_name, sector_name
                        from top_ranked where rnk = 1) x),
      'top_three_sector_share',
                     (select sum(share_pct) from sector_ranked where rnk <= 3),
      'top_ten_ppa_amount',
                     (select coalesce(sum(amount_total), 0) from top_ranked where rnk <= 10),
      -- Concentration, as a share. Computed here rather than by dividing two
      -- figures on the slide: a ratio of two peso totals is a peso figure's
      -- answer and belongs in the same place they were added up.
      'top_ten_ppa_share',
                     (select case when g.total > 0
                              then round(coalesce(sum(t.amount_total), 0) / g.total * 100, 2) end
                        from top_ranked t cross join grand g
                       where t.rnk <= 10 group by g.total),
      'unfunded_count',  i.unfunded_count,
      'unfunded_amount', i.unfunded_amount,
      'accepted_unallotted', i.accepted_unallotted,
      'accepted_unallotted_amount', i.accepted_unallotted_amount,
      'allotted_unreported', i.allotted_unreported,
      'lagging_physical', i.lagging_physical,
      'unpaid_obligations', i.unpaid_obligations,
      'offices_with_no_obligation', o.n,
      'funds_over_ceiling', (select j from fund_overage))
    from issue_rows i cross join issue_office_no_obligation o),

  -- The filter pickers, over the document rather than the current selection.
  'options', jsonb_build_object(
    'sectors', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                  'id', sector_id, 'label', sector_name)), '[]'::jsonb) from scoped),
    'departments', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                  'id', department_id, 'label', department_name)), '[]'::jsonb) from scoped),
    'funding_sources', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                  'id', coalesce(funding_source_key, '—'),
                  'label', coalesce(funding_source, 'Not stated'))), '[]'::jsonb) from scoped),
    'barangays', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                  'id', coalesce(location_label, '—'),
                  'label', coalesce(location_label, 'Not stated'))), '[]'::jsonb) from scoped),
    'stages', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                  'id', workflow_stage, 'label', workflow_stage)), '[]'::jsonb) from scoped))
);
$$;

comment on function tracks.presentation_deck(
  uuid, text, uuid, uuid, uuid, text, text, text, integer) is
  'Every figure on the City Planning presentation deck, aggregated once in SQL '
  'from one snapshot. Nothing in TypeScript re-adds a column of pesos.';

revoke execute on function tracks.presentation_deck(
  uuid, text, uuid, uuid, uuid, text, text, text, integer) from public;
grant execute on function tracks.presentation_deck(
  uuid, text, uuid, uuid, uuid, text, text, text, integer) to authenticated;

revoke execute on function tracks.funding_origin(text) from public;
revoke execute on function tracks.barangay_mentions(text) from public;
grant execute on function tracks.funding_origin(text) to authenticated;
grant execute on function tracks.barangay_mentions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 0018_row_history.sql
-- ---------------------------------------------------------------------------

-- 0018_row_history.sql
-- The audit trail on a PPA row, completed and made readable.
--
-- The trail itself is not new. `ppa_revisions` has been written by trigger
-- since 0003, on every insert, update and delete of `tracks.ppas`, precisely so
-- that a City Planning overwrite of a department's figure can never happen off
-- the record — even through a route nobody remembered to instrument. Two things
-- were missing from it:
--
--   * the CAPACITY the change was made in. "Berl changed MOOE from 1.2m to
--     800k" is the fact; "the City Planning Sector Officer changed it" is the
--     one the office is looking for when it reads this back. The role is
--     stamped at the moment of the write rather than joined from `user_roles`
--     later, because a role can be reassigned and a trail that re-reads it
--     would rewrite its own history.
--
--   * anywhere to READ it. A trail nobody can open is a trail in name only, so
--     `v_ppa_revisions` names the changer and their capacity, and the row menu
--     on both grids opens it.
--
-- Nothing here relaxes a lock and nothing here writes a peso.

-- ---------------------------------------------------------------------------
-- Capacity, stamped at the moment of the write
-- ---------------------------------------------------------------------------
--
-- Null on every revision written before this migration, and on anything the
-- service role does: honest about not knowing, rather than guessing from the
-- role the account holds today.

alter table tracks.ppa_revisions
  add column if not exists changed_role text;

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
  v_by      uuid  := tracks.current_profile_id();
  v_role    text  := tracks.current_role_name();
begin
  if tg_op = 'INSERT' then
    insert into tracks.ppa_revisions (
      ppa_id, aip_id, action, new_values, changed_by, changed_role)
    values (new.id, new.aip_id, 'create', to_jsonb(new) - 'amount_total', v_by, v_role);
    return new;
  elsif tg_op = 'DELETE' then
    insert into tracks.ppa_revisions (
      ppa_id, aip_id, action, old_values, changed_by, changed_role)
    values (old.id, old.aip_id, 'delete', to_jsonb(old) - 'amount_total', v_by, v_role);
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
    ppa_id, aip_id, action, changed_fields, old_values, new_values,
    changed_by, changed_role
  ) values (
    new.id, new.aip_id, 'update', v_changed,
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_changed) k),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_changed) k),
    v_by, v_role
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- v_ppa_revisions — the trail with a name against it
-- ---------------------------------------------------------------------------
--
-- security_invoker, so `ppa_revisions_read` still judges every row: this view
-- reveals nothing the caller could not already select. It adds the changer's
-- name and the office the row belongs to, and nothing else — no derived
-- summary, because the summary belongs where it is read and the trail has to
-- stay the raw thing.
--
-- `changed_by_name` is null on a revision whose author has been deleted from
-- `profiles`, and the trail survives that: the entry stands with its values
-- intact and no name, which is the truth. `changed_by` is not a cascade for the
-- same reason.

create or replace view tracks.v_ppa_revisions
with (security_invoker = true) as
select
  r.id,
  r.ppa_id,
  r.aip_id,
  r.action,
  r.changed_fields,
  r.old_values,
  r.new_values,
  r.changed_by,
  pr.full_name          as changed_by_name,
  r.changed_role,
  r.changed_at,
  p.row_kind,
  p.department_id,
  d.display_name        as department_name
from tracks.ppa_revisions r
left join tracks.profiles    pr on pr.id = r.changed_by
left join tracks.ppas        p  on p.id  = r.ppa_id
left join tracks.departments d  on d.id  = p.department_id;

grant select on tracks.v_ppa_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- 0019_demo_mode.sql
-- ---------------------------------------------------------------------------

-- 0019_demo_mode.sql
-- Demo mode: a whole worked year of the programme, on the real application,
-- that can be handed back to its starting state whenever somebody has finished
-- clicking through it.
--
-- THE ONE RULE THIS FILE TURNS ON: demo data lives in its own AIP PERIOD, and
-- nothing here ever touches a row outside one. Every table in `tracks` hangs
-- off `aip_periods` — aips, then ppas, then reviews, returns, revisions,
-- allotments, obligations, disbursements, progress; aip_actions off the period
-- directly — so a period is the only boundary in this schema that a reset can
-- be scoped to and be *structurally* unable to escape. `rebuild_demo_data()`
-- deletes nothing that is not reachable from `aip_periods.is_demo`, and the
-- filter is written into every statement rather than assumed once at the top.
--
-- Three decisions worth knowing before changing anything here:
--
--   * There are NO demo sign-ins. Whoever is signed in walks the demo, which
--     is why this migration adds no account, no password and no service-role
--     path — the application still holds nothing but the anon key. The demo
--     PROFILES it creates carry `auth_user_id = null`: they exist so the rows
--     have believable names against them, and they can never authenticate,
--     because there is no auth user to authenticate as.
--
--   * Turning demo mode OFF hides the year; it does not delete it. A toggle
--     that destroys data is a toggle somebody flips by accident. Hiding is an
--     RLS predicate, not a filter in TypeScript, so the demo period leaves
--     every screen at once — picker, consolidated view, monitoring, budget,
--     the presentation deck — without a single query being edited.
--
--   * The demo year is in the PAST. `getCurrentPeriod()` takes the latest year,
--     so a demo programme dated behind the real one can never become the year
--     the office lands on by default.

-- ---------------------------------------------------------------------------
-- 1. The switch, and the mark
-- ---------------------------------------------------------------------------
--
-- The switch is on `lgu_settings` — one row, already the place this
-- installation's own facts live. The mark is on the period, because "is this
-- pretend?" is a fact about a document and not about the installation.

alter table tracks.lgu_settings
  add column if not exists demo_mode boolean not null default false;

alter table tracks.aip_periods
  add column if not exists is_demo boolean not null default false;

create index if not exists aip_periods_demo_idx
  on tracks.aip_periods (is_demo) where is_demo;

create or replace function tracks.demo_mode_enabled()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce((select demo_mode from tracks.lgu_settings where id), false);
$$;

revoke execute on function tracks.demo_mode_enabled() from public;
grant execute on function tracks.demo_mode_enabled() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hiding, in every policy that governs a SELECT
-- ---------------------------------------------------------------------------
--
-- `v_ppa_rows`, `v_aip_totals`, `v_sector_totals`, `v_period_totals` and
-- `v_monitoring` are all security_invoker and all start FROM `tracks.aips`;
-- the period picker and the deck read `aip_periods`. Tighten those two tables
-- and the demo year leaves every screen at once, with no query edited.
--
-- BOTH policies on each table have to be tightened, not just the one called
-- `_read`. `aips_planning_write` and `aip_periods_admin_write` are FOR ALL,
-- which includes SELECT, and multiple permissive policies are OR'd together —
-- so tightening `aips_read` alone hides the demo year from a department user
-- and leaves it in full view of the City Planning Office, which is the one
-- audience the switch exists for. Adding the predicate to the write policies
-- also stops a hidden year being edited, which is the right answer anyway: a
-- document nobody can see is not one anybody should be changing.
--
-- `ppas_read` is deliberately left alone. Filtering it would put an EXISTS on
-- the hottest read in the application — every row of a 1,268-row grid — to
-- hide rows already unreachable through every view that renders them. Demo
-- data is not secret; it is noise, and this is about noise.

create or replace function tracks.period_visible(p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce(
    (select not per.is_demo or tracks.demo_mode_enabled()
       from tracks.aip_periods per
      where per.id = p_period_id),
    false);
$$;

revoke execute on function tracks.period_visible(uuid) from public;
grant execute on function tracks.period_visible(uuid) to authenticated;

drop policy aip_periods_read on tracks.aip_periods;
create policy aip_periods_read on tracks.aip_periods for select to authenticated
using (
  tracks.is_provisioned()
  and (not is_demo or tracks.demo_mode_enabled())
);

drop policy aip_periods_admin_write on tracks.aip_periods;
create policy aip_periods_admin_write on tracks.aip_periods for all to authenticated
using (
  tracks.is_planning_admin()
  and (not is_demo or tracks.demo_mode_enabled())
)
with check (
  tracks.is_planning_admin()
  and (not is_demo or tracks.demo_mode_enabled())
);

drop policy aips_read on tracks.aips;
create policy aips_read on tracks.aips for select to authenticated
using (tracks.is_provisioned() and tracks.period_visible(period_id));

drop policy aips_planning_write on tracks.aips;
create policy aips_planning_write on tracks.aips for all to authenticated
using (tracks.is_planning() and tracks.period_visible(period_id))
with check (tracks.is_planning() and tracks.period_visible(period_id));

-- ---------------------------------------------------------------------------
-- 3. The demo cast
-- ---------------------------------------------------------------------------
--
-- Profiles with no auth user. They put a name on an encoded row, an approval
-- and an obligation, so the demo reads like a year somebody actually worked
-- rather than a table of nulls. `auth_user_id` is null and no invitation is
-- ever written for these addresses, so there is nothing to sign in as: the
-- `.invalid` TLD is reserved by RFC 2606 and can never receive mail either.

create or replace function tracks.demo_profile(p_key text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_email text := 'demo.' || p_key || '@bayugan.invalid';
  v_id    uuid;
begin
  select id into v_id from tracks.profiles where email = v_email;
  if v_id is not null then
    return v_id;
  end if;
  insert into tracks.profiles (auth_user_id, email, full_name, global_role, active)
  values (null, v_email, p_name, 'user', true)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function tracks.demo_profile(text, text) from public;

-- ---------------------------------------------------------------------------
-- 4. rebuild_demo_data() — the seed and the reset, which are the same thing
-- ---------------------------------------------------------------------------
--
-- "Reset the demo" and "create the demo" differ only in whether there was
-- anything there before, so they are one function. Everything it deletes is
-- reached by joining back to `aip_periods.is_demo`; there is no statement in
-- here whose WHERE clause could match a real row.
--
-- The four execution tables are deleted FIRST and by hand: allotments,
-- obligations and disbursements reference ppas `on delete restrict`, precisely
-- so that a project with money recorded against it cannot be quietly deleted
-- out from under Budget. Reviews, returns and progress cascade from `ppas`,
-- and `ppas` cascades from `aips`.
--
-- `ppa_revisions` is NOT deleted, and that is deliberate. It has no DELETE
-- policy for anybody, and a reset that erased the trail would be the one thing
-- in this schema allowed to rewrite history. The old entries point at PPA ids
-- that no longer exist, so nothing renders them; they are the record that a
-- demo generation existed and was cleared.
--
-- SECURITY DEFINER because it writes to tables whose policies belong to other
-- offices — a planning administrator cannot insert an obligation, and should
-- not be able to. The role check is the first statement in the body, which is
-- what a definer function owes you: the lock it bypasses is written out where
-- it can be read.

create or replace function tracks.rebuild_demo_data()
returns uuid
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_period uuid;
  v_year   integer;
  v_plan   uuid;
  v_head   uuid;
  v_enc    uuid;
  v_budget uuid;
  v_acct   uuid;
  d        record;
  v_aip    uuid;
  v_status text;
  v_row    uuid;
  r        integer;
  v_ps     numeric(16,2);
  v_mooe   numeric(16,2);
  v_co     numeric(16,2);
  v_amt    numeric(16,2);
  v_ob     uuid;
  v_month  integer;
  v_count  integer := 0;
begin
  perform tracks.require_role(array['planning_admin']);

  -- The demo year is reused if there is one, so the URL somebody bookmarked
  -- mid-demo still resolves after a reset. Otherwise the newest free year at
  -- or below 2025 — behind any plausible real programme, so getCurrentPeriod()
  -- never lands on it.
  select id, year into v_period, v_year
  from tracks.aip_periods where is_demo order by year desc limit 1;

  if v_period is null then
    -- ORDER BY, not the order generate_series emits in: the anti-join below is
    -- free to reorder its input, and without this the demo lands on whichever
    -- free year the planner happened to produce first.
    select y into v_year
    from generate_series(2025, 2015, -1) y
    where not exists (select 1 from tracks.aip_periods p where p.year = y)
    order by y desc
    limit 1;

    if v_year is null then
      raise exception
        'No free year between 2015 and 2025 for the demo programme. Remove an unused period first.'
        using errcode = '23505';
    end if;

    insert into tracks.aip_periods
      (year, title, draft_label, nta_amount, status, is_demo)
    values
      (v_year, 'CY ' || v_year || ' Annual Investment Program (DEMO)',
       'DEMO DATA', 1850000000.00, 'consolidating', true)
    returning id into v_period;
  end if;

  -- Back to its starting state, whatever anyone did to it.
  delete from tracks.disbursements where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.obligations where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.allotments where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.aip_actions
   where period_id in (select id from tracks.aip_periods where is_demo);

  -- ppas cascade from here, and reviews, returns and progress cascade from ppas.
  delete from tracks.aips
   where period_id in (select id from tracks.aip_periods where is_demo);

  update tracks.aip_periods
     set title       = 'CY ' || v_year || ' Annual Investment Program (DEMO)',
         draft_label = 'DEMO DATA',
         nta_amount  = 1850000000.00,
         status      = 'consolidating'
   where id = v_period;

  v_plan   := tracks.demo_profile('planning',   'Perla Villanueva (demo)');
  v_head   := tracks.demo_profile('head',       'Hector Lim (demo)');
  v_enc    := tracks.demo_profile('encoder',    'Elena Cruz (demo)');
  v_budget := tracks.demo_profile('budget',     'Benito Ramos (demo)');
  v_acct   := tracks.demo_profile('accounting', 'Aurora Diaz (demo)');

  for d in
    select dep.id, dep.display_name,
           row_number() over (order by s.sort_order, dep.sort_order) as idx
    from tracks.departments dep
    join tracks.sectors s on s.id = dep.sector_id
    where dep.active
    order by s.sort_order, dep.sort_order
  loop
    -- Mostly worked through and accepted, which is what the office wants to
    -- show. One office in ten is still drafting and one has a correction
    -- outstanding, so the submission lock and the return flow are both
    -- reachable from the demo rather than only describable.
    v_status := case
      when d.idx % 10 = 1 then 'draft'
      when d.idx % 10 = 2 then 'returned'
      when d.idx % 5  = 3 then 'submitted'
      else 'accepted'
    end;

    insert into tracks.aips (
      period_id, department_id, kind, status,
      submitted_at, submitted_by, accepted_at, accepted_by, created_by)
    values (
      v_period, d.id, 'annual', v_status,
      case when v_status <> 'draft'
           then make_timestamptz(v_year, 2, 5 + (d.idx % 20)::int, 9, 30, 0) end,
      case when v_status <> 'draft' then v_head end,
      case when v_status = 'accepted'
           then make_timestamptz(v_year, 3, 1 + (d.idx % 25)::int, 14, 15, 0) end,
      case when v_status = 'accepted' then v_plan end,
      v_enc)
    returning id into v_aip;

    insert into tracks.ppas (
      aip_id, department_id, row_kind, description, sort_order, created_by)
    values (
      v_aip, d.id, 'header', 'General and Administrative Operation', 1, v_enc);

    for r in 1..4 loop
      v_ps   := case when r = 1 then 4000000 + d.idx * 310000 else 0 end;
      v_mooe := case when r = 2 then 1800000 + d.idx * 120000
                     when r = 3 then  950000 + d.idx *  45000 else 0 end;
      v_co   := case when r = 4 then 6500000 + d.idx * 520000 else 0 end;
      v_amt  := v_ps + v_mooe + v_co;

      insert into tracks.ppas (
        aip_id, department_id, row_kind, ref_code, description,
        implementing_office, start_date, end_date, expected_output,
        funding_source, amount_ps, amount_mooe, amount_fe, amount_co,
        sort_order, created_by)
      values (
        v_aip, d.id, 'ppa',
        '1000-000-2-1-01-' || lpad(d.idx::text, 3, '0') || '-' || lpad(r::text, 3, '0'),
        case r
          when 1 then 'Administrative Cost for Salaries, Wages and Benefits'
          when 2 then 'Maintenance and Other Operating Requirements'
          when 3 then 'Capacity Building and Training of Personnel'
          else        'Acquisition of Equipment and Facilities'
        end,
        d.display_name,
        make_date(v_year, 1, 1), make_date(v_year, 12, 31),
        case r
          when 1 then 'Provided salaries and wages for personnel'
          when 2 then 'Sustained day-to-day operations for twelve months'
          when 3 then 'Trained personnel on mandated programs'
          else        'Procured equipment per the approved Procurement Plan'
        end,
        'GF', v_ps, v_mooe, 0, v_co, r + 1, v_enc)
      returning id into v_row;

      v_count := v_count + 1;

      -- The head reads every line before the office signs it off.
      if v_status <> 'draft' then
        insert into tracks.ppa_reviews (
          ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
        values (
          v_row, 'department', 'approved', 'Consistent with the PPMP.', v_head,
          make_timestamptz(v_year, 2, 4 + (d.idx % 20)::int, 16, 0, 0));
      end if;

      -- City Planning's reading. A submitted office is still waiting on it,
      -- which is exactly the state the review column exists to show.
      if v_status = 'accepted' then
        insert into tracks.ppa_reviews (
          ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
        values (
          v_row, 'planning', 'approved', null, v_plan,
          make_timestamptz(v_year, 2, 25, 11, 0, 0));
      elsif v_status = 'returned' then
        if r = 2 then
          insert into tracks.ppa_reviews (
            ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
          values (
            v_row, 'planning', 'returned',
            'Split the operating requirement by object of expenditure.', v_plan,
            make_timestamptz(v_year, 2, 26, 10, 0, 0));
          insert into tracks.ppa_returns (ppa_id, reason, returned_by, returned_at)
          values (
            v_row, 'Split the operating requirement by object of expenditure.',
            v_plan, make_timestamptz(v_year, 2, 26, 10, 0, 0));
        else
          insert into tracks.ppa_reviews (
            ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
          values (v_row, 'planning', 'approved', null, v_plan,
                  make_timestamptz(v_year, 2, 26, 10, 0, 0));
        end if;
      end if;

      -- Money only follows acceptance, the way it does in the office: Budget
      -- allots against an accepted line, obligates against the allotment, and
      -- Accounting pays against the obligation. Spread across the year so the
      -- deck's execution curve has a shape rather than a step.
      if v_status = 'accepted' then
        insert into tracks.allotments (
          ppa_id, amount, allotment_date, reference_no, remarks, recorded_by)
        values (
          v_row, round(v_amt * 0.90, 2), make_date(v_year, 2, 15),
          'SARO-' || lpad(d.idx::text, 3, '0') || '-' || r,
          'First release.', v_budget);

        v_month := 3 + ((d.idx + r) % 5)::int;

        insert into tracks.obligations (
          ppa_id, obr_no, obligation_date, payee, particulars, amount, recorded_by)
        values (
          v_row, 'OBR-' || v_year || '-' || lpad((d.idx * 4 + r)::text, 4, '0'),
          make_date(v_year, v_month, 12), 'Various payees',
          'Obligated per approved programme of work.',
          round(v_amt * 0.40, 2), v_budget)
        returning id into v_ob;

        insert into tracks.disbursements (
          ppa_id, obligation_id, dv_no, check_ada_no, disbursement_date,
          payee, particulars, amount, recorded_by)
        values (
          v_row, v_ob, 'DV-' || v_year || '-' || lpad((d.idx * 4 + r)::text, 4, '0'),
          'ADA-' || lpad((d.idx * 4 + r)::text, 5, '0'),
          make_date(v_year, least(v_month + 2, 12), 20), 'Various payees',
          'Payment of obligations incurred.',
          round(v_amt * 0.40 * 0.75, 2), v_acct);

        insert into tracks.obligations (
          ppa_id, obr_no, obligation_date, payee, particulars, amount, recorded_by)
        values (
          v_row, 'OBR-' || v_year || '-' || lpad((d.idx * 4 + r + 500)::text, 4, '0'),
          make_date(v_year, least(v_month + 4, 12), 8), 'Various payees',
          'Second tranche against the same allotment.',
          round(v_amt * 0.25, 2), v_budget)
        returning id into v_ob;

        insert into tracks.disbursements (
          ppa_id, obligation_id, dv_no, disbursement_date,
          payee, particulars, amount, recorded_by)
        values (
          v_row, v_ob, 'DV-' || v_year || '-' || lpad((d.idx * 4 + r + 500)::text, 4, '0'),
          make_date(v_year, 12, 15), 'Various payees',
          'Final payment for the year.', round(v_amt * 0.25 * 0.60, 2), v_acct);

        -- Not every line reports progress, and the deck says how much of the
        -- programme its weighted average speaks for. A demo in which every row
        -- reports would hide that the report handles the gap.
        if (d.idx + r) % 3 <> 0 then
          insert into tracks.ppa_progress (
            ppa_id, as_of_date, percent_complete, remarks, recorded_by)
          values (
            v_row, make_date(v_year, 9, 30),
            least(95, 35 + ((d.idx * 7 + r * 11) % 55))::numeric(5,2),
            'Third quarter accomplishment report.', v_head);
        end if;
      end if;
    end loop;
  end loop;

  -- The paper leg. It went to the LDC and came back, which is why the period
  -- is `consolidating` and not `for_ldc` — paper comes back as well as goes
  -- out, and a demo in which it only ever goes out teaches the wrong thing.
  insert into tracks.aip_actions (
    period_id, stage, action, action_date, reference_no, remarks, recorded_by)
  values
    (v_period, 'ldc', 'endorsed', make_date(v_year, 3, 18),
     'LDC Resolution No. 04-' || v_year,
     'Endorsed to the Office of the City Mayor.', v_plan),
    (v_period, 'mayor', 'returned', make_date(v_year, 4, 2),
     'Memorandum No. 22-' || v_year,
     'Returned for realignment of the capital outlay before transmittal to the Sangguniang Panlungsod.',
     v_plan);

  perform tracks.write_audit(
    'demo.rebuild', 'aip_periods', v_period, null,
    jsonb_build_object('year', v_year, 'ppa_rows', v_count), null);

  return v_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The switch itself
-- ---------------------------------------------------------------------------
--
-- Enabling for the first time builds the year. Enabling again does not rebuild
-- it: somebody turning the demo back on after a week wants what they left, and
-- rebuilding is its own button that says what it does.

create or replace function tracks.set_demo_mode(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = tracks, public
as $$
begin
  perform tracks.require_role(array['planning_admin']);

  insert into tracks.lgu_settings (id, demo_mode) values (true, p_on)
  on conflict (id) do update set demo_mode = excluded.demo_mode;

  if p_on and not exists (select 1 from tracks.aip_periods where is_demo) then
    perform tracks.rebuild_demo_data();
  end if;

  perform tracks.write_audit(
    case when p_on then 'demo.enable' else 'demo.disable' end,
    'lgu_settings', null, null, jsonb_build_object('demo_mode', p_on), null);

  return p_on;
end;
$$;

revoke execute on function tracks.rebuild_demo_data()      from public;
revoke execute on function tracks.set_demo_mode(boolean)   from public;
grant  execute on function tracks.rebuild_demo_data()      to authenticated;
grant  execute on function tracks.set_demo_mode(boolean)   to authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the settings panel needs to say
-- ---------------------------------------------------------------------------
--
-- The panel reports how much is in the demo year — and has to be able to do it
-- WHILE the year is hidden, which is exactly when somebody is deciding whether
-- to turn it back on. Every other read of the demo period goes through RLS and
-- correctly sees nothing, so this one function is the deliberate exception: it
-- is SECURITY DEFINER, it is planning-administrator only, and it returns three
-- counts and a title. It exposes no row.

create or replace function tracks.demo_standing()
returns jsonb
language plpgsql
stable
security definer
set search_path = tracks, public
as $$
declare
  v_period record;
begin
  perform tracks.require_role(array['planning_admin']);

  select per.id, per.year, per.title into v_period
  from tracks.aip_periods per where per.is_demo
  order by per.year desc limit 1;

  if v_period.id is null then
    return jsonb_build_object('enabled', tracks.demo_mode_enabled(), 'period', null);
  end if;

  return jsonb_build_object(
    'enabled', tracks.demo_mode_enabled(),
    'period', jsonb_build_object(
      'id',    v_period.id,
      'year',  v_period.year,
      'title', v_period.title,
      'aipCount', (select count(*) from tracks.aips a where a.period_id = v_period.id),
      'ppaCount', (select count(*) from tracks.ppas p
                   join tracks.aips a on a.id = p.aip_id
                   where a.period_id = v_period.id and p.row_kind = 'ppa')));
end;
$$;

revoke execute on function tracks.demo_standing() from public;
grant execute on function tracks.demo_standing() to authenticated;

commit;
