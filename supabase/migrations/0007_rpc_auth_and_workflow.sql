-- 0007_rpc_auth_and_workflow.sql
-- The transitions. Everything that changes WHO you are or WHERE a submission is
-- in the review loop goes through a SECURITY DEFINER function here, never a bare
-- UPDATE from TypeScript.

-- ---------------------------------------------------------------------------
-- tracks.claim_invite()
--
-- WHY THIS IS NOT A TRIGGER ON auth.users:
--   This Supabase project is shared with other apps. A trigger on auth.users
--   that raises — a constraint violation, a bad search_path, a dropped column —
--   breaks signup for EVERY app on the project, and you would debug it from an
--   unrelated codebase. Lazy provisioning has zero blast radius. It also handles
--   the case an AFTER INSERT trigger structurally cannot: an invitee who already
--   exists in auth.users because they use another app on this project.
--
-- Any Google account can obtain a session; that is a project-wide setting we do
-- not control. What is guaranteed is that an uninvited account gets no profile,
-- no role, and — because every read policy calls tracks.is_provisioned() —
-- zero rows from every table.
-- ---------------------------------------------------------------------------

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
    insert into tracks.user_roles (profile_id, role, department_id, status, created_by)
    values (v_profile.id, v_invite.role, v_invite.department_id, 'active', v_invite.invited_by)
    on conflict (profile_id) do update
      set role          = excluded.role,
          department_id = excluded.department_id,
          status        = 'active';

    update tracks.invites
       set status = 'accepted', accepted_at = now()
     where id = v_invite.id;

    perform tracks.write_audit('INVITE_CLAIMED', 'user_role', v_profile.id, null,
                               jsonb_build_object('email', v_email, 'role', v_invite.role));
  end if;

  return v_profile;
end;
$$;

revoke execute on function tracks.claim_invite() from public;
grant execute on function tracks.claim_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- tracks.submit_aip(aip_id)
--
-- Only the department head submits. An AIP that came back with returned items
-- cannot be resubmitted until every one of them has been resolved — otherwise
-- the department bounces the same folder back to Planning unchanged.
-- ---------------------------------------------------------------------------

create or replace function tracks.submit_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip      tracks.aips;
  v_open     integer;
  v_rows     integer;
  v_period   text;
begin
  select * into v_aip from tracks.aips where id = p_aip_id;

  if not found then
    raise exception 'AIP not found.' using errcode = 'P0002';
  end if;

  select per.status into v_period
  from tracks.aip_periods per where per.id = v_aip.period_id;

  if not (tracks.has_role(array['dept_head'])
          and v_aip.department_id = tracks.current_department_id()) then
    raise exception 'Only the department head of this office may submit its AIP.'
      using errcode = '42501';
  end if;

  if v_period in ('approved', 'closed') then
    raise exception 'The % AIP period is no longer accepting submissions.', v_period
      using errcode = '42501';
  end if;

  if v_aip.status not in ('draft', 'returned') then
    raise exception 'This AIP is already %.', v_aip.status using errcode = '42501';
  end if;

  select count(*) into v_rows from tracks.ppas where aip_id = p_aip_id;
  if v_rows = 0 then
    raise exception 'Cannot submit an AIP with no PPAs.' using errcode = '23514';
  end if;

  select count(*) into v_open
  from tracks.ppa_returns r
  join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Resolve the % returned item(s) before resubmitting.', v_open
      using errcode = '23514';
  end if;

  update tracks.aips
     set status       = 'submitted',
         submitted_at = now(),
         submitted_by = tracks.current_profile_id()
   where id = p_aip_id
   returning * into v_aip;

  perform tracks.write_audit('AIP_SUBMITTED', 'aip', p_aip_id, null,
                             jsonb_build_object('ppa_count', v_rows));
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.return_ppa(ppa_id, reason)
--
-- City Planning sends ONE item back. The submission stays locked; only this row
-- becomes editable again. That is the whole point.
-- ---------------------------------------------------------------------------

create or replace function tracks.return_ppa(p_ppa_id uuid, p_reason text)
returns tracks.ppa_returns
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip_id uuid;
  v_status text;
  v_return tracks.ppa_returns;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when returning an item.' using errcode = '23514';
  end if;

  select a.id, a.status into v_aip_id, v_status
  from tracks.ppas p join tracks.aips a on a.id = p.aip_id
  where p.id = p_ppa_id;

  if not found then
    raise exception 'PPA not found.' using errcode = 'P0002';
  end if;

  if v_status not in ('submitted', 'returned') then
    raise exception 'Only a submitted AIP can have items returned (this one is %).', v_status
      using errcode = '42501';
  end if;

  insert into tracks.ppa_returns (ppa_id, reason, returned_by)
  values (p_ppa_id, trim(p_reason), tracks.current_profile_id())
  returning * into v_return;

  update tracks.aips set status = 'returned' where id = v_aip_id and status <> 'returned';

  perform tracks.write_audit('PPA_RETURNED', 'ppa', p_ppa_id, null,
                             jsonb_build_object('reason', trim(p_reason)));
  return v_return;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.resolve_return(ppa_id, note)  — the department closing out a correction.
