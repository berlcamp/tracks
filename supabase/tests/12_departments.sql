-- 12_departments.sql — one person, several offices.
--
-- The property worth asserting is that a request acts as ONE membership: a
-- person who holds the CMO and the CHO edits the CMO's rows while working as
-- the CMO and cannot touch them while working as the CHO, and a forged
-- `x-tracks-department` header never reaches an office they do not hold.

\set PLAN_ADMIN '''11111111-1111-1111-1111-111111111111'''
\set TWO_OFFICE '''aaaaaaaa-0000-0000-0000-000000000001'''
\set CMO        '''d0000000-0000-0000-0000-000000000001'''
\set CHO        '''d0000000-0000-0000-0000-000000000003'''
\set CAGRO      '''d0000000-0000-0000-0000-000000000004'''

-- Acting as an office, exactly as PostgREST would expose the header.
create or replace function tracks_test.act_as(p_department text)
returns void language plpgsql as $$
begin
  perform set_config('request.headers',
                     case when p_department is null then ''
                          else json_build_object('x-tracks-department', p_department)::text end,
                     false);
end $$;
grant execute on function tracks_test.act_as(text) to authenticated;

-- How many rows a statement touched. RLS filters an UPDATE rather than
-- raising, so "locked" reads as zero rows.
create or replace function tracks_test.affected(p_sql text)
returns int language plpgsql as $$
declare v_count int;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function tracks_test.affected(text) to authenticated;

-- A person who encodes for the CMO (given first) and heads the CHO.
insert into auth.users (id, email, raw_user_meta_data) values
  (:TWO_OFFICE, 'twooffice@bayugan.gov.ph', '{"full_name":"Two Office"}');
insert into tracks.profiles (id, auth_user_id, email, full_name, global_role) values
  ('a0000000-0000-0000-0000-00000000000a', :TWO_OFFICE, 'twooffice@bayugan.gov.ph', 'Two Office', 'user');
insert into tracks.user_roles (profile_id, role, department_id, created_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'dept_encoder', :CMO, now() - interval '1 day'),
  ('a0000000-0000-0000-0000-00000000000a', 'dept_head',    :CHO, now());

-- A year of its own, so the earlier suites' submissions cannot decide these.
insert into tracks.aip_periods (id, year, title, draft_label, status)
values ('60000000-0000-0000-0000-000000000031', 2031, 'CY 2031 Annual Investment Program', '1st DRAFT', 'open');
insert into tracks.aips (id, period_id, department_id, kind, status) values
  ('70000000-0000-0000-0000-000000000031', '60000000-0000-0000-0000-000000000031', :CMO, 'annual', 'draft'),
  ('70000000-0000-0000-0000-000000000032', '60000000-0000-0000-0000-000000000031', :CHO, 'annual', 'draft');
insert into tracks.ppas (id, aip_id, department_id, description, implementing_office,
                         start_date, end_date, funding_source, amount_mooe, sort_order) values
  ('90000000-0000-0000-0000-000000000031', '70000000-0000-0000-0000-000000000031', :CMO,
   'CMO line', 'City Mayor''s Office', '2031-01-01', '2031-12-31', 'GF', 1000.00, 1),
  ('90000000-0000-0000-0000-000000000032', '70000000-0000-0000-0000-000000000032', :CHO,
   'CHO line', 'City Health Office', '2031-01-01', '2031-12-31', 'GF', 1000.00, 1);

-- ---------------------------------------------------------------------------
-- 78. Which office a request acts as
-- ---------------------------------------------------------------------------

select tracks_test.login(:TWO_OFFICE::uuid);

select tracks_test.act_as(null);
select tracks_test.eq(tracks.current_department_id(), :CMO::uuid,
  '78a. With no header, a person acts as the office they were given first');
select tracks_test.eq(tracks.current_role_name(), 'dept_encoder',
  '78b. And holds that office''s role');

select tracks_test.act_as(:CHO);
select tracks_test.eq(tracks.current_department_id(), :CHO::uuid,
  '78c. The header switches them to another office they hold');
select tracks_test.eq(tracks.current_role_name(), 'dept_head',
  '78d. And to the role they hold THERE, not the one they hold elsewhere');

select tracks_test.act_as(:CAGRO);
select tracks_test.eq(tracks.current_department_id(), :CMO::uuid,
  '78e. A header naming an office they do not hold is ignored');

select tracks_test.act_as('not-a-uuid');
select tracks_test.eq(tracks.current_department_id(), :CMO::uuid,
  '78f. A malformed header falls back rather than raising');

-- ---------------------------------------------------------------------------
-- 79. The submission lock follows the office being acted as
-- ---------------------------------------------------------------------------

