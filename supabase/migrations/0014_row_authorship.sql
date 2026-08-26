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
