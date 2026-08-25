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
