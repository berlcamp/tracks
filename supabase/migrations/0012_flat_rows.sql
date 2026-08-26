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
