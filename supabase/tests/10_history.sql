-- 10_history.sql — the audit trail on a PPA row.
--
-- Two rules are asserted here, and they hold each other up:
--
--   * City Planning may edit any office's row, at any AIP status, while the
--     programme is still in the building. That is what lets the consolidated
--     view be corrected where it is read.
--
--   * Nothing it does there is off the record. `ppa_revisions` is written by
--     TRIGGER, not by the application, so a change made through a route nobody
--     remembered to instrument is in the trail too — and the trail is
--     append-only for everybody, planning administrator included.
--
-- The second is the reason the first is safe, so a change that weakened either
-- should fail here.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CHO_HEAD   '''55555555-5555-5555-5555-555555555555'''
\set NOBODY     '''99999999-9999-9999-9999-999999999999'''

\set P_ENC      '''a0000000-0000-0000-0000-000000000004'''
\set P_STAFF    '''a0000000-0000-0000-0000-000000000002'''
\set P_ADMIN    '''a0000000-0000-0000-0000-000000000001'''

\set PERIOD     '''60000000-0000-0000-0000-000000000001'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''
\set CHO_AIP    '''70000000-0000-0000-0000-000000000002'''
\set CHO_PPA    '''90000000-0000-0000-0000-000000000004'''

-- Its own stage, like 07: the suites before this one submit and accept the
-- fixture in the course of testing other rules.
delete from tracks.ppa_reviews;
delete from tracks.ppa_returns;
update tracks.aip_periods set status = 'open';
update tracks.aips
   set status = 'draft', submitted_at = null, submitted_by = null,
       accepted_at = null, accepted_by = null
 where id in ('70000000-0000-0000-0000-000000000001',
              '70000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- 68. The trail is written by the database, not by the application
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);
select tracks.insert_ppa_row(
  :CMO_AIP::uuid, 99, 'ppa', 'Purchase of one ambulance',
  '1000-000-2-1-01-001-002-001', 'City Mayor''s Office',
  '2027-01-01', '2027-12-31', 'One ambulance procured', 'GF',
  0, 250000, 0, 3000000) as new_row \gset

select id as trail_ppa from tracks.ppas
 where aip_id = :CMO_AIP::uuid and description = 'Purchase of one ambulance' \gset

select tracks_test.eq(
  (select action from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid),
  'create',
  '68a. Adding a row writes a create entry nobody had to remember to write');

select tracks_test.eq(
  (select changed_by from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid),
  :P_ENC::uuid,
  '68b. The entry names who wrote the row');

-- The capacity, not just the person. "The City Planning Sector Officer changed
-- it" is the fact the office reads this back for; the role is stamped at the
-- moment of the write rather than joined from user_roles later, because a role
-- can be reassigned and a trail that re-read it would rewrite its own history.
select tracks_test.eq(
  (select changed_role from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid),
  'dept_encoder',
  '68c. And the capacity it was written in');

update tracks.ppas set amount_mooe = 400000 where id = :'trail_ppa'::uuid;

select tracks_test.eq(
  (select (old_values->>'amount_mooe')::numeric from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'),
  250000.00::numeric,
  '68d. An update keeps the ORIGINAL value, so an overwrite is recoverable');

select tracks_test.eq(
  (select changed_fields from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'),
  array['amount_mooe'],
  '68e. And names only the column that actually moved');

-- amount_total is generated from the four expense classes. Reporting it as a
-- changed column would double-report every amount change.
select tracks_test.ok(
  (select array_position(changed_fields, 'amount_total') is null
     from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'),
  '68f. The generated total is not reported as a change of its own');

update tracks.ppas set amount_mooe = 400000 where id = :'trail_ppa'::uuid;
select tracks_test.eq(
  (select count(*) from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'),
  1::bigint,
  '68g. A no-op update writes no history');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 69. City Planning edits another office's row, and it shows
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks.review_ppa(:'trail_ppa'::uuid, 'approved', 'Checked against the PPMP.');
select tracks_test.logout();

-- Approved and submitted: frozen to the office that wrote it, open to City
-- Planning. This is exactly the row the consolidated view offers for editing.
select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:'trail_ppa'::uuid), false,
  '69a. An approved row is frozen to the encoder who wrote it');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:'trail_ppa'::uuid), true,
  '69b. The City Planning Sector Officer may still correct it');

update tracks.ppas set amount_mooe = 800000 where id = :'trail_ppa'::uuid;
select tracks_test.eq(
  (select amount_mooe from tracks.ppas where id = :'trail_ppa'::uuid),
  800000.00::numeric,
  '69c. And the correction lands');

select tracks_test.eq(
  (select changed_role from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'
    order by id desc limit 1),
  'planning_staff',
  '69d. Recorded as the City Planning Sector Officer''s change, not the office''s');

select tracks_test.eq(
  (select (old_values->>'amount_mooe')::numeric from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'
    order by id desc limit 1),
  400000.00::numeric,
  '69e. With the department''s own figure preserved beside it');
select tracks_test.logout();

-- The office whose figure was overwritten can read that it was. An audit trail
-- only the overwriter can see is not one.
select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.eq(
  (select changed_by_name from tracks.v_ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and changed_role = 'planning_staff'
    order by id desc limit 1),
  'Planning Staff',
  '69f. The department reads who overwrote its figure, by name');
select tracks_test.logout();

select tracks_test.login(:NOBODY::uuid);
select tracks_test.eq(
  (select count(*) from tracks.v_ppa_revisions), 0::bigint,
  '69g. An uninvited account reads no trail at all');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 70. An accepted document is still City Planning's to correct
-- ---------------------------------------------------------------------------
--
-- This is the consolidated view's whole case: the programme is being
-- consolidated, every office has been accepted, and a line still has to be
-- corrected. The administrator may, and it is on the record.

update tracks.aips set status = 'accepted' where id = :CHO_AIP::uuid;
update tracks.aip_periods set status = 'consolidating' where id = :PERIOD::uuid;

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:CHO_PPA::uuid), true,
  '70a. The City Planning Administrator may edit an accepted document''s row');
update tracks.ppas set amount_co = 17000000 where id = :CHO_PPA::uuid;
select tracks_test.eq(
  (select changed_role from tracks.ppa_revisions
    where ppa_id = :CHO_PPA::uuid order by id desc limit 1),
  'planning_admin',
  '70b. Recorded as the administrator''s change');
select tracks_test.logout();

select tracks_test.login(:CHO_HEAD::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:CHO_PPA::uuid), false,
  '70c. The office that filed it cannot, which is what "accepted" means');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 71. The trail cannot be rewritten, by anybody
-- ---------------------------------------------------------------------------
--
-- `ppa_revisions` has no UPDATE policy and no DELETE policy. Postgres does not
-- raise for those — with no policy the rows are simply filtered away — so the
-- assertion is that the entry did not move, the same shape as 61c.

select tracks_test.login(:PLAN_ADMIN::uuid);
update tracks.ppa_revisions set new_values = '{"amount_mooe": 1}'::jsonb
 where ppa_id = :'trail_ppa'::uuid;
select tracks_test.eq(
  (select (new_values->>'amount_mooe')::numeric from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'update'
    order by id desc limit 1),
  800000.00::numeric,
  '71a. The planning administrator cannot rewrite an entry');

delete from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid;
select tracks_test.ok(
  (select count(*) from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid) > 0,
  '71b. Nor delete one');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 72. A deleted row keeps its history
-- ---------------------------------------------------------------------------
--
-- `ppa_revisions.ppa_id` is deliberately NOT a foreign key: the point of the
-- trail is the row that is no longer there.

select tracks_test.login(:PLAN_ADMIN::uuid);
delete from tracks.ppas where id = :'trail_ppa'::uuid;
select tracks_test.eq(
  (select count(*) from tracks.ppas where id = :'trail_ppa'::uuid), 0::bigint,
  '72a. City Planning removes the row');
select tracks_test.eq(
  (select (old_values->>'description') from tracks.ppa_revisions
    where ppa_id = :'trail_ppa'::uuid and action = 'delete'),
  'Purchase of one ambulance',
  '72b. And the deletion is recorded with the row it removed');
select tracks_test.ok(
  (select count(*) from tracks.ppa_revisions where ppa_id = :'trail_ppa'::uuid) >= 4,
  '72c. The whole trail outlives the row');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 73. Once the programme leaves the building, nobody edits — City Planning too
-- ---------------------------------------------------------------------------

update tracks.aip_periods set status = 'for_ldc' where id = :PERIOD::uuid;

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:CHO_PPA::uuid), false,
  '73a. The administrator cannot edit a row once the LDC has the programme');
update tracks.ppas set amount_co = 1 where id = :CHO_PPA::uuid;
select tracks_test.eq(
  (select amount_co from tracks.ppas where id = :CHO_PPA::uuid),
  17000000.00::numeric,
  '73b. And the attempt changes nothing');
select tracks_test.logout();

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  tracks.can_edit_ppa(:CHO_PPA::uuid), false,
  '73c. Nor can the sector officer');
select tracks_test.logout();

update tracks.aip_periods set status = 'open' where id = :PERIOD::uuid;
