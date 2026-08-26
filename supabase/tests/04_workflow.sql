-- 04_workflow.sql — the submission lock.
--
-- This is the rule the whole department workflow turns on and the one most
-- likely to be broken by a later change:
--
--   Returning 3 items out of 200 must NOT reopen the other 197.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CHO_HEAD   '''55555555-5555-5555-5555-555555555555'''

\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''
\set PPA_1      '''90000000-0000-0000-0000-000000000001'''
\set PPA_2      '''90000000-0000-0000-0000-000000000002'''


-- The head signs for every line now, so every submit in this suite is preceded
-- by approving the rows. Kept as one statement so the tests below read as
-- workflow rather than as bookkeeping.
create or replace function tracks_test.approve_all(p_aip_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in select id from tracks.ppas
            where aip_id = p_aip_id and row_kind = 'ppa' loop
    perform tracks.review_ppa(r.id, 'approved', 'Checked.');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Draft: the department owns it
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_mooe = 7500000 where id = :PPA_2::uuid;
select tracks_test.eq((select amount_mooe from tracks.ppas where id = :PPA_2::uuid),
  7500000.00::numeric, '7a. An encoder can edit a PPA while the AIP is a draft');

select tracks_test.throws(format('select tracks.submit_aip(%L)', :CMO_AIP),
  '7b. An encoder cannot submit — only the department head');
select tracks_test.logout();

-- An empty submission is not a submission.
select tracks_test.login(:PLAN_ADMIN::uuid);
insert into tracks.aips (id, period_id, department_id, kind, supplemental_no, status)
values ('70000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000003', 'supplemental', 1, 'draft');
select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
select tracks_test.throws(
  'select tracks.submit_aip(''70000000-0000-0000-0000-000000000009'')',
  '7c. An AIP with no PPAs cannot be submitted');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 8. Submitted: the whole thing locks
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(format('select tracks.submit_aip(%L)', :CMO_AIP),
  '8a-i. An AIP with rows the head has not read cannot be submitted');
select tracks_test.approve_all(:CMO_AIP::uuid);
select tracks.submit_aip(:CMO_AIP::uuid);
select tracks_test.eq((select status from tracks.aips where id = :CMO_AIP::uuid),
  'submitted', '8a. The department head can submit once every row is approved');
select tracks_test.logout();

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_mooe = 111 where id = :PPA_2::uuid;
select tracks_test.logout();
select tracks_test.eq((select amount_mooe from tracks.ppas where id = :PPA_2::uuid),
  7500000.00::numeric, '8b. A submitted AIP is locked to the department');

select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, description, amount_mooe)
          values (%L, %L, ''Late addition'', 5000)',
         '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '8c. No rows can be added to a submitted AIP');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 9. Returning ONE item
-- ---------------------------------------------------------------------------

