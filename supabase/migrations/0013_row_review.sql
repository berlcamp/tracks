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
