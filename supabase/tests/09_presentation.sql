-- 09_presentation.sql — the City Planning presentation deck.
--
-- The deck is a second way of reading numbers the AIP workbook already prints,
-- and the whole risk of building one is that the two drift. So the assertions
-- here are almost all EQUALITIES AGAINST THE AUTHORITATIVE VIEWS rather than
-- against literals: the deck's grand total against v_period_totals, its sector
-- bars against v_sector_totals, its office bars against v_aip_totals. Write a
-- literal and the test passes while the slide behind the Mayor says something
-- the workbook on his desk does not.
--
-- What else has to hold:
--   * a heading is not a line of the programme and is never counted
--   * a statutory document is its own deck and is not in the annual one
--   * a drill-down recomputes over the visible rows and says it did
--   * physical progress that was never reported is not 0%
--   * barangay is DERIVED FROM TEXT — there is no location field — and an
--     amount is attributed only where exactly one barangay is named

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set BUDGET     '''66666666-6666-6666-6666-666666666666'''
\set ACCTG      '''77777777-7777-7777-7777-777777777777'''

\set PERIOD   '''60000000-0000-0000-0000-000000000001'''
\set CMO      '''d0000000-0000-0000-0000-000000000001'''
\set CHO      '''d0000000-0000-0000-0000-000000000003'''
\set PUBLIC   '''50000000-0000-0000-0000-000000000001'''
\set CMO_AIP  '''70000000-0000-0000-0000-000000000001'''
\set CHO_AIP  '''70000000-0000-0000-0000-000000000002'''
\set PPA_1    '''90000000-0000-0000-0000-000000000001'''
\set CHO_PPA  '''90000000-0000-0000-0000-000000000004'''
\set CDF      '''f0000000-0000-0000-0000-000000000001'''

-- Set the stage as the owner. 08 may have moved the period along the paper
-- trail; the deck is read at every status, but the rows have to be reachable.
update tracks.aip_periods set status = 'open' where id = :PERIOD::uuid;

-- Two barangay-named rows in CMO, so the derived location report has something
-- to read: one naming a single barangay, one naming two.
delete from tracks.ppas where description in
  ('Concreting of Brgy. Taglatawan Road', 'Water system for Barangay Salvacion and Brgy. Poblacion');
insert into tracks.ppas (id, aip_id, department_id, row_kind, description,
                         implementing_office, funding_source,
                         amount_ps, amount_mooe, amount_fe, amount_co, sort_order) values
  ('90000000-0000-0000-0000-0000000000a1', :CMO_AIP::uuid, :CMO::uuid, 'ppa',
   'Concreting of Brgy. Taglatawan Road', 'City Engineering Office', '20% CDF',
   0, 0, 0, 4000000.00, 20),
  ('90000000-0000-0000-0000-0000000000a2', :CMO_AIP::uuid, :CMO::uuid, 'ppa',
   'Water system for Barangay Salvacion and Brgy. Poblacion', 'City Engineering Office', null,
   0, 0, 0, 6000000.00, 21);

-- Money moving on one row only, so "reported" and "not reported" are both in
-- the sample and the variance figure has to except the second.
delete from tracks.disbursements where ppa_id = :PPA_1::uuid;
delete from tracks.obligations   where ppa_id = :PPA_1::uuid;
delete from tracks.allotments    where ppa_id = :PPA_1::uuid;
delete from tracks.ppa_progress  where ppa_id = :PPA_1::uuid;
insert into tracks.allotments (ppa_id, amount, allotment_date)
values (:PPA_1::uuid, 40000000.00, '2027-01-15');
insert into tracks.obligations (id, ppa_id, obr_no, obligation_date, amount)
values ('b0000000-0000-0000-0000-0000000000f1', :PPA_1::uuid, 'OBR-1', '2027-02-01', 30000000.00);
insert into tracks.disbursements (ppa_id, obligation_id, dv_no, disbursement_date, amount)
values (:PPA_1::uuid, 'b0000000-0000-0000-0000-0000000000f1', 'DV-1', '2027-03-01', 12000000.00);
insert into tracks.ppa_progress (ppa_id, as_of_date, percent_complete)
values (:PPA_1::uuid, '2027-03-31', 40.00);

-- ---------------------------------------------------------------------------
-- 51. The deck's grand total IS the AIP form's grand total
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  (select total_amount from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id is null),
  '51a. The deck''s grand total is v_period_totals, to the centavo');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_ps')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_mooe')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_fe')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_co')::numeric,
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  '51b. The expense classes add to the total, as column (12) does');