select tracks_test.login(:CHO_HEAD::uuid);
select tracks_test.throws(format('select tracks.return_ppa(%L, ''wrong office'')', :PPA_1),
  '9a. Another department cannot return an item');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(format('select tracks.return_ppa(%L, '''')', :PPA_1),
  '9b. Returning an item requires a reason');
select tracks.return_ppa(:PPA_1::uuid, 'Salaries exceed the HR plantilla figure. Please reconcile.');
select tracks_test.logout();

select tracks_test.eq((select status from tracks.aips where id = :CMO_AIP::uuid),
  'returned', '9c. Returning an item moves the AIP to `returned`');
select tracks_test.eq((select count(*) from tracks.v_ppa_rows
                        where aip_id = :CMO_AIP::uuid and is_returned)::int, 1,
  '9d. Exactly one item is flagged as returned');

-- ---------------------------------------------------------------------------
-- 10. THE RULE: only the returned item reopens
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_ps = 80000000 where id = :PPA_1::uuid;
update tracks.ppas set amount_mooe = 222 where id = :PPA_2::uuid;
select tracks_test.logout();

select tracks_test.eq((select amount_ps from tracks.ppas where id = :PPA_1::uuid),
  80000000.00::numeric, '10a. The RETURNED item is editable again');
select tracks_test.eq((select amount_mooe from tracks.ppas where id = :PPA_2::uuid),
  7500000.00::numeric, '10b. Every other item stays locked — 3 returned of 200 does not reopen 197');

select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, description, amount_mooe)
          values (%L, %L, ''New row during correction'', 5000)',
         '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  '10c. A correction cannot smuggle in a new row');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 11. Resubmission
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(format('select tracks.submit_aip(%L)', :CMO_AIP),
  '11a. Cannot resubmit while an item is still open');
select tracks.resolve_return(:PPA_1::uuid, 'Reconciled against the HR plantilla.');
select tracks.submit_aip(:CMO_AIP::uuid);
select tracks_test.eq((select status from tracks.aips where id = :CMO_AIP::uuid),
  'submitted', '11b. Resolving the return allows resubmission');
select tracks_test.eq((select count(*) from tracks.ppa_returns
                        where ppa_id = :PPA_1::uuid and resolved_at is not null)::int, 1,
  '11c. The return is kept as history, not deleted');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 12. Acceptance, and City Planning's override
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks.accept_aip(:CMO_AIP::uuid);
select tracks_test.eq((select status from tracks.aips where id = :CMO_AIP::uuid),
  'accepted', '12a. City Planning accepts the submission');

-- Planning overwrites a department figure during consolidation.
update tracks.ppas set amount_mooe = 6000000 where id = :PPA_2::uuid;
select tracks_test.eq((select amount_mooe from tracks.ppas where id = :PPA_2::uuid),
  6000000.00::numeric, '12b. City Planning can overwrite an accepted figure');
select tracks_test.logout();

select tracks_test.eq(
  (select (old_values ->> 'amount_mooe')::numeric
     from tracks.ppa_revisions
    where ppa_id = :PPA_2::uuid and 'amount_mooe' = any (changed_fields)
    order by changed_at desc limit 1),
  7500000.00::numeric,
  '12c. The ORIGINAL value survives the overwrite in the revision history');

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_mooe = 333 where id = :PPA_2::uuid;
select tracks_test.logout();
select tracks_test.eq((select amount_mooe from tracks.ppas where id = :PPA_2::uuid),
  6000000.00::numeric, '12d. An accepted AIP stays locked to the department');

-- ---------------------------------------------------------------------------
-- 13. Reopening is the audited escape hatch
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(format('select tracks.reopen_aip(%L, '''')', :CMO_AIP),
  '13a. Reopening a submission requires a reason');
select tracks.reopen_aip(:CMO_AIP::uuid, 'Department uploaded the wrong figures.');
select tracks_test.eq((select status from tracks.aips where id = :CMO_AIP::uuid),
  'draft', '13b. City Planning can reopen a submission');
select tracks_test.logout();

select tracks_test.eq(
  (select count(*) from tracks.audit_logs where action = 'AIP_REOPENED')::int, 1,
  '13c. The reopen is recorded in the audit log');

-- ---------------------------------------------------------------------------
-- 14. Period status is the planning admin's alone
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  'select tracks.set_period_status(''60000000-0000-0000-0000-000000000001'', ''for_ldc'')',
  '14a. Planning staff cannot move the period along the paper trail');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.set_period_status('60000000-0000-0000-0000-000000000001'::uuid, 'for_ldc');
select tracks_test.eq(
  (select status from tracks.aip_periods where year = 2027), 'for_ldc',
  '14b. The planning admin moves the period to for_ldc');

insert into tracks.aip_actions (period_id, stage, action, action_date, reference_no, remarks)
values ('60000000-0000-0000-0000-000000000001', 'council', 'approved', '2026-11-20',
        'Resolution No. 2026-115', 'Approved as submitted.');
select tracks_test.eq(
  (select reference_no from tracks.aip_actions where stage = 'council'),
  'Resolution No. 2026-115',
  '14c. City Planning encodes the returned resolution');
select tracks.set_period_status('60000000-0000-0000-0000-000000000001'::uuid, 'open');
select tracks_test.logout();

-- Leave the fixture as we found it for the money suite.
select tracks_test.login(:PLAN_STAFF::uuid);
update tracks.ppas set amount_mooe = 7000000 where id = :PPA_2::uuid;
update tracks.ppas set amount_ps = 86222053 where id = :PPA_1::uuid;
select tracks_test.logout();
delete from tracks.aips where id = '70000000-0000-0000-0000-000000000009';
