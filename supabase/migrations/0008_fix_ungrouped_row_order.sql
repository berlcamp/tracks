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
