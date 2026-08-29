-- 11_demo.sql — demo mode.
--
-- Two properties are asserted here, and the second is what makes the first
-- safe to have built at all:
--
--   * The switch HIDES a year rather than deleting one, and it hides it from
--     everybody — including the City Planning Office, whose policies are FOR
--     ALL and therefore also govern SELECT. A predicate added to `aips_read`
--     alone would hide the demo from a department head and leave it in plain
--     view of the one audience the switch exists for.
--
--   * Nothing in demo mode can reach a real programme. Every statement in
--     rebuild_demo_data() is scoped to `aip_periods.is_demo`, so the strongest
--     claim worth testing is the negative one: seed it, edit it, reset it, and
--     show the real rows never moved.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set BUDGET     '''66666666-6666-6666-6666-666666666666'''

-- What the real programme looks like before demo mode has ever been on. Every
-- assertion about "the real rows never moved" is measured against these.
create temporary table demo_baseline as
select
  (select count(*) from tracks.aip_periods where not is_demo)          as periods,
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id
   where not p.is_demo)                                                as aips,
  (select count(*) from tracks.ppas pp
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id
   where not p.is_demo)                                                as ppas,
  (select coalesce(sum(amount_total), 0) from tracks.ppas pp
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id
   where not p.is_demo)                                                as pesos;

-- The baseline is read back from inside `set role authenticated`, so it has to
-- be readable there: a temp table belongs to the session's own role and grants
-- nothing to anybody else by default.
grant select on demo_baseline to authenticated;

-- ---------------------------------------------------------------------------
-- 74. The switch builds a year
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  'select tracks.set_demo_mode(true)',
  '74a. A sector officer cannot turn demo mode on');
select tracks_test.throws(
  'select tracks.rebuild_demo_data()',
  '74b. Nor rebuild the demo data');
select tracks_test.logout();

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(
  'select tracks.set_demo_mode(true)',
  '74c. Neither can a department head');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.set_demo_mode(true);

select tracks_test.eq(
  (select count(*) from tracks.aip_periods where is_demo), 1::bigint,
  '74d. The administrator turning it on builds exactly one demo year');

-- Behind the real programme on purpose: getCurrentPeriod() takes the latest
-- year, so a demo dated ahead of the office's own would become the year every
-- screen opened on.
select tracks_test.ok(
  (select max(year) from tracks.aip_periods where is_demo)
    < (select max(year) from tracks.aip_periods where not is_demo),
  '74e. The demo year sits behind the real one');

select tracks_test.ok(
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id
   where p.is_demo and a.status = 'accepted') > 0,
  '74f. Departments have been accepted in it');

select tracks_test.ok(
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id
   where p.is_demo and a.status = 'submitted') > 0,
  '74g. And some are still submitted, waiting to be read');

select tracks_test.ok(
  (select count(*) from tracks.ppa_reviews r
    join tracks.ppas pp on pp.id = r.ppa_id
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id
   where p.is_demo and r.stage = 'planning') > 0,
  '74h. The rows have been read at both stages');

select tracks_test.ok(
  (select count(*) from tracks.ppa_returns r
    join tracks.ppas pp on pp.id = r.ppa_id
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id
   where p.is_demo and r.resolved_at is null) > 0,
  '74i. One office has a correction outstanding, so the return flow is reachable');

select tracks_test.ok(
  (select count(*) from tracks.aip_actions ac
    join tracks.aip_periods p on p.id = ac.period_id where p.is_demo) > 0,
  '74j. The programme has a paper trail');

select tracks_test.ok(
  (select count(*) from tracks.allotments al
    join tracks.ppas pp on pp.id = al.ppa_id
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id where p.is_demo) > 0
  and (select count(*) from tracks.obligations o
    join tracks.ppas pp on pp.id = o.ppa_id
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id where p.is_demo) > 0
  and (select count(*) from tracks.disbursements di
    join tracks.ppas pp on pp.id = di.ppa_id
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id where p.is_demo) > 0,
  '74k. Budget has allotted and obligated, and Accounting has paid');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 75. Turning it off hides the year — from everybody
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.set_demo_mode(false);
select tracks_test.logout();

-- The FOR ALL policies are the whole point of this block. `aips_planning_write`
-- and `aip_periods_admin_write` govern SELECT as well as writes, and permissive
-- policies are OR'd — so before they were tightened the demo year vanished for
-- a department head and stayed in full view of City Planning.
select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.eq(
  (select count(*) from tracks.aip_periods where is_demo), 0::bigint,
  '75a. Hidden from the City Planning Administrator, whose policy is FOR ALL');
