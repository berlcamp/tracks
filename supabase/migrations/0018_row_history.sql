-- 0018_row_history.sql
-- The audit trail on a PPA row, completed and made readable.
--
-- The trail itself is not new. `ppa_revisions` has been written by trigger
-- since 0003, on every insert, update and delete of `tracks.ppas`, precisely so
-- that a City Planning overwrite of a department's figure can never happen off
-- the record — even through a route nobody remembered to instrument. Two things
-- were missing from it:
--
--   * the CAPACITY the change was made in. "Berl changed MOOE from 1.2m to
--     800k" is the fact; "the City Planning Sector Officer changed it" is the
--     one the office is looking for when it reads this back. The role is
--     stamped at the moment of the write rather than joined from `user_roles`
--     later, because a role can be reassigned and a trail that re-reads it
--     would rewrite its own history.
--
--   * anywhere to READ it. A trail nobody can open is a trail in name only, so
--     `v_ppa_revisions` names the changer and their capacity, and the row menu
--     on both grids opens it.
--
-- Nothing here relaxes a lock and nothing here writes a peso.

-- ---------------------------------------------------------------------------
-- Capacity, stamped at the moment of the write
-- ---------------------------------------------------------------------------
--
-- Null on every revision written before this migration, and on anything the
-- service role does: honest about not knowing, rather than guessing from the
-- role the account holds today.

alter table tracks.ppa_revisions
  add column if not exists changed_role text;

create or replace function tracks.ppas_record_revision()
returns trigger
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_key     text;
  v_by      uuid  := tracks.current_profile_id();
  v_role    text  := tracks.current_role_name();
begin
  if tg_op = 'INSERT' then
    insert into tracks.ppa_revisions (
      ppa_id, aip_id, action, new_values, changed_by, changed_role)
    values (new.id, new.aip_id, 'create', to_jsonb(new) - 'amount_total', v_by, v_role);
    return new;
  elsif tg_op = 'DELETE' then
    insert into tracks.ppa_revisions (
      ppa_id, aip_id, action, old_values, changed_by, changed_role)
    values (old.id, old.aip_id, 'delete', to_jsonb(old) - 'amount_total', v_by, v_role);
    return old;
  end if;

  v_old := to_jsonb(old) - 'amount_total' - 'updated_at';
  v_new := to_jsonb(new) - 'amount_total' - 'updated_at';
  v_changed := '{}';

  for v_key in select jsonb_object_keys(v_new) loop
    if v_old -> v_key is distinct from v_new -> v_key then
      v_changed := v_changed || v_key;
    end if;
  end loop;

  if array_length(v_changed, 1) is null then
    return new;   -- a no-op update writes no history
  end if;

  insert into tracks.ppa_revisions (
    ppa_id, aip_id, action, changed_fields, old_values, new_values,
    changed_by, changed_role
  ) values (
    new.id, new.aip_id, 'update', v_changed,
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_changed) k),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_changed) k),
    v_by, v_role
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- v_ppa_revisions — the trail with a name against it
-- ---------------------------------------------------------------------------
--
-- security_invoker, so `ppa_revisions_read` still judges every row: this view
-- reveals nothing the caller could not already select. It adds the changer's
-- name and the office the row belongs to, and nothing else — no derived
-- summary, because the summary belongs where it is read and the trail has to
-- stay the raw thing.
--
-- `changed_by_name` is null on a revision whose author has been deleted from
-- `profiles`, and the trail survives that: the entry stands with its values
-- intact and no name, which is the truth. `changed_by` is not a cascade for the
-- same reason.

create or replace view tracks.v_ppa_revisions
with (security_invoker = true) as
select
  r.id,
  r.ppa_id,
  r.aip_id,
  r.action,
  r.changed_fields,
  r.old_values,
  r.new_values,
  r.changed_by,
  pr.full_name          as changed_by_name,
  r.changed_role,
  r.changed_at,
  p.row_kind,
  p.department_id,
  d.display_name        as department_name
from tracks.ppa_revisions r
left join tracks.profiles    pr on pr.id = r.changed_by
left join tracks.ppas        p  on p.id  = r.ppa_id
left join tracks.departments d  on d.id  = p.department_id;

grant select on tracks.v_ppa_revisions to authenticated;
