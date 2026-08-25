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