select tracks_test.eq(
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id where p.is_demo), 0::bigint,
  '75b. And its documents with it');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  (select count(*) from tracks.aip_periods where is_demo), 0::bigint,
  '75c. Hidden from the sector officer, whose policy is also FOR ALL');
select tracks_test.logout();

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.eq(
  (select count(*) from tracks.aip_periods where is_demo), 0::bigint,
  '75d. Hidden from a department head');
select tracks_test.logout();

select tracks_test.login(:BUDGET::uuid);
select tracks_test.eq(
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id where p.is_demo), 0::bigint,
  '75e. And out of the Budget Office''s worklist');
select tracks_test.logout();

-- The real programme is exactly as it was. Hiding is a predicate, not a delete.
select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.eq(
  (select count(*) from tracks.aip_periods), (select periods from demo_baseline),
  '75f. The real periods are all still there and all still visible');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 76. Nothing was deleted — turning it back on restores it
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.set_demo_mode(true);
select tracks_test.eq(
  (select count(*) from tracks.aip_periods where is_demo), 1::bigint,
  '76a. Turning it back on brings the same year back');

select id as demo_period from tracks.aip_periods where is_demo \gset
select count(*) as demo_rows from tracks.ppas pp
  join tracks.aips a on a.id = pp.aip_id
 where a.period_id = :'demo_period'::uuid and pp.row_kind = 'ppa' \gset

-- Enabling twice must not seed a second copy: somebody turning the demo back
-- on after a week wants what they left, and rebuilding is its own button.
select tracks.set_demo_mode(true);
select tracks_test.eq(
  (select count(*) from tracks.ppas pp join tracks.aips a on a.id = pp.aip_id
    where a.period_id = :'demo_period'::uuid and pp.row_kind = 'ppa'),
  :demo_rows::bigint,
  '76b. Enabling an already-built demo does not seed a second copy');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 77. Reset puts it back, and reaches nothing else
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);
select pp.id as demo_ppa
  from tracks.ppas pp join tracks.aips a on a.id = pp.aip_id
 where a.period_id = :'demo_period'::uuid and pp.row_kind = 'ppa'
 order by pp.sort_order limit 1 \gset

update tracks.ppas set description = 'EDITED DURING A DEMONSTRATION'
 where id = :'demo_ppa'::uuid;
select tracks_test.eq(
  (select description from tracks.ppas where id = :'demo_ppa'::uuid),
  'EDITED DURING A DEMONSTRATION',
  '77a. City Planning edits the demo, as anyone walking it would');

select tracks.rebuild_demo_data();

select tracks_test.eq(
  (select count(*) from tracks.ppas where id = :'demo_ppa'::uuid), 0::bigint,
  '77b. Reset discards the edited row entirely');
select tracks_test.eq(
  (select count(*) from tracks.ppas pp
    where pp.description = 'EDITED DURING A DEMONSTRATION'), 0::bigint,
  '77c. The edit is gone from the programme');
select tracks_test.eq(
  (select count(*) from tracks.ppas pp join tracks.aips a on a.id = pp.aip_id
    where a.period_id = :'demo_period'::uuid and pp.row_kind = 'ppa'),
  :demo_rows::bigint,
  '77d. And the year is back to exactly the size it was seeded at');

-- The period keeps its id, so a link somebody opened mid-demonstration still
-- resolves after the reset rather than 404ing behind them.
select tracks_test.eq(
  (select id from tracks.aip_periods where is_demo), :'demo_period'::uuid,
  '77e. The demo year keeps its id across a reset');

-- The negative claim, which is the one that matters.
select tracks_test.eq(
  (select count(*) from tracks.aips a
    join tracks.aip_periods p on p.id = a.period_id where not p.is_demo),
  (select aips from demo_baseline),
  '77f. Not one real submission was touched');
select tracks_test.eq(
  (select count(*) from tracks.ppas pp
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id where not p.is_demo),
  (select ppas from demo_baseline),
  '77g. Nor one real row of the programme');
select tracks_test.eq(
  (select coalesce(sum(amount_total), 0) from tracks.ppas pp
    join tracks.aips a on a.id = pp.aip_id
    join tracks.aip_periods p on p.id = a.period_id where not p.is_demo),
  (select pesos from demo_baseline),
  '77h. And not one real peso moved');
select tracks_test.logout();

-- Left off, so the suites that follow and any hand inspection see the real
-- programme alone.
select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.set_demo_mode(false);
select tracks_test.logout();
