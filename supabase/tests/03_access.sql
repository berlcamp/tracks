-- 03_access.sql — who may read, and who may write what.
-- Nothing here goes through the UI; every assertion hits the database directly.
--
-- Note on UPDATE: a policy's USING clause filters rows, it does not raise. A
-- denied update therefore affects zero rows rather than throwing, so those tests
-- assert on the value afterwards, not on an exception.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CHO_HEAD   '''55555555-5555-5555-5555-555555555555'''
\set BUDGET     '''66666666-6666-6666-6666-666666666666'''
\set ACCTG      '''77777777-7777-7777-7777-777777777777'''
\set NOBODY     '''99999999-9999-9999-9999-999999999999'''

\set CMO_PPA_1  '''90000000-0000-0000-0000-000000000001'''
\set CHO_PPA    '''90000000-0000-0000-0000-000000000004'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''

-- ---------------------------------------------------------------------------
-- 1. The uninvited account
-- ---------------------------------------------------------------------------

select tracks_test.ok(
  not exists (select 1 from tracks.profiles where email = 'nobody@example.com'),
  '1a. An uninvited Google account leaves no profile behind');

select tracks_test.login(:NOBODY::uuid);
select tracks_test.eq((select count(*) from tracks.ppas)::int, 0,
  '1b. An uninvited user reads 0 PPAs');
select tracks_test.eq((select count(*) from tracks.departments)::int, 0,
  '1c. An uninvited user reads 0 departments');
select tracks_test.eq((select count(*) from tracks.aips)::int, 0,
  '1d. An uninvited user reads 0 AIPs');
select tracks_test.ok(not tracks.is_provisioned(),
  '1e. An uninvited user is not provisioned');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 2. Reads — a provisioned user sees the whole programme
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.eq((select count(*) from tracks.ppas)::int, 4,
  '2a. A department encoder can READ every department''s PPAs');
select tracks_test.eq((select count(*) from tracks.v_ppa_rows)::int, 4,
  '2b. The worksheet view is readable by a department user');
select tracks_test.logout();

select tracks_test.login(:BUDGET::uuid);
select tracks_test.eq((select count(*) from tracks.ppas)::int, 4,
  '2c. Budget reads the whole programme');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 3. Cross-department writes
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
update tracks.ppas set amount_mooe = 999 where id = :CHO_PPA::uuid;
select tracks_test.logout();
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where id = :CHO_PPA::uuid),
  44259528.00::numeric,
  '3a. CMO cannot edit CHO''s PPA');

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, description, amount_mooe)
          values (%L, %L, ''Smuggled row'', 1000)',
         '70000000-0000-0000-0000-000000000002',
         'd0000000-0000-0000-0000-000000000003'),
  '3b. CMO cannot insert a PPA into CHO''s AIP');
select tracks_test.throws(
  format('insert into tracks.aips (period_id, department_id, kind)
          values (%L, %L, ''supplemental'')',
         '60000000-0000-0000-0000-000000000001',
         'd0000000-0000-0000-0000-000000000003'),
  '3c. CMO cannot open a submission on behalf of CHO');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 4. Sector settings are City Planning's alone
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(
  'insert into tracks.sectors (code, name, sheet_name, heading, summary_label)
   values (''NEW'', ''New'', ''NEW Sector'', ''NEW SECTOR'', ''NEW SECTOR'')',
  '4a. A department head cannot create a sector');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  'insert into tracks.sectors (code, name, sheet_name, heading, summary_label)
   values (''NEW'', ''New'', ''NEW Sector'', ''NEW SECTOR'', ''NEW SECTOR'')',
  '4b. Planning STAFF cannot create a sector — admin only');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
insert into tracks.sectors (code, name, sheet_name, heading, summary_label, sort_order)
values ('TEMP', 'Temp', 'TEMP Sector', 'TEMP SECTOR', 'TEMP SECTOR', 9);
select tracks_test.eq((select count(*) from tracks.sectors where code = 'TEMP')::int, 1,
  '4c. Planning ADMIN can create a sector');
delete from tracks.sectors where code = 'TEMP';
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 5. Budget and Accounting are separate hands
-- ---------------------------------------------------------------------------

select tracks_test.login(:BUDGET::uuid);
select tracks_test.throws(
  format('insert into tracks.disbursements (ppa_id, dv_no, disbursement_date, amount)
          values (%L, ''DV-1'', ''2027-03-01'', 1000)', '90000000-0000-0000-0000-000000000001'),
  '5a. Budget cannot record a disbursement');
insert into tracks.obligations (ppa_id, obr_no, obligation_date, amount)
values (:CMO_PPA_1::uuid, 'OBR-TEST-1', '2027-02-01', 1000);
select tracks_test.eq((select count(*) from tracks.obligations where obr_no = 'OBR-TEST-1')::int, 1,
  '5b. Budget can record an obligation');
select tracks_test.logout();

select tracks_test.login(:ACCTG::uuid);
select tracks_test.throws(
  format('insert into tracks.obligations (ppa_id, obr_no, obligation_date, amount)
          values (%L, ''OBR-X'', ''2027-02-01'', 1000)', '90000000-0000-0000-0000-000000000001'),
  '5c. Accounting cannot record an obligation');
insert into tracks.disbursements (ppa_id, dv_no, disbursement_date, amount)
values (:CMO_PPA_1::uuid, 'DV-TEST-1', '2027-03-01', 500);
select tracks_test.eq((select count(*) from tracks.disbursements where dv_no = 'DV-TEST-1')::int, 1,
  '5d. Accounting can record a disbursement');
select tracks_test.logout();

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(
  format('insert into tracks.allotments (ppa_id, amount, allotment_date)
          values (%L, 1000, ''2027-01-15'')', '90000000-0000-0000-0000-000000000001'),
  '5e. A department cannot allot its own budget');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 6. History is append-only for everyone
-- ---------------------------------------------------------------------------

-- No DELETE or UPDATE policy exists on these tables, so the statement is not
-- rejected — it simply matches nothing. Assert on the surviving rows, which is
-- what actually protects the history.
select tracks_test.login(:PLAN_ADMIN::uuid);
delete from tracks.ppa_revisions;
update tracks.audit_logs set action = 'TAMPERED';
select tracks_test.logout();

select tracks_test.ok(
  (select count(*) from tracks.ppa_revisions) = 4,
  '6a. Even a planning admin cannot delete revision history');
select tracks_test.eq(
  (select count(*) from tracks.audit_logs where action = 'TAMPERED')::int, 0,
  '6b. Even a planning admin cannot rewrite the audit log');

-- Clean up the rows this suite created so later suites start from the fixture.
delete from tracks.disbursements where dv_no = 'DV-TEST-1';
delete from tracks.obligations where obr_no = 'OBR-TEST-1';