select tracks_test.act_as(:CHO);
select tracks_test.eq(
  tracks_test.affected($$update tracks.ppas set description = 'CHO line, edited'
     where id = '90000000-0000-0000-0000-000000000032'$$), 1,
  '79a. Working as the CHO, they edit the CHO''s draft row');
select tracks_test.eq(
  tracks_test.affected($$update tracks.ppas set description = 'CMO line, edited from CHO'
     where id = '90000000-0000-0000-0000-000000000031'$$), 0,
  '79b. Working as the CHO, the CMO''s row is locked to them');
select tracks_test.ok(
  not tracks.can_modify_aip_structure('70000000-0000-0000-0000-000000000031'),
  '79c. Nor may they add or remove the CMO''s rows');

select tracks_test.act_as(:CMO);
select tracks_test.eq(
  tracks_test.affected($$update tracks.ppas set description = 'CMO line, edited'
     where id = '90000000-0000-0000-0000-000000000031'$$), 1,
  '79d. Switched to the CMO, they edit the CMO''s row');
select tracks_test.eq(
  tracks_test.affected($$update tracks.ppas set description = 'CHO line, edited from CMO'
     where id = '90000000-0000-0000-0000-000000000032'$$), 0,
  '79e. And the CHO''s row is locked to them again');
select tracks_test.throws(
  $$select tracks.submit_aip('70000000-0000-0000-0000-000000000031')$$,
  '79f. They are an encoder in the CMO, so they cannot submit its AIP');

select tracks_test.act_as(null);
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 80. What an administrator may and may not grant
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_ADMIN::uuid);

select tracks_test.throws(
  $$insert into tracks.user_roles (profile_id, role, department_id)
    values ('a0000000-0000-0000-0000-00000000000a', 'dept_encoder', 'd0000000-0000-0000-0000-000000000001')$$,
  '80a. A person holds one role per office, not two');
select tracks_test.throws(
  $$insert into tracks.user_roles (profile_id, role, department_id)
    values ('a0000000-0000-0000-0000-00000000000a', 'budget', null)$$,
  '80b. A person with office memberships cannot also hold a city-wide role');
select tracks_test.throws(
  $$insert into tracks.user_roles (profile_id, role, department_id)
    values ('a0000000-0000-0000-0000-000000000002', 'dept_encoder', 'd0000000-0000-0000-0000-000000000004')$$,
  '80c. A City Planning officer cannot be given an office membership');
select tracks_test.throws(
  $$insert into tracks.user_roles (profile_id, role, department_id)
    values ('a0000000-0000-0000-0000-000000000006', 'accounting', null)$$,
  '80d. Nor can anybody hold two city-wide roles');

insert into tracks.user_roles (profile_id, role, department_id)
values ('a0000000-0000-0000-0000-00000000000a', 'dept_encoder', :CAGRO);
select tracks_test.eq(
  (select count(*) from tracks.user_roles
    where profile_id = 'a0000000-0000-0000-0000-00000000000a' and status = 'active')::int, 3,
  '80e. An administrator adds a third office to the same person');

update tracks.user_roles set status = 'inactive'
 where profile_id = 'a0000000-0000-0000-0000-00000000000a' and department_id = :CAGRO;
select tracks_test.logout();

select tracks_test.login(:TWO_OFFICE::uuid);
select tracks_test.act_as(:CAGRO);
select tracks_test.eq(tracks.current_department_id(), :CMO::uuid,
  '80f. A deactivated membership cannot be switched to');
select tracks_test.act_as(null);
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 81. An invitation adds an office rather than replacing the last one
-- ---------------------------------------------------------------------------

-- An unbound profile — the "re-invited after another app removed their auth
-- user" path — already holding the CMO, invited to the CHO.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'reinvited@bayugan.gov.ph', '{"full_name":"Re Invited"}');
insert into tracks.profiles (id, auth_user_id, email, full_name, global_role) values
  ('a0000000-0000-0000-0000-00000000000b', null, 'reinvited@bayugan.gov.ph', 'Re Invited', 'user');
insert into tracks.user_roles (profile_id, role, department_id) values
  ('a0000000-0000-0000-0000-00000000000b', 'dept_encoder', :CMO);
insert into tracks.invites (email, full_name, role, department_id) values
  ('reinvited@bayugan.gov.ph', 'Re Invited', 'dept_encoder', :CHO);

select tracks_test.login('aaaaaaaa-0000-0000-0000-000000000002'::uuid);
select tracks.claim_invite();
select tracks_test.logout();

select tracks_test.eq(
  (select array_agg(d.code order by d.code) from tracks.user_roles ur
     join tracks.departments d on d.id = ur.department_id
    where ur.profile_id = 'a0000000-0000-0000-0000-00000000000b' and ur.status = 'active'),
  array['CHO', 'CMO']::text[],
  '81a. Claiming an office invitation adds that office to the ones already held');
