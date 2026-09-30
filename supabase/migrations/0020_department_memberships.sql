-- 0020_department_memberships.sql
-- One person, several offices. They work as one office at a time.
--
-- Until now `user_roles.profile_id` was UNIQUE: a person held exactly one role
-- and, if it was a department role, exactly one department. An officer who
-- encodes for two offices needed two Google accounts.
--
-- THE ONE RULE THIS FILE TURNS ON: a request acts as ONE membership. Nothing
-- here unions a person's offices. `current_role_name()` and
-- `current_department_id()` still return a single value, and every policy and
-- RPC written against them — the submission lock, the head's review, row
-- authorship, statutory eligibility — keeps meaning exactly what it meant.
-- A head of the CMO who also encodes for the CHO is a head while working as
-- the CMO and an encoder while working as the CHO, never both at once.
--
-- Which membership a request acts as is chosen by the `x-tracks-department`
-- request header, which the server-side Supabase client sets from the office
-- switcher's cookie. PostgREST exposes request headers to SQL as
-- `request.headers`. The header is a REQUEST, not a grant:
--
--   * it is honoured only when it names an active department the person holds
--     an active membership in. Naming any other office — someone editing the
--     cookie by hand — falls back to their default membership, exactly as if
--     no header had been sent. It can never reach an office they do not hold.
--   * with no header at all (psql, the SQL Editor, the browser client, the
--     storage API) a person acts as their OLDEST membership — the office they
--     were first given. For everyone holding one membership, which is everyone
--     on the day this is applied, that is the only one, so behaviour does not
--     change.
--
-- A person holds EITHER department memberships OR one city-wide role, never
-- both. A City Planning officer can already edit every office's row; a Budget
-- officer who was also an encoder would be two capacities the same request
-- could not tell apart. The trigger below refuses the mix.

-- ---------------------------------------------------------------------------
-- 1. The constraint moves from "one per person" to "one per office"
-- ---------------------------------------------------------------------------

alter table tracks.user_roles drop constraint user_roles_profile_id_key;

-- At most one city-wide role per person, and at most one role per person in
-- any one office. Partial indexes rather than one on (profile_id,
-- department_id), because NULLs do not collide in a unique index — a plain
-- composite key would let a person hold budget AND accounting.
create unique index user_roles_one_citywide_idx
  on tracks.user_roles (profile_id) where department_id is null;
create unique index user_roles_one_per_department_idx
  on tracks.user_roles (profile_id, department_id) where department_id is not null;

create index if not exists user_roles_profile_idx on tracks.user_roles (profile_id, status);

create or replace function tracks.user_roles_no_mixed_capacity()
returns trigger
language plpgsql
security definer
set search_path = tracks, public
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- Two concurrent inserts for the same person would each see the other as
  -- absent. Serialise per person; it is an admin screen, not a hot path.
  perform pg_advisory_xact_lock(hashtextextended('tracks.user_roles:' || new.profile_id::text, 0));

  if exists (
    select 1 from tracks.user_roles ur
    where ur.profile_id = new.profile_id
      and ur.id <> new.id
      and ur.status = 'active'
      and (ur.department_id is null) <> (new.department_id is null)
  ) then
    raise exception 'user_roles_mixed_capacity: a person holds department roles or one city-wide role, not both'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger user_roles_no_mixed_capacity
  before insert or update of status, department_id on tracks.user_roles
  for each row execute function tracks.user_roles_no_mixed_capacity();

-- ---------------------------------------------------------------------------
-- 2. Which membership this request acts as
-- ---------------------------------------------------------------------------

-- The office the request asked to act as, or null. A malformed value is null
-- rather than an error: a bad cookie must degrade to the default office, not
-- make every query on the page raise.
create or replace function tracks.requested_department_id()
returns uuid
language sql
stable
set search_path = tracks, public
as $$
  select case
           when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then h::uuid
         end
  from (
    select nullif(current_setting('request.headers', true), '')::json ->> 'x-tracks-department' as h
  ) s;
$$;

-- The one user_roles row this request acts as. The requested office wins when
-- the person holds it and it is active; otherwise the oldest active membership
-- in an active office; otherwise (every office deactivated) the oldest at all,
-- so the person still reads as provisioned and sees the dashboard rather than
-- vanishing — which is what the single-row version did too.
create or replace function tracks.current_membership_id()
returns uuid
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.id
  from tracks.user_roles ur
  left join tracks.departments d on d.id = ur.department_id
  where ur.profile_id = tracks.current_profile_id()
    and ur.status = 'active'
  order by
    (coalesce(ur.department_id = tracks.requested_department_id(), false)
       and coalesce(d.active, true)) desc,
    coalesce(d.active, true) desc,
    ur.created_at,
    ur.id
  limit 1;
