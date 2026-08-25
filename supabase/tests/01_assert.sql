-- 01_assert.sql — a tiny assertion harness.
-- Portable plain SQL: runs against local PostgreSQL and in the Supabase SQL editor.
-- (pgTAP is not available on this machine or on Supabase's hosted instances.)

create schema if not exists tracks_test;

create table if not exists tracks_test.results (
  id          serial primary key,
  description text not null,
  passed      boolean not null,
  detail      text
);

create or replace function tracks_test.ok(p_condition boolean, p_description text)
returns void language plpgsql as $$
begin
  insert into tracks_test.results (description, passed)
  values (p_description, coalesce(p_condition, false));
end $$;

create or replace function tracks_test.eq(p_actual anyelement, p_expected anyelement, p_description text)
returns void language plpgsql as $$
begin
  insert into tracks_test.results (description, passed, detail)
  values (
    p_description,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected then null
         else format('expected %s, got %s', p_expected, p_actual) end
  );
end $$;

-- Asserts that a statement raises. Used for every "must be denied" case.
create or replace function tracks_test.throws(p_sql text, p_description text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    insert into tracks_test.results (description, passed, detail)
    values (p_description, false, 'expected an exception, none raised');
  exception when others then
    insert into tracks_test.results (description, passed) values (p_description, true);
  end;
end $$;

-- Impersonate a user for RLS testing, exactly as PostgREST would.
--
-- Session-scoped (set_config is_local = false), NOT transaction-scoped: psql
-- autocommits each statement, so SET LOCAL would be reverted before the next
-- line of the test script ran.
create or replace function tracks_test.login(p_auth_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_auth_uid, 'role', 'authenticated')::text,
                     false);
  execute 'set role authenticated';
end $$;

create or replace function tracks_test.logout()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create or replace function tracks_test.report()
returns table (status text, description text, detail text)
language sql as $$
  select case when passed then 'PASS' else 'FAIL' end, description, detail
  from tracks_test.results order by id;
$$;

-- The impersonated `authenticated` role must be able to call the harness itself.
grant usage on schema tracks_test to authenticated, anon;
grant all on all tables in schema tracks_test to authenticated;
grant all on all sequences in schema tracks_test to authenticated;
grant execute on all functions in schema tracks_test to authenticated;
