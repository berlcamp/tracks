-- 05_money.sql — the arithmetic, the rollups, and the group tree.
--
-- Every total in this system is computed in SQL. If a number can be wrong, it
-- gets a test here.

\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set BUDGET     '''66666666-6666-6666-6666-666666666666'''
\set ACCTG      '''77777777-7777-7777-7777-777777777777'''

\set CMO_AIP  '''70000000-0000-0000-0000-000000000001'''
\set PPA_1    '''90000000-0000-0000-0000-000000000001'''
\set PPA_2    '''90000000-0000-0000-0000-000000000002'''
\set CHO_PPA  '''90000000-0000-0000-0000-000000000004'''

-- ---------------------------------------------------------------------------
-- 15. The row total is column (12) = (8)+(9)+(10)+(11)
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select amount_total from tracks.ppas where id = '90000000-0000-0000-0000-000000000003'),
  2500000.00::numeric,
  '15a. amount_total is PS + MOOE + FE + CO, computed by the database');

select tracks_test.throws(
  'update tracks.ppas set amount_total = 1 where id = ''90000000-0000-0000-0000-000000000003''',
  '15b. amount_total cannot be written by hand');

select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, description)
          values (%L, %L, ''A PPA with no money'')',
         '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '15c. A PPA with a zero total is rejected');

select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, description, amount_mooe)
          values (%L, %L, ''Negative'', -5)',
         '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '15d. A negative amount is rejected');

-- ---------------------------------------------------------------------------
-- 16. Department, sector and grand totals
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select total_amount from tracks.v_aip_totals where aip_id = :CMO_AIP::uuid),
  95722053.00::numeric,
  '16a. The department subtotal row adds up (86,222,053 + 7,000,000 + 2,500,000)');

select tracks_test.eq(
  (select total_ps from tracks.v_aip_totals where aip_id = :CMO_AIP::uuid),
  86222053.00::numeric,
  '16b. The department subtotal splits PS out correctly');

select tracks_test.eq(
  (select total_amount from tracks.v_sector_totals
    where sector_code = 'SOCIAL' and kind = 'annual'),
  60559528.00::numeric,
  '16c. The sector band row adds up');

select tracks_test.eq(
  (select total_amount from tracks.v_period_totals where kind = 'annual'),
  156281581.00::numeric,
  '16d. The GRAND TOTAL is the sum of every sector');

select tracks_test.eq(
  (select count(*)::int from tracks.v_sector_totals where kind = 'annual'),
  2,
  '16e. A sector with no submissions produces no total row');

-- ---------------------------------------------------------------------------
-- 17. Obligations and disbursements
-- ---------------------------------------------------------------------------

select tracks_test.login(:BUDGET::uuid);
insert into tracks.allotments (id, ppa_id, amount, allotment_date, reference_no)
values ('b0000000-0000-0000-0000-000000000001', :PPA_1::uuid, 60000000, '2027-01-05', 'ALL-2027-001');
insert into tracks.allotments (ppa_id, amount, allotment_date, reference_no)
values (:PPA_1::uuid, 20000000, '2027-07-05', 'ALL-2027-088');

insert into tracks.obligations (id, ppa_id, obr_no, obligation_date, payee, amount)
values ('c0000000-0000-0000-0000-000000000001', :PPA_1::uuid, 'OBR-2027-0001', '2027-02-01', 'Payroll', 30000000);
select tracks_test.logout();

