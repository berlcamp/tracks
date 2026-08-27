-- 0015_accept_requires_review.sql
-- Accepting an AIP means City Planning has read it.
--
-- accept_aip() was written in 0007, before per-row review existed, and it only
-- ever asked whether anything was out for revision. 0013 added the second
-- reading and made finalize_aip_period() refuse while a row is unread — but
-- accept_aip() was left as it was, so the two disagreed:
--
--   * accept_aip()          would accept an AIP nobody had read line by line
--   * finalize_aip_period() would then refuse the whole programme, naming rows
--     the administrator has no way to reach — review_ppa() will not record a
--     planning decision on an AIP that is already 'accepted'
--
-- The only way out of that state was to reopen the submission, which sends it
-- back to the department as a draft. An office that did nothing wrong has to
-- resubmit so that a check the Planning Office skipped can be run.
--
-- So accept_aip() now asks the same question finalize_aip_period() asks, and
-- asks it while the answer can still be acted on. Accepting is City Planning's
-- signature on the lines, exactly as submitting is the head's.
--
-- 'returned' counts as unapproved as much as 'pending' does. A department can
-- resolve a return — which closes the ppa_returns entry the old check looked
-- at — without the Planning Office having read the correction, and a row whose
-- last recorded decision is "send this back" is not a row anybody has passed.

create or replace function tracks.accept_aip(p_aip_id uuid)
returns tracks.aips
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_aip        tracks.aips;
  v_open       integer;
  v_unapproved integer;
begin
  perform tracks.require_role(array['planning_staff', 'planning_admin']);

  select count(*) into v_open
  from tracks.ppa_returns r join tracks.ppas p on p.id = r.ppa_id
  where p.aip_id = p_aip_id and r.resolved_at is null;

  if v_open > 0 then
    raise exception 'Cannot accept an AIP with % unresolved returned item(s).', v_open
      using errcode = '23514';
  end if;

  -- Every line read, not the folder. After this the rows are frozen and
  -- review_ppa() will not take another decision on them, so this is the last
  -- moment the question can be asked.
  select count(*) into v_unapproved
  from tracks.ppas p
  join tracks.v_ppa_review_status rs on rs.ppa_id = p.id
  where p.aip_id = p_aip_id and p.row_kind = 'ppa'
    and rs.planning_status <> 'approved';

  if v_unapproved > 0 then
    raise exception
      'Read every row before accepting — % still waiting.', v_unapproved
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

revoke execute on function tracks.accept_aip(uuid) from public;
grant execute on function tracks.accept_aip(uuid) to authenticated;
