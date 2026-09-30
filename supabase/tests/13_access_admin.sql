-- 13_access_admin.sql — Settings → Access, and emptying the programme.
--
-- Runs LAST, and after 12_departments (for tracks_test.affected): section 94 deletes every department document in the database.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set SUPER      '''99999999-0000-0000-0000-000000000009'''

-- ---------------------------------------------------------------------------
-- 91. An invitation for somebody already in is superseded
-- ---------------------------------------------------------------------------

insert into tracks.invites (email, full_name, role, department_id)
select 'cmoenc@bayugan.gov.ph', 'CMO Encoder', 'dept_head', department_id
from tracks.user_roles where profile_id = 'a0000000-0000-0000-0000-000000000004' limit 1;

select tracks_test.login(:CMO_ENC::uuid);
select tracks.claim_invite();
select tracks_test.logout();

select tracks_test.eq(
  (select status from tracks.invites where email = 'cmoenc@bayugan.gov.ph'
   order by created_at desc limit 1),
  'superseded',
  '91a. A bound person signing in supersedes an invitation that could never be claimed');
select tracks_test.eq(
  (select role from tracks.user_roles
    where profile_id = 'a0000000-0000-0000-0000-000000000004' limit 1),
  'dept_encoder',
  '91b. ... and it grants nothing');

-- ---------------------------------------------------------------------------
-- 92. The planning administrator edits a role and deletes an invitation
-- ---------------------------------------------------------------------------

insert into tracks.invites (id, email, full_name, role)
values ('ee000000-0000-0000-0000-000000000001', 'someone@bayugan.gov.ph', 'Someone', 'viewer');

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.eq(
  tracks_test.affected(
    $$delete from tracks.invites where id = 'ee000000-0000-0000-0000-000000000001'$$),
  0, '92a. A sector officer cannot delete an invitation');
select tracks_test.logout();

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.eq(
  tracks_test.affected(
    $$delete from tracks.invites where id = 'ee000000-0000-0000-0000-000000000001'$$),
  1, '92b. The planning administrator can');

update tracks.user_roles set role = 'dept_head'
 where profile_id = 'a0000000-0000-0000-0000-000000000004';
select tracks_test.eq(
  (select role from tracks.user_roles
    where profile_id = 'a0000000-0000-0000-0000-000000000004' limit 1),
  'dept_head', '92c. ... and change somebody''s role');
update tracks.user_roles set role = 'dept_encoder'
 where profile_id = 'a0000000-0000-0000-0000-000000000004';
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 93-94. delete_programme_data()
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  (:SUPER, 'super@bayugan.gov.ph', '{"full_name":"Super Admin"}');
insert into tracks.profiles (auth_user_id, email, full_name, global_role) values
  (:SUPER, 'super@bayugan.gov.ph', 'Super Admin', 'super_admin');

create temporary table wipe_baseline as
select
  (select count(*) from tracks.sectors)                   as sectors,
  (select count(*) from tracks.departments)               as departments,
  (select count(*) from tracks.statutory_funds)           as funds,
  (select count(*) from tracks.statutory_fund_departments) as fund_departments,
  (select count(*) from tracks.aip_periods)               as periods,
  (select count(*) from tracks.profiles)                  as profiles,
  (select count(*) from tracks.user_roles)                as roles,
  (select count(*) from tracks.invites)                   as invites,
  (select count(*) from tracks.ppa_revisions)             as revisions,
  (select count(*) from tracks.aips)                      as aips;
grant select on wipe_baseline to authenticated;

select tracks_test.ok((select aips from wipe_baseline) > 0,
  '93a. There is a programme to delete');

select tracks_test.login(:PLAN_ADMIN::uuid);
select tracks_test.throws(
  $$select tracks.delete_programme_data('DELETE')$$,
  '93b. The planning administrator cannot delete the programme data');
select tracks_test.logout();

select tracks_test.login(:SUPER::uuid);
select tracks_test.throws(
  $$select tracks.delete_programme_data('delete')$$,
  '93c. Not without the word DELETE, exactly');
select tracks_test.throws(
  $$select tracks.delete_programme_data(null)$$,
  '93d. Nor with nothing');
select tracks.delete_programme_data('DELETE');
select tracks_test.logout();

select tracks_test.eq((select count(*) from tracks.aips), 0::bigint,
  '94a. Every department document is gone');
select tracks_test.eq((select count(*) from tracks.ppas), 0::bigint,
  '94b. ... and every row');
select tracks_test.eq(
  (select count(*) from tracks.allotments) + (select count(*) from tracks.obligations)
  + (select count(*) from tracks.disbursements) + (select count(*) from tracks.aip_actions)
  + (select count(*) from tracks.statutory_fund_periods),
  0::bigint, '94c. ... and every peso recorded against them, and every council leg');
select tracks_test.eq((select count(*) from tracks.aip_periods where status <> 'open'), 0::bigint,
  '94d. Every period is open again');
select tracks_test.ok(
  (select sectors from wipe_baseline)          = (select count(*) from tracks.sectors)
  and (select departments from wipe_baseline)  = (select count(*) from tracks.departments)
  and (select funds from wipe_baseline)        = (select count(*) from tracks.statutory_funds)
  and (select fund_departments from wipe_baseline)
        = (select count(*) from tracks.statutory_fund_departments)
  and (select periods from wipe_baseline)      = (select count(*) from tracks.aip_periods),
  '94e. Sectors, departments, statutory funds and periods are untouched');
select tracks_test.ok(
  (select profiles from wipe_baseline) = (select count(*) from tracks.profiles)
  and (select roles from wipe_baseline) = (select count(*) from tracks.user_roles)
  and (select invites from wipe_baseline) = (select count(*) from tracks.invites),
  '94f. Every account, role and invitation is untouched');
select tracks_test.ok(
  (select count(*) from tracks.ppa_revisions) >= (select revisions from wipe_baseline),
  '94g. The revision trail is not erased');
select tracks_test.ok(
  exists (select 1 from tracks.audit_logs where action = 'DATA_DELETED'),
  '94h. The deletion is in the audit log');
