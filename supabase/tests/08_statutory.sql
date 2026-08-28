-- 08_statutory.sql — the statutory funds a department files beside its AIP.
--
-- The 20% CDF, 5% CDRRMF, 5% GAD and 1% LCPC are separate documents with their
-- own PPA rows. What has to hold:
--
--   * an office files one only if City Planning listed it against the fund
--   * one per department per fund per year, and the annual AIP's own
--     uniqueness rule survives the nullable fund_id that was added to it
--   * a statutory document is not in the annual programme's GRAND TOTAL
--   * an unfinished statutory document does not hold the city's finalisation

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CHO_HEAD   '''55555555-5555-5555-5555-555555555555'''

\set PERIOD     '''60000000-0000-0000-0000-000000000001'''
\set CMO        '''d0000000-0000-0000-0000-000000000001'''
\set CHO        '''d0000000-0000-0000-0000-000000000003'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''
\set CDF        '''f0000000-0000-0000-0000-000000000001'''
\set GAD        '''f0000000-0000-0000-0000-000000000002'''
\set CDF_AIP    '''71000000-0000-0000-0000-000000000001'''

-- Set the stage as the owner: two funds, with the CDF assigned to CMO only.
delete from tracks.aips where fund_id is not null;
delete from tracks.statutory_fund_departments;
delete from tracks.statutory_fund_periods;
delete from tracks.statutory_funds;
update tracks.aip_periods set status = 'open';

insert into tracks.statutory_funds
  (id, code, name, short_label, sheet_name, percentage, sort_order) values
  (:CDF::uuid, 'CDF20', '20% Development Fund', '20% CDF', '20% CDF', 20.00, 1),
  (:GAD::uuid, 'GAD',   '5% Gender and Development Fund', '5% GAD', '5% GAD', 5.00, 2);

insert into tracks.statutory_fund_departments (fund_id, department_id)
values (:CDF::uuid, :CMO::uuid);

-- ---------------------------------------------------------------------------
-- 45. Who may open one
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);

select tracks_test.throws(format($f$
  insert into tracks.aips (period_id, department_id, kind, fund_id)
  values (%L, %L, 'annual', %L)$f$, :PERIOD, :CMO, :GAD),
  '45a. A department cannot file a fund it is not listed against');

insert into tracks.aips (id, period_id, department_id, kind, fund_id)
values (:CDF_AIP::uuid, :PERIOD::uuid, :CMO::uuid, 'annual', :CDF::uuid);

select tracks_test.eq(
  (select count(*)::int from tracks.aips where id = :CDF_AIP::uuid), 1,
  '45b. A listed department files its fund');

select tracks_test.throws(format($f$
  insert into tracks.aips (period_id, department_id, kind, fund_id)
  values (%L, %L, 'annual', %L)$f$, :PERIOD, :CMO, :CDF),
  '45c. One statutory document per department per fund per year');

select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
select tracks_test.throws(format($f$
  insert into tracks.aips (period_id, department_id, kind, fund_id)
  values (%L, %L, 'annual', %L)$f$, :PERIOD, :CHO, :CDF),
  '45d. Another office cannot file a fund listed to somebody else');
select tracks_test.logout();

-- The eligibility list governs what may be STARTED. Removing the department
-- must not disturb the document it already filed.
delete from tracks.statutory_fund_departments
 where fund_id = :CDF::uuid and department_id = :CMO::uuid;

select tracks_test.eq(
  (select count(*)::int from tracks.aips where id = :CDF_AIP::uuid), 1,
  '45e. Un-listing a department leaves its filed document standing');

insert into tracks.statutory_fund_departments (fund_id, department_id)
values (:CDF::uuid, :CMO::uuid);

-- ---------------------------------------------------------------------------
-- 46. The annual AIP's own uniqueness survived the nullable column
--
-- coalesce(fund_id, <sentinel>) in the index expression, because NULLs do not
-- collide in a unique index and a bare column would have quietly stopped
-- constraining anything.
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(format($f$
  insert into tracks.aips (period_id, department_id, kind)
  values (%L, %L, 'annual')$f$, :PERIOD, :CMO),
  '46a. Still only one annual AIP per department per year');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 47. A statutory document is not the annual programme
-- ---------------------------------------------------------------------------

insert into tracks.ppas (aip_id, department_id, row_kind, description,
                         amount_ps, amount_mooe, amount_fe, amount_co, sort_order)
values (:CDF_AIP::uuid, :CMO::uuid, 'ppa', 'Concreting of Barangay Road',
        0, 0, 0, 5000000.00, 1);

select tracks_test.eq(
  (select total_amount from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id is null)
  = (select total_amount from tracks.v_period_totals
      where period_id = :PERIOD::uuid and kind = 'annual' and fund_id = :CDF::uuid),
  false,
  '47a. The fund totals separately from the annual programme');

select tracks_test.eq(
  (select count(*)::int from tracks.v_ppa_rows
    where period_id = :PERIOD::uuid and fund_id is null
      and description = 'Concreting of Barangay Road'), 0,
  '47b. The fund''s row is nowhere in the annual programme');

select tracks_test.eq(
  (select total_amount from tracks.v_period_totals
    where period_id = :PERIOD::uuid and kind = 'annual' and fund_id = :CDF::uuid),
  5000000.00,
  '47c. The fund reports its own programmed total');

select tracks_test.eq(
  (select item_no from tracks.v_ppa_rows where aip_id = :CDF_AIP::uuid)::int, 1,
  '47d. A statutory document numbers its rows from one');

select tracks_test.eq(
  (select fund_label from tracks.v_ppa_rows where aip_id = :CDF_AIP::uuid), '20% CDF',
  '47e. The row carries the fund it is drawn on');

-- ---------------------------------------------------------------------------
-- 48. The ceiling
--
-- Stated as a share of a base the administrator enters. Never enforced: a
-- department encoding in September cannot be blocked by what another office
-- entered in August.
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select ceiling_amount from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and fund_id = :CDF::uuid), null::numeric,
  '48a. No base stated yet reports no ceiling, not a ceiling of zero');

insert into tracks.statutory_fund_periods (fund_id, period_id, base_amount)
values (:CDF::uuid, :PERIOD::uuid, 100000000.00);

select tracks_test.eq(
  (select ceiling_amount from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and fund_id = :CDF::uuid), 20000000.00,
  '48b. The ceiling is the stated share of the base');

select tracks_test.eq(
  (select remaining_amount from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and fund_id = :CDF::uuid), 15000000.00,
  '48c. Remaining is the ceiling less what is programmed');

-- Overage is reported, not refused.
insert into tracks.ppas (aip_id, department_id, row_kind, description,
                         amount_ps, amount_mooe, amount_fe, amount_co, sort_order)
values (:CDF_AIP::uuid, :CMO::uuid, 'ppa', 'Flood Control',
        0, 0, 0, 30000000.00, 2);

select tracks_test.eq(
  (select remaining_amount < 0 from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and fund_id = :CDF::uuid), true,
  '48d. Programming past the ceiling is reported as an overage, not refused');

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  (select count(*)::int from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid), 2,
  '48e. City Planning reads every fund''s standing for the year');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 49. Only the City Planning administrator keeps the reference data
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(format($f$
  insert into tracks.statutory_fund_departments (fund_id, department_id)
  values (%L, %L)$f$, :GAD, :CMO),
  '49a. A department head cannot list their own office against a fund');
-- An UPDATE the policy's USING clause filters to nothing changes nothing and
-- raises nothing, so the assertion is that the share is still what it was.
update tracks.statutory_funds set percentage = 50;
select tracks_test.eq(
  (select percentage from tracks.statutory_funds where id = :CDF::uuid), 20.00,
  '49b. A department head cannot change a fund''s share');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(format($f$
  insert into tracks.statutory_fund_periods (fund_id, period_id, base_amount)
  values (%L, %L, 1)$f$, :GAD, :PERIOD),
  '49c. A sector officer cannot state the year''s base — that is the administrator''s');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
insert into tracks.statutory_fund_periods (fund_id, period_id, base_amount)
values (:GAD::uuid, :PERIOD::uuid, 50000000.00);
select tracks_test.eq(
  (select ceiling_amount from tracks.v_statutory_fund_totals
    where period_id = :PERIOD::uuid and fund_id = :GAD::uuid), 2500000.00,
  '49d. The administrator states the base and the ceiling follows');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 50. An unfinished statutory document does not hold the programme
--
-- finalize_aip_period() counts the annual programme only. The thing that goes
-- to the LDC is the AIP; a statutory filing is a mandated attachment beside it,
-- and a half-encoded 1% LCPC must not stop the whole city.
-- ---------------------------------------------------------------------------

-- Bring the annual programme to a state that would otherwise finalise: both
-- department AIPs submitted with every row read and passed.
delete from tracks.ppa_reviews;
delete from tracks.ppa_returns;
update tracks.aips set status = 'submitted' where fund_id is null;

insert into tracks.ppa_reviews (ppa_id, stage, decision, reviewed_by)
select p.id, 'planning', 'approved', 'a0000000-0000-0000-0000-000000000002'
from tracks.ppas p
join tracks.aips a on a.id = p.aip_id
where a.period_id = :PERIOD::uuid and a.fund_id is null and p.row_kind = 'ppa';

-- The CDF document is left in draft, with two rows nobody has read.
select tracks_test.eq(
  (select status from tracks.aips where id = :CDF_AIP::uuid), 'draft',
  '50a. The statutory document is still with its office');

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.finalize_aip_period(:PERIOD::uuid);
select tracks_test.logout();

select tracks_test.eq(
  (select status from tracks.aip_periods where id = :PERIOD::uuid), 'for_ldc',
  '50b. The programme finalises with a statutory document still in draft');

select tracks_test.eq(
  (select status from tracks.aips where id = :CDF_AIP::uuid), 'draft',
  '50c. Finalising does not accept the statutory document by accident');

select tracks_test.eq(
  (select count(*)::int from tracks.aips
    where period_id = :PERIOD::uuid and fund_id is null and status <> 'accepted'), 0,
  '50d. Every annual submission was accepted');
