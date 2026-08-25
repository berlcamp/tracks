-- 0006_rls_policies.sql
-- Row Level Security. Enabled AND FORCED on every table in tracks.
--
-- Policy shape:
--   * Reads:   any provisioned user sees the whole AIP. This is a public
--              investment programme; Budget, Accounting and the LDC all need
--              the full picture, and hiding a department's rows from another
--              department buys nothing. An account with no active role reads
--              nothing at all.
--   * Writes:  narrow. A department writes only its own rows, only while the
--              submission lock allows it (tracks.can_edit_ppa). Budget writes
--              allotments and obligations, Accounting writes disbursements,
--              City Planning manages reference data and the review loop.
--   * audit_logs and ppa_revisions: insert + select only. No update policy and
--              no delete policy exist, so those operations are denied to
--              everyone, including a planning admin.
--
-- There is no `using (true)` anywhere in this file.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'lgu_settings', 'sectors', 'departments', 'user_roles', 'invites',
    'audit_logs', 'aip_periods', 'aips', 'ppa_groups', 'ppas', 'ppa_returns',
    'ppa_revisions', 'aip_actions', 'allotments', 'obligations', 'disbursements',
    'ppa_progress'
  ] loop
    execute format('alter table tracks.%I enable row level security', t);
    execute format('alter table tracks.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy profiles_read on tracks.profiles for select to authenticated
using (auth_user_id = auth.uid() or tracks.is_provisioned());

create policy profiles_self_update on tracks.profiles for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid() and global_role = 'user' and active);
-- A user cannot promote themselves and cannot un-deactivate themselves.

create policy profiles_admin_write on tracks.profiles for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy user_roles_read on tracks.user_roles for select to authenticated
using (profile_id = tracks.current_profile_id() or tracks.is_provisioned());

create policy user_roles_admin_write on tracks.user_roles for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy invites_read on tracks.invites for select to authenticated
using (tracks.is_planning_admin());

create policy invites_admin_write on tracks.invites for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

-- ---------------------------------------------------------------------------
-- Reference data — City Planning Office owns all of it.
-- ---------------------------------------------------------------------------

create policy lgu_settings_read on tracks.lgu_settings for select to authenticated
using (tracks.is_provisioned());

create policy lgu_settings_admin_write on tracks.lgu_settings for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy sectors_read on tracks.sectors for select to authenticated
using (tracks.is_provisioned());

create policy sectors_admin_write on tracks.sectors for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy departments_read on tracks.departments for select to authenticated
using (tracks.is_provisioned());

create policy departments_admin_write on tracks.departments for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

-- ---------------------------------------------------------------------------
-- Periods and submissions
-- ---------------------------------------------------------------------------

create policy aip_periods_read on tracks.aip_periods for select to authenticated
using (tracks.is_provisioned());

create policy aip_periods_admin_write on tracks.aip_periods for all to authenticated
using (tracks.is_planning_admin())
with check (tracks.is_planning_admin());

create policy aips_read on tracks.aips for select to authenticated
using (tracks.is_provisioned());

-- A department head or encoder may create their own department's submission
-- while the period is open. They may not create anybody else's.
create policy aips_department_insert on tracks.aips for insert to authenticated
with check (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and department_id = tracks.current_department_id()
  and exists (select 1 from tracks.aip_periods per
               where per.id = period_id and per.status not in ('approved', 'closed'))
);

-- The department may edit the submission row itself only while it is a draft.
-- The submit transition is an RPC, not a bare UPDATE — see 0007.
create policy aips_department_update on tracks.aips for update to authenticated
using (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and department_id = tracks.current_department_id()
  and status = 'draft'
)
with check (
  department_id = tracks.current_department_id()
  and status = 'draft'
);

create policy aips_planning_write on tracks.aips for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

-- ---------------------------------------------------------------------------
-- The grid: groups and PPAs
-- ---------------------------------------------------------------------------

create policy ppa_groups_read on tracks.ppa_groups for select to authenticated
using (tracks.is_provisioned());