-- ---------------------------------------------------------------------------
-- 52. Every bar on every ranked slide is a figure the workbook already prints
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select count(*)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'sectors') s
   join tracks.v_sector_totals v
     on v.sector_id = (s->>'sector_id')::uuid
    and v.period_id = :PERIOD::uuid and v.kind = 'annual' and v.fund_id is null
   where (s->>'total_amount')::numeric <> v.total_amount),
  0,
  '52a. Every sector bar equals v_sector_totals for that sector');

select tracks_test.eq(
  (select count(*)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'offices') o
   join (select department_id, sum(total_amount) as total_amount
           from tracks.v_aip_totals
          where period_id = :PERIOD::uuid and kind = 'annual' and fund_id is null
          group by department_id) v
     on v.department_id = (o->>'department_id')::uuid
   where (o->>'total_amount')::numeric <> v.total_amount),
  0,
  '52b. Every office bar equals v_aip_totals for that department');

select tracks_test.eq(
  (select round(sum((s->>'share_pct')::numeric), 0) from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'sectors') s),
  100::numeric,
  '52c. The sector shares are shares of the whole and add to 100');

-- ---------------------------------------------------------------------------
-- 53. Every split is a partition of the same rows
--
-- Funded/unfunded and continuing/new must each add back to the grand total. A
-- slide that splits the programme into two figures which do not sum to it is
-- a slide somebody will be asked about in a council session.
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'funded_amount')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'unfunded_amount')::numeric,
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  '53a. Funded plus unfunded is the whole programme');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'continuing_amount')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'new_amount')::numeric,
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  '53b. Continuing plus new is the whole programme');

select tracks_test.eq(
  (select sum((f->>'total_amount')::numeric) from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'funding_sources') f),
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  '53c. The funding sources add to the whole programme, "Not stated" included');

-- The row with no funding source is counted as unfunded rather than dropped.
select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'unfunded_count')::int >= 1,
  true,
  '53d. A row with column (7) blank is reported unfunded, not omitted');

-- ---------------------------------------------------------------------------
-- 54. A heading is a caption, not a line of the programme
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'ppa_count')::int,
  (select count(*)::int from tracks.v_ppa_rows
    where period_id = :PERIOD::uuid and aip_kind = 'annual'
      and fund_id is null and row_kind = 'ppa'),
  '54a. Total PPAs counts programme lines, never column-C captions');

select tracks_test.eq(
  (select count(*)::int from tracks.v_presentation_ppa
    where period_id = :PERIOD::uuid and description = 'General and Administrative Operation'),
  0,
  '54b. A heading is nowhere in the presentation fact rows');

-- ---------------------------------------------------------------------------
-- 55. A statutory fund is a document of its own, not a slice of the AIP
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid, 'annual', :CDF::uuid)
     ->'overview'->>'total_amount')::numeric,
  (select coalesce(total_amount, 0) from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id = :CDF::uuid),
  '55a. The fund''s deck reports the fund''s own programmed total');

select tracks_test.eq(
  (select count(*)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'top_ppas') p
   where p->>'description' = 'Concreting of Barangay Road'),
  0,
  '55b. A statutory row is nowhere in the annual programme''s deck');

-- The fund is stated beside the programme as a figure, which is what the
-- resources slide reads. It is never inside the grand total.
select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'resources'->>'annual_programmed')::numeric,
  (select total_amount from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id is null),
  '55c. The resources slide states the annual programme, statutory money excluded');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'resources'->>'statutory_programmed')::numeric,
  (select coalesce(sum(programmed_amount), 0) from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and active),
  '55d. Statutory money is stated once, beside the programme');

-- ---------------------------------------------------------------------------
-- 56. A drill-down recomputes over the visible rows, and says so
--
-- The grid already marks a filtered subtotal "(filtered rows only)". The deck
-- follows the same rule: a total that silently included hidden rows would be
-- worse than no total.
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid, 'annual', null, :PUBLIC::uuid)->>'filtered')::boolean,
  true,
  '56a. A sector drill-down marks the deck filtered');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->>'filtered')::boolean,
  false,
  '56b. The whole programme is not marked filtered');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid, 'annual', null, :PUBLIC::uuid)
     ->'overview'->>'total_amount')::numeric,
  (select total_amount from tracks.v_sector_totals
    where period_id = :PERIOD::uuid and kind = 'annual'
      and fund_id is null and sector_id = :PUBLIC::uuid),
  '56c. Filtered to one sector, the total is that sector''s — recomputed in SQL');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid, 'annual', null, null, :CHO::uuid)
     ->'overview'->>'total_amount')::numeric,
  (select sum(total_amount) from tracks.v_aip_totals
    where period_id = :PERIOD::uuid and kind = 'annual'
      and fund_id is null and department_id = :CHO::uuid),
  '56d. Filtered to one office, the total is that office''s');