-- ---------------------------------------------------------------------------

create or replace function tracks.resolve_return(p_ppa_id uuid, p_note text default null)
returns tracks.ppa_returns
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_return tracks.ppa_returns;
begin
  if not exists (
    select 1 from tracks.ppas p
    where p.id = p_ppa_id
      and (tracks.is_planning()
           or (tracks.has_role(array['dept_encoder', 'dept_head'])
               and p.department_id = tracks.current_department_id()))
  ) then
    raise exception 'Not authorized to resolve this item.' using errcode = '42501';
  end if;

  update tracks.ppa_returns
     set resolved_at     = now(),
         resolved_by     = tracks.current_profile_id(),
         resolution_note = p_note
   where ppa_id = p_ppa_id and resolved_at is null
   returning * into v_return;

  if not found then
    raise exception 'This item has no open return.' using errcode = 'P0002';
  end if;

  perform tracks.write_audit('PPA_RETURN_RESOLVED', 'ppa', p_ppa_id, null,
                             jsonb_build_object('note', p_note));
  return v_return;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.accept_aip(aip_id)  — City Planning taking it into the consolidation.
-- ---------------------------------------------------------------------------

create or replace function tracks.accept_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip  tracks.aips;
  v_open integer;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  select count(*) into v_open
  from tracks.ppa_returns r join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Cannot accept an AIP with % unresolved returned item(s).', v_open
      using errcode = '23514';
  end if;

  update tracks.aips
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = tracks.current_profile_id()
   where id = p_aip_id and status = 'submitted'
   returning * into v_aip;

  if not found then
    raise exception 'Only a submitted AIP can be accepted.' using errcode = '42501';
  end if;

  perform tracks.write_audit('AIP_ACCEPTED', 'aip', p_aip_id, null, null);
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.reopen_aip(aip_id, reason) — Planning unlocking a whole submission.
-- The escape hatch for "they submitted the wrong file". Audited, never silent.
-- ---------------------------------------------------------------------------

create or replace function tracks.reopen_aip(p_aip_id uuid, p_reason text)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip tracks.aips;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reopen a submission.' using errcode = '23514';
  end if;

  update tracks.aips
     set status = 'draft', submitted_at = null, submitted_by = null,
         accepted_at = null, accepted_by = null
   where id = p_aip_id and status <> 'draft'
   returning * into v_aip;

  if not found then
    raise exception 'This AIP is already a draft.' using errcode = '42501';
  end if;

  perform tracks.write_audit('AIP_REOPENED', 'aip', p_aip_id, null,
                             jsonb_build_object('reason', trim(p_reason)));
  return v_aip;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracks.set_period_status(period_id, status)
--
-- Moves the consolidated AIP along the paper trail. Planning admin only.
-- ---------------------------------------------------------------------------

create or replace function tracks.set_period_status(p_period_id uuid, p_status text)
returns tracks.aip_periods
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_period tracks.aip_periods;
  v_old    text;
begin
  perform tracks.require_role(array['planning_admin']);

  select status into v_old from tracks.aip_periods where id = p_period_id;
  if not found then
    raise exception 'AIP period not found.' using errcode = 'P0002';
  end if;

  update tracks.aip_periods set status = p_status
   where id = p_period_id
   returning * into v_period;

  perform tracks.write_audit('PERIOD_STATUS_CHANGED', 'aip_period', p_period_id,
                             jsonb_build_object('status', v_old),
                             jsonb_build_object('status', p_status));
  return v_period;
end;
$$;

revoke execute on function tracks.submit_aip(uuid)              from public;
revoke execute on function tracks.return_ppa(uuid, text)        from public;
revoke execute on function tracks.resolve_return(uuid, text)    from public;
revoke execute on function tracks.accept_aip(uuid)              from public;
revoke execute on function tracks.reopen_aip(uuid, text)        from public;
revoke execute on function tracks.set_period_status(uuid, text) from public;

grant execute on function tracks.submit_aip(uuid)              to authenticated;
grant execute on function tracks.return_ppa(uuid, text)        to authenticated;
grant execute on function tracks.resolve_return(uuid, text)    to authenticated;
grant execute on function tracks.accept_aip(uuid)              to authenticated;
grant execute on function tracks.reopen_aip(uuid, text)        to authenticated;
grant execute on function tracks.set_period_status(uuid, text) to authenticated;