create policy ppa_groups_write on tracks.ppa_groups for all to authenticated
using (tracks.can_modify_aip_structure(aip_id))
with check (tracks.can_modify_aip_structure(aip_id));

create policy ppas_read on tracks.ppas for select to authenticated
using (tracks.is_provisioned());

-- Insert and delete follow the AIP's structural lock; update follows the
-- per-item lock, which is what lets a returned item be corrected while the rest
-- of a submitted AIP stays frozen.
create policy ppas_insert on tracks.ppas for insert to authenticated
with check (tracks.can_modify_aip_structure(aip_id));

create policy ppas_update on tracks.ppas for update to authenticated
using (tracks.can_edit_ppa(id))
with check (tracks.can_edit_ppa(id));

create policy ppas_delete on tracks.ppas for delete to authenticated
using (tracks.can_modify_aip_structure(aip_id));

-- ---------------------------------------------------------------------------
-- Returns — City Planning opens them, the department resolves them.
-- ---------------------------------------------------------------------------

create policy ppa_returns_read on tracks.ppa_returns for select to authenticated
using (tracks.is_provisioned());

create policy ppa_returns_planning_write on tracks.ppa_returns for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

-- The department may only close out a return on its own item, and only by
-- stamping resolved_at — it cannot rewrite the reason it was sent back.
create policy ppa_returns_department_resolve on tracks.ppa_returns for update to authenticated
using (
  tracks.has_role(array['dept_encoder', 'dept_head'])
  and exists (select 1 from tracks.ppas p
               where p.id = ppa_id and p.department_id = tracks.current_department_id())
)
with check (resolved_at is not null);

-- ---------------------------------------------------------------------------
-- History — append only. No update policy, no delete policy, for anyone.
-- ---------------------------------------------------------------------------

create policy ppa_revisions_read on tracks.ppa_revisions for select to authenticated
using (tracks.is_provisioned());

create policy audit_logs_read on tracks.audit_logs for select to authenticated
using (tracks.is_provisioned());

create policy audit_logs_insert on tracks.audit_logs for insert to authenticated
with check (tracks.is_provisioned());

-- ---------------------------------------------------------------------------
-- Execution: council actions, allotments, obligations, disbursements, progress
-- ---------------------------------------------------------------------------

create policy aip_actions_read on tracks.aip_actions for select to authenticated
using (tracks.is_provisioned());

create policy aip_actions_planning_write on tracks.aip_actions for all to authenticated
using (tracks.is_planning())
with check (tracks.is_planning());

create policy allotments_read on tracks.allotments for select to authenticated
using (tracks.is_provisioned());

create policy allotments_budget_write on tracks.allotments for all to authenticated
using (tracks.has_role(array['budget']))
with check (tracks.has_role(array['budget']));

create policy obligations_read on tracks.obligations for select to authenticated
using (tracks.is_provisioned());

create policy obligations_budget_write on tracks.obligations for all to authenticated
using (tracks.has_role(array['budget']))
with check (tracks.has_role(array['budget']));

create policy disbursements_read on tracks.disbursements for select to authenticated
using (tracks.is_provisioned());

create policy disbursements_accounting_write on tracks.disbursements for all to authenticated
using (tracks.has_role(array['accounting']))
with check (tracks.has_role(array['accounting']));

-- Physical accomplishment is reported by the office actually doing the work,
-- and City Planning consolidates it.
create policy ppa_progress_read on tracks.ppa_progress for select to authenticated
using (tracks.is_provisioned());

create policy ppa_progress_write on tracks.ppa_progress for all to authenticated
using (
  tracks.is_planning()
  or (tracks.has_role(array['dept_encoder', 'dept_head'])
      and exists (select 1 from tracks.ppas p
                   where p.id = ppa_id
                     and p.department_id = tracks.current_department_id()))
)
with check (
  tracks.is_planning()
  or (tracks.has_role(array['dept_encoder', 'dept_head'])
      and exists (select 1 from tracks.ppas p
                   where p.id = ppa_id
                     and p.department_id = tracks.current_department_id()))
);
