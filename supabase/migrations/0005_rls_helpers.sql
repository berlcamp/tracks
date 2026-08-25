-- 0005_rls_helpers.sql
-- Authorization helpers.
--
-- SECURITY DEFINER precisely so a policy ON tracks.user_roles can call them
-- WITHOUT recursing into user_roles' own RLS — a plain subquery there is
-- infinite recursion.
--
-- STABLE, so Postgres caches them per statement. And they are NOT JWT claims:
-- deactivating an encoder takes effect on their very next query, not when their
-- token expires an hour later.

create or replace function tracks.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce(
    (select global_role = 'super_admin' from tracks.profiles
      where auth_user_id = auth.uid() and active),
    false);
$$;

create or replace function tracks.current_role_name()
returns text
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.role
  from tracks.user_roles ur
  where ur.profile_id = tracks.current_profile_id()
    and ur.status = 'active';
$$;

create or replace function tracks.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.department_id
  from tracks.user_roles ur
  join tracks.departments d on d.id = ur.department_id
  where ur.profile_id = tracks.current_profile_id()
    and ur.status = 'active'
    and d.active;
$$;

create or replace function tracks.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.is_super_admin()
      or coalesce(tracks.current_role_name() = any (p_roles), false);
$$;

-- City Planning Office: reviews, returns items, consolidates, prints.
create or replace function tracks.is_planning()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.has_role(array['planning_staff', 'planning_admin']);
$$;

-- Sector settings, departments, periods, user invites.
create or replace function tracks.is_planning_admin()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.has_role(array['planning_admin']);
$$;

-- Everyone signed in and provisioned may READ the whole AIP — this is a public
-- investment programme, and Budget/Accounting/LDC all need the full picture.
-- WRITE is where the walls are. An account with no active role reads nothing.
create or replace function tracks.is_provisioned()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select tracks.is_super_admin() or tracks.current_role_name() is not null;
$$;

create or replace function tracks.require_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = tracks, public
as $$
begin
  if not tracks.has_role(p_roles) then
    raise exception 'Not authorized: requires one of %.', array_to_string(p_roles, ', ')
      using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The submission lock.
--
-- This is the rule the whole department workflow turns on:
--
--   draft      the department owns it and edits freely
--   submitted  LOCKED. Nobody in the department touches anything.
--   returned   STILL LOCKED — except the specific items City Planning sent
--              back. Three returned items out of two hundred do not reopen
--              the other 197.
--   accepted   LOCKED to the department, permanently.
--
-- City Planning may overwrite at any time until the period is closed; every
-- such write is captured by the ppa_revisions trigger with the original value,
-- so an overwritten department figure is always recoverable.
-- ---------------------------------------------------------------------------

create or replace function tracks.can_edit_ppa(p_ppa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.ppas p
    join tracks.aips a          on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where p.id = p_ppa_id
      and per.status <> 'closed'
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and p.department_id = tracks.current_department_id()
          and (
            a.status = 'draft'
            or (a.status = 'returned' and exists (
                  select 1 from tracks.ppa_returns r
                  where r.ppa_id = p.id and r.resolved_at is null))
          )
        )
      )
  );
$$;

-- Adding or removing a row is a structural change: the department may only do it
-- while the submission is still a draft. A returned item is corrected, not
-- replaced.
create or replace function tracks.can_modify_aip_structure(p_aip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select exists (
    select 1
    from tracks.aips a
    join tracks.aip_periods per on per.id = a.period_id
    where a.id = p_aip_id
      and per.status <> 'closed'
      and (
        tracks.is_planning()
        or (
          tracks.has_role(array['dept_encoder', 'dept_head'])
          and a.department_id = tracks.current_department_id()
          and a.status = 'draft'
        )
      )
  );
$$;

revoke execute on function tracks.is_super_admin()                 from public;
revoke execute on function tracks.current_role_name()              from public;
revoke execute on function tracks.current_department_id()          from public;
revoke execute on function tracks.has_role(text[])                 from public;
revoke execute on function tracks.is_planning()                    from public;
revoke execute on function tracks.is_planning_admin()              from public;
revoke execute on function tracks.is_provisioned()                 from public;
revoke execute on function tracks.require_role(text[])             from public;
revoke execute on function tracks.can_edit_ppa(uuid)               from public;
revoke execute on function tracks.can_modify_aip_structure(uuid)   from public;

grant execute on function tracks.is_super_admin()               to authenticated;
grant execute on function tracks.current_role_name()            to authenticated;
grant execute on function tracks.current_department_id()        to authenticated;
grant execute on function tracks.has_role(text[])               to authenticated;
grant execute on function tracks.is_planning()                  to authenticated;
grant execute on function tracks.is_planning_admin()            to authenticated;
grant execute on function tracks.is_provisioned()               to authenticated;
grant execute on function tracks.can_edit_ppa(uuid)             to authenticated;
grant execute on function tracks.can_modify_aip_structure(uuid) to authenticated;