-- The pickers still offer the whole document, not just what survived the
-- filter — otherwise choosing a sector would leave no way back to the others.
select tracks_test.eq(
  (select jsonb_array_length(
     tracks.presentation_deck(:PERIOD::uuid, 'annual', null, :PUBLIC::uuid)
       ->'options'->'sectors')),
  (select count(distinct sector_id)::int from tracks.v_presentation_ppa
    where period_id = :PERIOD::uuid and aip_kind = 'annual' and fund_id is null),
  '56e. A drill-down does not shrink the filter pickers');

-- ---------------------------------------------------------------------------
-- 57. Execution figures are v_ppa_financials, unchanged
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'allotted')::numeric,
  (select coalesce(sum(f.allotted), 0) from tracks.v_ppa_financials f
   join tracks.v_ppa_rows r on r.id = f.ppa_id
   where r.period_id = :PERIOD::uuid and r.aip_kind = 'annual' and r.fund_id is null),
  '57a. Allotment on the execution slide is v_ppa_financials'' allotment');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'obligation_rate')::numeric,
  30000000.00 / 40000000.00 * 100,
  '57b. Utilisation is measured against the allotment, not the programmed amount');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'unpaid')::numeric,
  18000000.00,
  '57c. Unpaid obligations are obligated less disbursed');

-- ---------------------------------------------------------------------------
-- 58. Physical progress that was never reported is not zero
--
-- Averaging an unreported row in as 0% manufactures an alarm. It is left out
-- of the denominator, and the slide is given the coverage so it can say how
-- many rows the figure speaks for.
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'physical_weighted_pct')::numeric,
  40.00,
  '58a. Weighted physical progress is read from the rows that reported one');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'physical_reported_count')::int,
  1,
  '58b. The deck says how many rows the physical figure speaks for');

select tracks_test.eq(
  (select count(*)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'progress') p
   where p->>'state' = 'unreported' and (p->>'ppa_count')::int > 0),
  1,
  '58c. "Not reported" is a state of its own, never rendered as 0%');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'variance_points')::numeric,
  75.00 - 40.00,
  '58d. The financial/physical variance compares the same rows: the reported ones');

-- ---------------------------------------------------------------------------
-- 59. Barangay is derived from text, and says only what the text says
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select (b->>'total_amount')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'barangays') b
   where b->>'name' = 'Taglatawan'),
  4000000.00,
  '59a. A row naming one barangay is attributed to it');

select tracks_test.eq(
  (select count(*)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'barangays') b
   where b->>'name' in ('Salvacion', 'Poblacion')),
  0,
  '59b. A row naming two barangays is attributed to neither — it would be counted twice');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'location_coverage'->>'multiple_amount')::numeric,
  6000000.00,
  '59c. A row naming several barangays is reported in its own bucket, not dropped');

select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'location_coverage'->>'single_amount')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'location_coverage'->>'multiple_amount')::numeric
  + (tracks.presentation_deck(:PERIOD::uuid)->'location_coverage'->>'unstated_amount')::numeric,
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  '59d. Located, multi-located and unlocated money is the whole programme');

select tracks_test.eq(
  tracks.barangay_mentions('Construction of Barangay Road'),
  '{}'::text[],
  '59e. "Barangay Road" names no barangay');

-- ---------------------------------------------------------------------------
-- 60. The pipeline and the multi-year series
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select (f->>'ppa_count')::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'checkpoints') f where f->>'key' = 'encoded'),
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'ppa_count')::int,
  '60a. The first checkpoint is every line of the programme');

-- Deliberately NOT asserting that the checkpoints fall monotonically. They do
-- not, and the reason matters: reopen_aip returns an accepted AIP to draft
-- without erasing a reading, rows written before the two-stage review carry no
-- reading at all, and an obligation can be recorded against a PPA with no
-- allotment entered. A row can therefore be accepted with no department
-- approval on record. What must hold is that no checkpoint claims more rows
-- than exist — each is counted on its own evidence and none is inferred from
-- another.
select tracks_test.eq(
  (select bool_and((f->>'ppa_count')::int
                   <= (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'ppa_count')::int)
     from jsonb_array_elements(tracks.presentation_deck(:PERIOD::uuid)->'checkpoints') f),
  true,
  '60b. No checkpoint claims more rows than the programme has');