select tracks_test.eq(
  (select allotted from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  80000000.00::numeric,
  '17a. Allotments accumulate across releases');

select tracks_test.login(:ACCTG::uuid);
insert into tracks.disbursements (ppa_id, obligation_id, dv_no, disbursement_date, amount)
values (:PPA_1::uuid, 'c0000000-0000-0000-0000-000000000001', 'DV-2027-0001', '2027-02-15', 12000000);

select tracks_test.throws(
  format('insert into tracks.disbursements (ppa_id, obligation_id, dv_no, disbursement_date, amount)
          values (%L, %L, ''DV-2027-0002'', ''2027-03-15'', 25000000)',
         '90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  '17b. Disbursements cannot exceed the obligation they are paid against');

select tracks_test.throws(
  format('insert into tracks.disbursements (ppa_id, obligation_id, dv_no, disbursement_date, amount)
          values (%L, %L, ''DV-2027-0003'', ''2027-03-15'', 100)',
         '90000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001'),
  '17c. An obligation cannot be paid out of a different PPA');

-- Accounting may record a payment with no OBR to hand.
insert into tracks.disbursements (ppa_id, dv_no, disbursement_date, amount)
values (:PPA_1::uuid, 'DV-2027-0004', '2027-04-01', 500000);
select tracks_test.logout();

select tracks_test.eq(
  (select disbursed from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  12500000.00::numeric,
  '17d. Disbursements with and without an OBR both count toward the total');

select tracks_test.eq(
  (select unobligated_balance from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  50000000.00::numeric,
  '17e. Unobligated balance is allotment minus obligations');

select tracks_test.eq(
  (select unpaid_obligations from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  17500000.00::numeric,
  '17f. Unpaid obligations is obligations minus disbursements');

select tracks_test.eq(
  (select obligation_rate from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  37.50::numeric,
  '17g. Utilization is measured against the ALLOTMENT, not the approved amount');

-- Cancelling an obligation removes it from every rollup.
select tracks_test.login(:BUDGET::uuid);
update tracks.obligations
   set status = 'cancelled', cancel_reason = 'Duplicate of OBR-2027-0002'
 where id = 'c0000000-0000-0000-0000-000000000001';
select tracks_test.logout();

select tracks_test.eq(
  (select obligated from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  0.00::numeric,
  '17h. A cancelled obligation drops out of the rollup');

select tracks_test.login(:BUDGET::uuid);
select tracks_test.throws(
  'update tracks.obligations set status = ''cancelled'', cancel_reason = null
    where id = ''c0000000-0000-0000-0000-000000000001''',
  '17i. Cancelling an obligation requires a reason');
update tracks.obligations set status = 'active', cancel_reason = null
 where id = 'c0000000-0000-0000-0000-000000000001';
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 18. Physical progress
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
insert into tracks.ppa_progress (ppa_id, as_of_date, percent_complete)
values (:PPA_1::uuid, '2027-03-31', 25), (:PPA_1::uuid, '2027-06-30', 60);
select tracks_test.throws(
  format('insert into tracks.ppa_progress (ppa_id, as_of_date, percent_complete)
          values (%L, ''2027-09-30'', 140)', '90000000-0000-0000-0000-000000000001'),
  '18a. Physical accomplishment over 100% is rejected');
select tracks_test.logout();

select tracks_test.eq(
  (select physical_percent from tracks.v_ppa_financials where ppa_id = :PPA_1::uuid),
  60.00::numeric,
  '18b. The monitoring view shows the LATEST accomplishment');

-- ---------------------------------------------------------------------------
-- 19. The column-C group tree
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = '80000000-0000-0000-0000-000000000004'),
  3,
  '19a. Group depth is derived, not supplied — the 3-level shape survives');

select tracks_test.eq(
  (select group_path_label from tracks.v_ppa_rows where id = '90000000-0000-0000-0000-000000000003'),
  'SUPPORT TO NATIONAL AGENCIES › Department of Interior and Local Government › General and Administrative Operation',
  '19b. The full column-C ancestry renders for a 3-level PPA');

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  'update tracks.ppa_groups set parent_id = ''80000000-0000-0000-0000-000000000004''
    where id = ''80000000-0000-0000-0000-000000000002''',
  '19c. A group cannot be re-parented under its own descendant');

select tracks_test.throws(
  format('insert into tracks.ppa_groups (aip_id, parent_id, name)
          values (%L, %L, ''Cross-AIP child'')',
         '70000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001'),
  '19d. A group cannot be nested under a group from another AIP');
select tracks_test.logout();

select tracks_test.eq(
  (select count(*)::int from tracks.v_ppa_rows where aip_id = :CMO_AIP::uuid and item_no = 3),
  1,
  '19e. Item numbers run 1..N in worksheet order, ungapped');

-- Deleting a row renumbers the rest with no write.
select tracks_test.login(:PLAN_STAFF::uuid);
insert into tracks.ppas (id, aip_id, department_id, group_id, description, amount_mooe, sort_order)
values ('90000000-0000-0000-0000-00000000000f', :CMO_AIP::uuid,
        'd0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
        'Inserted between rows', 1000, 0);
select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows where id = '90000000-0000-0000-0000-00000000000f'),
  1,
  '19f. A row inserted at the top takes item 1 and pushes the rest down');
delete from tracks.ppas where id = '90000000-0000-0000-0000-00000000000f';
select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows where id = :PPA_1::uuid),
  1,
  '19g. Deleting it renumbers back, with no stored column to fix');
select tracks_test.logout();

-- An ungrouped row must NOT jump to the top of a department that already has
-- column-C headings. Regression for 0008.
select tracks_test.login(:PLAN_STAFF::uuid);
insert into tracks.ppas (id, aip_id, department_id, group_id, description, amount_mooe, sort_order)
values ('90000000-0000-0000-0000-0000000000e1', :CMO_AIP::uuid,
        'd0000000-0000-0000-0000-000000000001', null, 'Ungrouped row added later', 1000, 99);
select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows where id = '90000000-0000-0000-0000-0000000000e1'),
  (select count(*)::int from tracks.v_ppa_rows where aip_id = :CMO_AIP::uuid),
  '19h. A row with no column-C heading appends to the end, not the top');
delete from tracks.ppas where id = '90000000-0000-0000-0000-0000000000e1';
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 20. A supplemental is a separate submission on the same period
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(
  format('insert into tracks.aips (period_id, department_id, kind)
          values (%L, %L, ''annual'')',
         '60000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '20a. A department cannot file a second ANNUAL AIP for the same year');

insert into tracks.aips (id, period_id, department_id, kind, supplemental_no)
values ('70000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001', 'supplemental', 1);
select tracks_test.eq(
  (select count(*)::int from tracks.aips where department_id = 'd0000000-0000-0000-0000-000000000001'),
  2,
  '20b. The same department CAN file a supplemental for that year');

select tracks_test.throws(
  format('insert into tracks.aips (period_id, department_id, kind, supplemental_no)
          values (%L, %L, ''supplemental'', 1)',
         '60000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '20c. Supplemental numbers are unique per department per year');

select tracks_test.throws(
  format('insert into tracks.aips (period_id, department_id, kind, supplemental_no)
          values (%L, %L, ''annual'', 2)',
         '60000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004'),
  '20d. An annual AIP cannot carry a supplemental number');

-- A supplemental PPA that supersedes an existing one keeps the link.
insert into tracks.ppas (aip_id, department_id, description, amount_co, continues_ppa_id)
values ('70000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
        'Additional funding for salaries', 5000000, :PPA_1::uuid);
select tracks_test.eq(
  (select count(*)::int from tracks.ppas where continues_ppa_id = :PPA_1::uuid),
  1,
  '20e. A supplemental PPA can point back at the row it continues');

select tracks_test.eq(
  (select total_amount from tracks.v_period_totals where kind = 'annual'),
  156281581.00::numeric,
  '20f. The supplemental does NOT leak into the annual grand total');
select tracks_test.logout();

-- A supplemental only ADDS rows. It never rewrites the annual AIP's figures, so
-- the annual submission's total is unchanged by anything a supplemental does.
select tracks_test.eq(
  (select total_amount from tracks.v_aip_totals
    where aip_id = :CMO_AIP::uuid and kind = 'annual'),
  95722053.00::numeric,
  '20g. A supplemental leaves the annual submission''s own total alone');

select tracks_test.eq(
  (select count(*)::int from tracks.ppas
    where aip_id = '70000000-0000-0000-0000-00000000000a'),
  1,
  '20h. A supplemental''s rows belong to the supplemental, not to the annual AIP');

-- ---------------------------------------------------------------------------
-- 21. Roles are structurally coherent
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(
  format('insert into tracks.user_roles (profile_id, role, department_id)
          values (%L, ''budget'', %L)',
         'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'),
  '21a. A city-wide role cannot be tied to a department');

select tracks_test.throws(
  'insert into tracks.invites (email, full_name, role) values (''x@y.com'', ''X'', ''dept_head'')',
  '21b. A department role cannot be invited without a department');

select tracks_test.throws(
  format('insert into tracks.user_roles (profile_id, role, department_id)
          values (%L, ''dept_head'', %L)',
         'a0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003'),
  '21c. A user belongs to exactly one department');
select tracks_test.logout();
