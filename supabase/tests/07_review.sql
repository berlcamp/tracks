-- 07_review.sql — per-row review, at two stages.
--
-- The department head reads their own office's rows before submitting; the City
-- Planning Sector Officer reads them after. Both may pass a row or send it back,
-- and both may say why. Nobody signs a programme with a correction outstanding
-- in it.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CHO_HEAD   '''55555555-5555-5555-5555-555555555555'''
\set BUDGET     '''66666666-6666-6666-6666-666666666666'''

\set PERIOD     '''60000000-0000-0000-0000-000000000001'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''
\set CHO_AIP    '''70000000-0000-0000-0000-000000000002'''
\set H_ADMIN    '''80000000-0000-0000-0000-000000000001'''
\set PPA_1      '''90000000-0000-0000-0000-000000000001'''
\set PPA_2      '''90000000-0000-0000-0000-000000000002'''
\set CHO_PPA    '''90000000-0000-0000-0000-000000000004'''

-- The suites before this one submit and accept the fixture in the course of
-- testing other rules, so this one sets its own stage: two draft submissions
-- with nothing yet read. Run as the owner, outside any role, which is the only
-- context in which a review can be removed at all.
delete from tracks.ppa_reviews;
delete from tracks.ppa_returns;
update tracks.aip_periods set status = 'open';
update tracks.aips
   set status = 'draft', submitted_at = null, submitted_by = null,
       accepted_at = null, accepted_by = null
 where id in ('70000000-0000-0000-0000-000000000001',
              '70000000-0000-0000-0000-000000000002');
delete from tracks.aips
 where period_id = '60000000-0000-0000-0000-000000000001'
   and id not in ('70000000-0000-0000-0000-000000000001',
                  '70000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- 27. The department stage
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select review_status from tracks.v_ppa_rows where id = :PPA_1::uuid), 'pending',
  '27a. A row nobody has read is pending, not silently fine');

select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''approved'')', :PPA_1),
  '27b. An encoder cannot approve their own work');
select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''approved'')', :PPA_1),
  '27c. A head cannot approve another office''s rows');
select tracks_test.logout();

select tracks_test.login(:CMO_HEAD::uuid);
select tracks.review_ppa(:PPA_1::uuid, 'approved', 'Consistent with the PPMP.');
select tracks_test.eq(
  (select review_status from tracks.v_ppa_rows where id = :PPA_1::uuid), 'approved',
  '27d. The head approves a row');
select tracks_test.eq(
  (select review_remarks from tracks.v_ppa_rows where id = :PPA_1::uuid),
  'Consistent with the PPMP.',
  '27e. Remarks are kept on an approval, not only on a return');

select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''returned'')', :PPA_2),
  '27f. A row cannot be sent back with no reason');

select tracks.review_ppa(:PPA_2::uuid, 'returned', 'Split the travelling cost by office.');
select tracks_test.eq(
  (select review_status from tracks.v_ppa_rows where id = :PPA_2::uuid), 'returned',
  '27g. The head sends a row back for revision');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 28. An approved row is frozen
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_ps = 1 where id = :PPA_1::uuid;
select tracks_test.eq(
  (select amount_ps from tracks.ppas where id = :PPA_1::uuid), 86222053.00::numeric,
  '28a. An encoder cannot change a row the head has approved');

update tracks.ppas set amount_mooe = 6000000 where id = :PPA_2::uuid;
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where id = :PPA_2::uuid), 6000000.00::numeric,
  '28b. A row sent back for revision is open for correction');

delete from tracks.ppas where id = :PPA_1::uuid;
select tracks_test.eq(
  (select count(*)::int from tracks.ppas where id = :PPA_1::uuid), 1,
  '28c. Nor can an approved row be deleted out from under the approval');
select tracks_test.logout();

-- Withdrawing the approval reopens it, and the first decision still stands in
-- the log.
select tracks_test.login(:CMO_HEAD::uuid);
select tracks.review_ppa(:PPA_1::uuid, 'returned', 'Recheck the step increment.');
select tracks_test.logout();

select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_ps = 86000000 where id = :PPA_1::uuid;
select tracks_test.eq(
  (select amount_ps from tracks.ppas where id = :PPA_1::uuid), 86000000.00::numeric,
  '28d. Withdrawing the approval reopens the row');
select tracks_test.logout();

select tracks_test.eq(
  (select count(*)::int from tracks.ppa_reviews where ppa_id = :PPA_1::uuid), 2,
  '28e. Both decisions are on the record — a review is never edited');

select tracks_test.login(:PLAN_ADMIN::uuid);
delete from tracks.ppa_reviews;
select tracks_test.logout();
select tracks_test.ok(
  (select count(*) from tracks.ppa_reviews) > 0,
  '28f. Not even a planning admin can delete a review');

-- ---------------------------------------------------------------------------
-- 29. Submission needs every row read
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(format('select tracks.submit_aip(%L)', :CMO_AIP),
  '29a. An AIP with a row still out for revision cannot be submitted');

select tracks.review_ppa(:PPA_1::uuid, 'approved');
select tracks.review_ppa(:PPA_2::uuid, 'approved');
select tracks.review_ppa('90000000-0000-0000-0000-000000000003', 'approved');
select tracks.submit_aip(:CMO_AIP::uuid);
select tracks_test.eq(
  (select status from tracks.aips where id = :CMO_AIP::uuid), 'submitted',
  '29b. With every row approved, the head submits');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 30. The planning stage
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select review_status from tracks.v_ppa_rows where id = :PPA_1::uuid), 'pending',
  '30a. Submission opens a fresh reading — the head''s approval is not Planning''s');

select tracks_test.login(:CMO_HEAD::uuid);
select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''approved'')', :PPA_1),
  '30b. The head cannot review their own AIP once it is with City Planning');
select tracks_test.logout();

select tracks_test.login(:BUDGET::uuid);
select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''approved'')', :PPA_1),
  '30c. Budget does not review the programme');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks.review_ppa(:PPA_1::uuid, 'approved', 'Tallies with the ceiling.');
select tracks_test.eq(
  (select planning_status from tracks.v_ppa_rows where id = :PPA_1::uuid), 'approved',
  '30d. The Sector Officer approves a row');
select tracks_test.eq(
  (select dept_status from tracks.v_ppa_rows where id = :PPA_1::uuid), 'approved',
  '30e. And the department''s own decision is still readable beside it');

select tracks.review_ppa(:PPA_2::uuid, 'returned', 'Attach the breakdown.');
select tracks_test.eq(
  (select status from tracks.aips where id = :CMO_AIP::uuid), 'returned',
  '30f. Returning a row sends the AIP back to the office');
select tracks_test.eq(
  (select count(*)::int from tracks.ppa_returns
    where ppa_id = :PPA_2::uuid and resolved_at is null), 1,
  '30g. And opens the return the department has to answer');
select tracks_test.logout();

-- Only the returned row reopens. The rule the whole workflow turns on.
select tracks_test.login(:CMO_ENC::uuid);
update tracks.ppas set amount_mooe = 5500000 where id = :PPA_2::uuid;
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where id = :PPA_2::uuid), 5500000.00::numeric,
  '30h. The returned row is open for correction');
update tracks.ppas set amount_ps = 1 where id = :PPA_1::uuid;
select tracks_test.eq(
  (select amount_ps from tracks.ppas where id = :PPA_1::uuid), 86000000.00::numeric,
  '30i. The rows beside it stay shut');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 31. Finalising the programme
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(format('select tracks.finalize_aip_period(%L)', :PERIOD),
  '31a. A Sector Officer cannot finalise — that is the administrator''s signature');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(format('select tracks.finalize_aip_period(%L)', :PERIOD),
  '31b. Not while a department AIP is still out for revision');
select tracks_test.logout();

-- Bring the CMO submission back in.
select tracks_test.login(:CMO_HEAD::uuid);
select tracks.resolve_return(:PPA_2::uuid, 'Breakdown attached.');
select tracks.submit_aip(:CMO_AIP::uuid);
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(format('select tracks.finalize_aip_period(%L)', :PERIOD),
  '31c. Nor while a row has not been checked by City Planning');
select tracks_test.logout();

-- Read every remaining row.
select tracks_test.login(:PLAN_STAFF::uuid);
do $$
declare r record;
begin
  for r in
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
    where a.period_id = '60000000-0000-0000-0000-000000000001'
      and a.status = 'submitted'
      and p.row_kind = 'ppa' and rs.planning_status <> 'approved'
  loop
    perform tracks.review_ppa(r.id, 'approved', 'Checked.');
  end loop;
end $$;
select tracks_test.logout();

-- The CHO submission has never been sent in.
select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(format('select tracks.finalize_aip_period(%L)', :PERIOD),
  '31d. Nor while a department has not submitted at all');
select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
select tracks.review_ppa(:CHO_PPA::uuid, 'approved', 'Checked.');
select tracks.submit_aip(:CHO_AIP::uuid);
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks.review_ppa(:CHO_PPA::uuid, 'approved', 'Checked.');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks.finalize_aip_period(:PERIOD::uuid);
select tracks_test.eq(
  (select status from tracks.aip_periods where id = :PERIOD::uuid), 'for_ldc',
  '31e. With every row read, the administrator finalises the whole programme');
select tracks_test.eq(
  (select count(*)::int from tracks.aips
    where period_id = :PERIOD::uuid and status <> 'accepted'), 0,
  '31f. Every department AIP is accepted in the one action');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 32. Finalised means finalised
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
update tracks.ppas set amount_mooe = 42 where id = :PPA_2::uuid;
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where id = :PPA_2::uuid), 5500000.00::numeric,
  '32a. City Planning cannot edit a programme that has gone to the LDC');
select tracks_test.throws(
  format('select tracks.review_ppa(%L, ''returned'', ''Too late'')', :PPA_2),
  '32b. Nor review it further');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(format('select tracks.finalize_aip_period(%L)', :PERIOD),
  '32c. Nor finalise it twice');
-- Leave the fixture where the other suites expect it.
update tracks.aip_periods set status = 'open' where id = :PERIOD::uuid;
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 33. An encoder owns what they wrote
-- ---------------------------------------------------------------------------
--
-- A department can have several encoders. Each may correct their own lines and
-- nobody else's; the head answers for the whole submission and may correct any.

\set CMO_ENC2 '''88888888-8888-8888-8888-888888888888'''

-- A second encoder for the same office.
insert into auth.users (id, email, raw_user_meta_data)
values ('88888888-8888-8888-8888-888888888888', 'cmoenc2@bayugan.gov.ph',
        '{"full_name":"Second Encoder"}')
on conflict (id) do nothing;
insert into tracks.profiles (id, auth_user_id, email, full_name, global_role)
values ('a0000000-0000-0000-0000-000000000008',
        :CMO_ENC2::uuid, 'cmo.encoder2@tracks.local', 'Second Encoder', 'user')
on conflict (id) do nothing;
insert into tracks.user_roles (profile_id, role, department_id)
values ('a0000000-0000-0000-0000-000000000008', 'dept_encoder',
        'd0000000-0000-0000-0000-000000000001')
on conflict (profile_id) do nothing;

-- Back to a draft so the office can work on it.
delete from tracks.ppa_reviews;
update tracks.aip_periods set status = 'open';
update tracks.aips set status = 'draft' where id = '70000000-0000-0000-0000-000000000001';

-- Each encoder writes a row of their own.
select tracks_test.login(:CMO_ENC::uuid);
select tracks.insert_ppa_row(:CMO_AIP::uuid, 90, 'ppa', 'First encoder''s row',
                             null, null, null, null, null, 'GF', 0, 1000, 0, 0);
select tracks_test.logout();

select tracks_test.login(:CMO_ENC2::uuid);
select tracks.insert_ppa_row(:CMO_AIP::uuid, 91, 'ppa', 'Second encoder''s row',
                             null, null, null, null, null, 'GF', 0, 2000, 0, 0);

select tracks_test.eq(
  (select author_name from tracks.v_ppa_rows
    where description = 'Second encoder''s row'), 'Second Encoder',
  '33a. The row records who wrote it');

update tracks.ppas set amount_mooe = 2500 where description = 'Second encoder''s row';
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where description = 'Second encoder''s row'),
  2500.00::numeric,
  '33b. An encoder can correct their own row');

update tracks.ppas set amount_mooe = 9999 where description = 'First encoder''s row';
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where description = 'First encoder''s row'),
  1000.00::numeric,
  '33c. But not another encoder''s, even in the same office');

delete from tracks.ppas where description = 'First encoder''s row';
select tracks_test.eq(
  (select count(*)::int from tracks.ppas where description = 'First encoder''s row'), 1,
  '33d. Nor delete it');
select tracks_test.logout();

-- The head answers for the office, so nothing in it is closed to them.
select tracks_test.login(:CMO_HEAD::uuid);
update tracks.ppas set amount_mooe = 1500 where description = 'First encoder''s row';
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where description = 'First encoder''s row'),
  1500.00::numeric,
  '33e. The department head can correct any row in their own office');
select tracks_test.logout();

-- Rows that predate this rule have no author, so no encoder is shut out of the
-- programme the office was already working on.
select tracks_test.login(:CMO_ENC2::uuid);
update tracks.ppas set amount_ps = 86111111 where id = :PPA_1::uuid;
select tracks_test.eq(
  (select amount_ps from tracks.ppas where id = :PPA_1::uuid), 86111111.00::numeric,
  '33f. A row with no author on record is open to any encoder of its office');
select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
update tracks.ppas set amount_mooe = 1 where description = 'First encoder''s row';
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where description = 'First encoder''s row'),
  1500.00::numeric,
  '33g. And another office reaches none of it');
select tracks_test.logout();

delete from tracks.ppas where description in
  ('First encoder''s row', 'Second encoder''s row');