select tracks_test.eq(
  (select sum((s->>'ppa_count')::int)::int from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'stages') s),
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'ppa_count')::int,
  '60c. Every line stands at exactly one stage');

select tracks_test.eq(
  (select jsonb_array_length(tracks.presentation_deck(:PERIOD::uuid)->'trend')),
  (select count(*)::int from tracks.aip_periods),
  '60d. The trend covers every year on record, so a gap shows as a gap');

-- ---------------------------------------------------------------------------
-- 62. The year, month by month
--
-- The curve behind the Mayor and the totals beside it are the same money, so
-- the last point of the cumulative line has to BE the total. It is asserted
-- against v_ppa_financials rather than a literal, for the same reason every
-- other figure here is.
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select jsonb_array_length(tracks.presentation_deck(:PERIOD::uuid)->'monthly')),
  12,
  '62a. The series runs January to December, whatever is in it');

select tracks_test.eq(
  (select (m->>'obligated')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Feb'),
  30000000.00,
  '62b. An obligation lands in the month it was dated');

select tracks_test.eq(
  (select (m->>'disbursed')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Mar'),
  12000000.00,
  '62c. A disbursement lands in the month it was dated');

select tracks_test.eq(
  (select (m->>'obligated_cumulative')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Dec'),
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'obligated')::numeric,
  '62d. December''s cumulative obligation IS the total on the same slide');

select tracks_test.eq(
  (select (m->>'disbursed_cumulative')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Dec'),
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'disbursed')::numeric,
  '62e. December''s cumulative disbursement IS the total on the same slide');

select tracks_test.eq(
  (select bool_and(cur >= prev) from (
     select (m->>'obligated_cumulative')::numeric as cur,
            lag((m->>'obligated_cumulative')::numeric)
              over (order by (m->>'month')::int) as prev
     from jsonb_array_elements(tracks.presentation_deck(:PERIOD::uuid)->'monthly') m) q
   where prev is not null),
  true,
  '62f. A cumulative line never goes down');

-- Money committed before the programme year opened is already committed in
-- January. A curve that started it at zero would draw a jump that never
-- happened.
insert into tracks.obligations (ppa_id, obr_no, obligation_date, amount)
values (:CHO_PPA::uuid, 'OBR-PRIOR', '2026-11-30', 1000000.00);

select tracks_test.eq(
  (select (m->>'obligated_cumulative')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Jan'),
  1000000.00,
  '62g. An obligation dated before the year opens January, it does not vanish');

select tracks_test.eq(
  (select (m->>'obligated')::numeric from jsonb_array_elements(
     tracks.presentation_deck(:PERIOD::uuid)->'monthly') m where m->>'label' = 'Jan'),
  0::numeric,
  '62h. ...but it is not counted as January''s own activity');

delete from tracks.obligations where obr_no = 'OBR-PRIOR';

-- ---------------------------------------------------------------------------
-- 61. Who may read it
--
-- The deck bypasses nothing: it is SECURITY INVOKER over security_invoker
-- views, so the same policies that govern the grid govern the slides. Reading
-- the programme is city-wide (ppas_read is is_provisioned()); writing is not,
-- and nothing here writes.
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'overview'->>'total_amount')::numeric,
  (select total_amount from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id is null),
  '61a. A City Planning sector officer reads the whole programme');
select tracks_test.logout();

select tracks_test.login(:BUDGET::uuid);
select tracks_test.eq(
  (tracks.presentation_deck(:PERIOD::uuid)->'execution'->>'obligated')::numeric,
  30000000.00,
  '61b. The Budget Office reads the execution figures it recorded');
select tracks_test.logout();

-- The deck is SECURITY INVOKER: reading it leaves the caller exactly the
-- permissions they had. An UPDATE the policy filters to nothing changes
-- nothing and raises nothing, so the assertion is that the figure did not
-- move — the same shape as 49b.
select tracks_test.login(:CMO_HEAD::uuid);
select tracks.presentation_deck(:PERIOD::uuid) is not null;
update tracks.ppas set amount_co = 1 where id = '90000000-0000-0000-0000-0000000000a1';
select tracks_test.eq(
  (select amount_co from tracks.ppas where id = '90000000-0000-0000-0000-0000000000a1'),
  4000000.00::numeric,
  '61c. Reading the deck grants no write the caller did not already have');
select tracks_test.logout();
