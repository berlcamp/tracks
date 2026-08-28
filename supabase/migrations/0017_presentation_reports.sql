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
