-- 0021_access_admin.sql
-- Three things for Settings: invitations that stop claiming to be
-- outstanding, and a super administrator's way to empty the programme.
--
-- ---------------------------------------------------------------------------
-- 1. An invitation for somebody already in is superseded, not pending
-- ---------------------------------------------------------------------------
--
-- claim_invite() returns at step 1 for a bound profile, before it ever looks
-- at invitations — an invitation is claimed only on a FIRST sign-in. So an
-- invitation addressed to somebody who already had access (made before
-- `inviteUser` learned to add the office directly, or re-sent after they
-- signed in) sat `pending` forever and Settings listed it as outstanding for
-- a person plainly using the system.
--
-- `superseded` rather than `revoked` or `accepted`: nobody withdrew it and it
-- granted nothing. The trail should say what happened.

alter table tracks.invites drop constraint invites_status_check;
alter table tracks.invites add constraint invites_status_check
  check (status in ('pending', 'accepted', 'revoked', 'expired', 'superseded'));

-- The ones already stranded.
update tracks.invites i
   set status = 'superseded'
 where i.status = 'pending'
   and exists (select 1 from tracks.profiles p
               where p.email = i.email and p.auth_user_id is not null);

-- And from now on, whenever a bound person signs in.
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

    -- An invitation is claimed only on a FIRST sign-in, so one still pending
    -- for a bound address can never take effect. Left alone it sits in
    -- Settings as "outstanding" for somebody who is plainly already in.
    update tracks.invites
       set status = 'superseded'
     where email = v_email and status = 'pending';

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

-- ---------------------------------------------------------------------------
-- 2. delete_programme_data() — empty the programme, keep the settings
-- ---------------------------------------------------------------------------
--
-- Every department document in every period, demo included, and everything
-- hanging off them: rows, reviews, returns, progress, allotments, obligations,
-- disbursements, the council legs, and each year's statutory base.
--
-- What it KEEPS is everything Settings owns: sectors, departments, statutory
-- funds and who files them, the AIP periods themselves (status set back to
-- `open`, so the emptied year can be encoded again), profiles, roles and
-- invitations.
--
-- What it does NOT touch, on purpose:
--   * `audit_logs` and `ppa_revisions`. Neither has a DELETE policy for
--     anybody, and a wipe that erased them would be the one statement in this
--     schema allowed to rewrite history. The revisions point at PPA ids that
--     no longer exist, so nothing renders them; the audit log records the wipe.
--   * Uploaded council documents in storage. `storage.objects` is shared
--     infrastructure and is not deleted by SQL from here.
--
-- Super administrator only — not the planning administrator — and the caller
-- must pass the literal word DELETE, so no stray RPC call can do this.

create or replace function tracks.delete_programme_data(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_counts jsonb;
begin
  if not tracks.is_super_admin() then
    raise exception 'Not authorized: only the super administrator can delete the programme data.'
      using errcode = '42501';
  end if;

  if p_confirm is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'aips',          (select count(*) from tracks.aips),
    'ppas',          (select count(*) from tracks.ppas where row_kind = 'ppa'),
    'allotments',    (select count(*) from tracks.allotments),
    'obligations',   (select count(*) from tracks.obligations),
    'disbursements', (select count(*) from tracks.disbursements)
  ) into v_counts;

  -- The money is ON DELETE RESTRICT against ppas, and against each other, so
  -- it goes first and in this order — the same order rebuild_demo_data() uses.
  delete from tracks.disbursements where true;
  delete from tracks.obligations   where true;
  delete from tracks.allotments    where true;
  delete from tracks.aip_actions   where true;

  -- ppas cascade from here, and reviews, returns and progress cascade from ppas.
  delete from tracks.aips where true;

  delete from tracks.statutory_fund_periods where true;

  update tracks.aip_periods set status = 'open' where status <> 'open';

  perform tracks.write_audit('DATA_DELETED', 'aip_periods', null, v_counts, null,
                             'All programme data deleted from Settings.');

  return v_counts;
end;
$$;

revoke execute on function tracks.delete_programme_data(text) from public;
grant  execute on function tracks.delete_programme_data(text) to authenticated;