$$;

-- Same names, same single value. Every policy and RPC that calls these is
-- unchanged by this migration.
create or replace function tracks.current_role_name()
returns text
language sql
stable
security definer
set search_path = tracks, public
as $$
  select ur.role
  from tracks.user_roles ur
  where ur.id = tracks.current_membership_id();
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
  where ur.id = tracks.current_membership_id()
    and d.active;
$$;

revoke execute on function tracks.requested_department_id() from public;
revoke execute on function tracks.current_membership_id()   from public;
grant execute on function tracks.requested_department_id() to authenticated;
grant execute on function tracks.current_membership_id()   to authenticated;

-- ---------------------------------------------------------------------------
-- 3. claim_invite, without the one-row assumption
-- ---------------------------------------------------------------------------
--
-- The upsert used `on conflict (profile_id)`, which no longer names a unique
-- index. An invitation still SETS the person's capacity the way it always did:
-- a city-wide invitation stands down their office memberships, and an office
-- invitation stands down a city-wide role — deactivated, not deleted, so
-- Settings still shows what they held. An office invitation to someone who
-- already holds other offices ADDS this one.
--
-- Unchanged otherwise. The proxy only calls this for an account with no
-- profile yet; an existing person is given another office from Settings.

create or replace function tracks.claim_invite()
returns tracks.profiles
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_name    text;
  v_avatar  text;
  v_profile tracks.profiles;
  v_invite  tracks.invites;
begin
  if v_uid is null then
    return null;
  end if;

  select lower(u.email),
         coalesce(u.raw_user_meta_data ->> 'full_name',
                  u.raw_user_meta_data ->> 'name',
                  split_part(u.email, '@', 1)),
         u.raw_user_meta_data ->> 'avatar_url'
    into v_email, v_name, v_avatar
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return null;
  end if;

  -- 1. Already bound — refresh the display snapshot and return.
  select * into v_profile from tracks.profiles where auth_user_id = v_uid;
  if found then
    update tracks.profiles
       set full_name  = coalesce(nullif(v_name, ''), full_name),
           avatar_url = coalesce(v_avatar, avatar_url),
           email      = v_email
     where id = v_profile.id
     returning * into v_profile;
    return v_profile;
  end if;

  -- 2. An unbound profile for this address: the bootstrap planning admin, or
  --    someone re-invited after another app removed their auth user.
  select * into v_profile
  from tracks.profiles
  where email = v_email and auth_user_id is null;

  if found then
    update tracks.profiles
       set auth_user_id = v_uid,
           full_name    = coalesce(nullif(v_name, ''), full_name),
           avatar_url   = coalesce(v_avatar, avatar_url)
     where id = v_profile.id
     returning * into v_profile;

    perform tracks.write_audit('PROFILE_BOUND', 'profile', v_profile.id,
                               null, jsonb_build_object('email', v_email));
  end if;

  -- 3. A live invitation for this exact address.
  select * into v_invite
  from tracks.invites
  where email = v_email and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1;

  if not found and v_profile.id is null then
    return null;   -- uninvited. The caller signs them out.
  end if;

  if v_profile.id is null then
    insert into tracks.profiles (auth_user_id, email, full_name, avatar_url, global_role)
    values (v_uid, v_email, coalesce(nullif(v_name, ''), v_invite.full_name), v_avatar, 'user')
    returning * into v_profile;
  end if;

  if v_invite.id is not null then
    if v_invite.department_id is null then
      update tracks.user_roles
         set status = 'inactive'
       where profile_id = v_profile.id and department_id is not null and status = 'active';

      insert into tracks.user_roles (profile_id, role, department_id, status, created_by)
      values (v_profile.id, v_invite.role, null, 'active', v_invite.invited_by)
      on conflict (profile_id) where department_id is null do update
        set role   = excluded.role,
            status = 'active';
    else
      update tracks.user_roles
         set status = 'inactive'
       where profile_id = v_profile.id and department_id is null and status = 'active';

      insert into tracks.user_roles (profile_id, role, department_id, status, created_by)
      values (v_profile.id, v_invite.role, v_invite.department_id, 'active', v_invite.invited_by)
      on conflict (profile_id, department_id) where department_id is not null do update
        set role   = excluded.role,
            status = 'active';
    end if;

    update tracks.invites
       set status = 'accepted', accepted_at = now()
     where id = v_invite.id;

    perform tracks.write_audit('INVITE_CLAIMED', 'user_role', v_profile.id, null,
                               jsonb_build_object('email', v_email, 'role', v_invite.role,
                                                  'department_id', v_invite.department_id));
  end if;

  return v_profile;
end;
$$;

revoke execute on function tracks.claim_invite() from public;
grant execute on function tracks.claim_invite() to authenticated;
