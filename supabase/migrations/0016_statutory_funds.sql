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
