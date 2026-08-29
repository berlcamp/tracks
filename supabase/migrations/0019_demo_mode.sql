-- 0019_demo_mode.sql
-- Demo mode: a whole worked year of the programme, on the real application,
-- that can be handed back to its starting state whenever somebody has finished
-- clicking through it.
--
-- THE ONE RULE THIS FILE TURNS ON: demo data lives in its own AIP PERIOD, and
-- nothing here ever touches a row outside one. Every table in `tracks` hangs
-- off `aip_periods` — aips, then ppas, then reviews, returns, revisions,
-- allotments, obligations, disbursements, progress; aip_actions off the period
-- directly — so a period is the only boundary in this schema that a reset can
-- be scoped to and be *structurally* unable to escape. `rebuild_demo_data()`
-- deletes nothing that is not reachable from `aip_periods.is_demo`, and the
-- filter is written into every statement rather than assumed once at the top.
--
-- Three decisions worth knowing before changing anything here:
--
--   * There are NO demo sign-ins. Whoever is signed in walks the demo, which
--     is why this migration adds no account, no password and no service-role
--     path — the application still holds nothing but the anon key. The demo
--     PROFILES it creates carry `auth_user_id = null`: they exist so the rows
--     have believable names against them, and they can never authenticate,
--     because there is no auth user to authenticate as.
--
--   * Turning demo mode OFF hides the year; it does not delete it. A toggle
--     that destroys data is a toggle somebody flips by accident. Hiding is an
--     RLS predicate, not a filter in TypeScript, so the demo period leaves
--     every screen at once — picker, consolidated view, monitoring, budget,
--     the presentation deck — without a single query being edited.
--
--   * The demo year is in the PAST. `getCurrentPeriod()` takes the latest year,
--     so a demo programme dated behind the real one can never become the year
--     the office lands on by default.

-- ---------------------------------------------------------------------------
-- 1. The switch, and the mark
-- ---------------------------------------------------------------------------
--
-- The switch is on `lgu_settings` — one row, already the place this
-- installation's own facts live. The mark is on the period, because "is this
-- pretend?" is a fact about a document and not about the installation.

alter table tracks.lgu_settings
  add column if not exists demo_mode boolean not null default false;

alter table tracks.aip_periods
  add column if not exists is_demo boolean not null default false;

create index if not exists aip_periods_demo_idx
  on tracks.aip_periods (is_demo) where is_demo;

create or replace function tracks.demo_mode_enabled()
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce((select demo_mode from tracks.lgu_settings where id), false);
$$;

revoke execute on function tracks.demo_mode_enabled() from public;
grant execute on function tracks.demo_mode_enabled() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hiding, in every policy that governs a SELECT
-- ---------------------------------------------------------------------------
--
-- `v_ppa_rows`, `v_aip_totals`, `v_sector_totals`, `v_period_totals` and
-- `v_monitoring` are all security_invoker and all start FROM `tracks.aips`;
-- the period picker and the deck read `aip_periods`. Tighten those two tables
-- and the demo year leaves every screen at once, with no query edited.
--
-- BOTH policies on each table have to be tightened, not just the one called
-- `_read`. `aips_planning_write` and `aip_periods_admin_write` are FOR ALL,
-- which includes SELECT, and multiple permissive policies are OR'd together —
-- so tightening `aips_read` alone hides the demo year from a department user
-- and leaves it in full view of the City Planning Office, which is the one
-- audience the switch exists for. Adding the predicate to the write policies
-- also stops a hidden year being edited, which is the right answer anyway: a
-- document nobody can see is not one anybody should be changing.
--
-- `ppas_read` is deliberately left alone. Filtering it would put an EXISTS on
-- the hottest read in the application — every row of a 1,268-row grid — to
-- hide rows already unreachable through every view that renders them. Demo
-- data is not secret; it is noise, and this is about noise.

create or replace function tracks.period_visible(p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = tracks, public
as $$
  select coalesce(
    (select not per.is_demo or tracks.demo_mode_enabled()
       from tracks.aip_periods per
      where per.id = p_period_id),
    false);
$$;

revoke execute on function tracks.period_visible(uuid) from public;
grant execute on function tracks.period_visible(uuid) to authenticated;

drop policy aip_periods_read on tracks.aip_periods;
create policy aip_periods_read on tracks.aip_periods for select to authenticated
using (
  tracks.is_provisioned()
  and (not is_demo or tracks.demo_mode_enabled())
);

drop policy aip_periods_admin_write on tracks.aip_periods;
create policy aip_periods_admin_write on tracks.aip_periods for all to authenticated
using (
  tracks.is_planning_admin()
  and (not is_demo or tracks.demo_mode_enabled())
)
with check (
  tracks.is_planning_admin()
  and (not is_demo or tracks.demo_mode_enabled())
);

drop policy aips_read on tracks.aips;
create policy aips_read on tracks.aips for select to authenticated
using (tracks.is_provisioned() and tracks.period_visible(period_id));

drop policy aips_planning_write on tracks.aips;
create policy aips_planning_write on tracks.aips for all to authenticated
using (tracks.is_planning() and tracks.period_visible(period_id))
with check (tracks.is_planning() and tracks.period_visible(period_id));

-- ---------------------------------------------------------------------------
-- 3. The demo cast
-- ---------------------------------------------------------------------------
--
-- Profiles with no auth user. They put a name on an encoded row, an approval
-- and an obligation, so the demo reads like a year somebody actually worked
-- rather than a table of nulls. `auth_user_id` is null and no invitation is
-- ever written for these addresses, so there is nothing to sign in as: the
-- `.invalid` TLD is reserved by RFC 2606 and can never receive mail either.

create or replace function tracks.demo_profile(p_key text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_email text := 'demo.' || p_key || '@bayugan.invalid';
  v_id    uuid;
begin
  select id into v_id from tracks.profiles where email = v_email;
  if v_id is not null then
    return v_id;
  end if;
  insert into tracks.profiles (auth_user_id, email, full_name, global_role, active)
  values (null, v_email, p_name, 'user', true)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function tracks.demo_profile(text, text) from public;

-- ---------------------------------------------------------------------------
-- 4. rebuild_demo_data() — the seed and the reset, which are the same thing
-- ---------------------------------------------------------------------------
--
-- "Reset the demo" and "create the demo" differ only in whether there was
-- anything there before, so they are one function. Everything it deletes is
-- reached by joining back to `aip_periods.is_demo`; there is no statement in
-- here whose WHERE clause could match a real row.
--
-- The four execution tables are deleted FIRST and by hand: allotments,
-- obligations and disbursements reference ppas `on delete restrict`, precisely
-- so that a project with money recorded against it cannot be quietly deleted
-- out from under Budget. Reviews, returns and progress cascade from `ppas`,
-- and `ppas` cascades from `aips`.
--
-- `ppa_revisions` is NOT deleted, and that is deliberate. It has no DELETE
-- policy for anybody, and a reset that erased the trail would be the one thing
-- in this schema allowed to rewrite history. The old entries point at PPA ids
-- that no longer exist, so nothing renders them; they are the record that a
-- demo generation existed and was cleared.
--
-- SECURITY DEFINER because it writes to tables whose policies belong to other
-- offices — a planning administrator cannot insert an obligation, and should
-- not be able to. The role check is the first statement in the body, which is
-- what a definer function owes you: the lock it bypasses is written out where
-- it can be read.

create or replace function tracks.rebuild_demo_data()
returns uuid
language plpgsql
security definer
set search_path = tracks, public
as $$
declare
  v_period uuid;
  v_year   integer;
  v_plan   uuid;
  v_head   uuid;
  v_enc    uuid;
  v_budget uuid;
  v_acct   uuid;
  d        record;
  v_aip    uuid;
  v_status text;
  v_row    uuid;
  r        integer;
  v_ps     numeric(16,2);
  v_mooe   numeric(16,2);
  v_co     numeric(16,2);
  v_amt    numeric(16,2);
  v_ob     uuid;
  v_month  integer;
  v_count  integer := 0;
begin
  perform tracks.require_role(array['planning_admin']);

  -- The demo year is reused if there is one, so the URL somebody bookmarked
  -- mid-demo still resolves after a reset. Otherwise the newest free year at
  -- or below 2025 — behind any plausible real programme, so getCurrentPeriod()
  -- never lands on it.
  select id, year into v_period, v_year
  from tracks.aip_periods where is_demo order by year desc limit 1;

  if v_period is null then
    -- ORDER BY, not the order generate_series emits in: the anti-join below is
    -- free to reorder its input, and without this the demo lands on whichever
    -- free year the planner happened to produce first.
    select y into v_year
    from generate_series(2025, 2015, -1) y
    where not exists (select 1 from tracks.aip_periods p where p.year = y)
    order by y desc
    limit 1;

    if v_year is null then
      raise exception
        'No free year between 2015 and 2025 for the demo programme. Remove an unused period first.'
        using errcode = '23505';
    end if;

    insert into tracks.aip_periods
      (year, title, draft_label, nta_amount, status, is_demo)
    values
      (v_year, 'CY ' || v_year || ' Annual Investment Program (DEMO)',
       'DEMO DATA', 1850000000.00, 'consolidating', true)
    returning id into v_period;
  end if;

  -- Back to its starting state, whatever anyone did to it.
  delete from tracks.disbursements where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.obligations where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.allotments where ppa_id in (
    select p.id from tracks.ppas p
    join tracks.aips a on a.id = p.aip_id
    join tracks.aip_periods per on per.id = a.period_id
    where per.is_demo);

  delete from tracks.aip_actions
   where period_id in (select id from tracks.aip_periods where is_demo);

  -- ppas cascade from here, and reviews, returns and progress cascade from ppas.
  delete from tracks.aips
   where period_id in (select id from tracks.aip_periods where is_demo);

  update tracks.aip_periods
     set title       = 'CY ' || v_year || ' Annual Investment Program (DEMO)',
         draft_label = 'DEMO DATA',
         nta_amount  = 1850000000.00,
         status      = 'consolidating'
   where id = v_period;

  v_plan   := tracks.demo_profile('planning',   'Perla Villanueva (demo)');
  v_head   := tracks.demo_profile('head',       'Hector Lim (demo)');
  v_enc    := tracks.demo_profile('encoder',    'Elena Cruz (demo)');
  v_budget := tracks.demo_profile('budget',     'Benito Ramos (demo)');
  v_acct   := tracks.demo_profile('accounting', 'Aurora Diaz (demo)');

  for d in
    select dep.id, dep.display_name,
           row_number() over (order by s.sort_order, dep.sort_order) as idx
    from tracks.departments dep
    join tracks.sectors s on s.id = dep.sector_id
    where dep.active
    order by s.sort_order, dep.sort_order
  loop
    -- Mostly worked through and accepted, which is what the office wants to
    -- show. One office in ten is still drafting and one has a correction
    -- outstanding, so the submission lock and the return flow are both
    -- reachable from the demo rather than only describable.
    v_status := case
      when d.idx % 10 = 1 then 'draft'
      when d.idx % 10 = 2 then 'returned'
      when d.idx % 5  = 3 then 'submitted'
      else 'accepted'
    end;

    insert into tracks.aips (
      period_id, department_id, kind, status,
      submitted_at, submitted_by, accepted_at, accepted_by, created_by)
    values (
      v_period, d.id, 'annual', v_status,
      case when v_status <> 'draft'
           then make_timestamptz(v_year, 2, 5 + (d.idx % 20)::int, 9, 30, 0) end,
      case when v_status <> 'draft' then v_head end,
      case when v_status = 'accepted'
           then make_timestamptz(v_year, 3, 1 + (d.idx % 25)::int, 14, 15, 0) end,
      case when v_status = 'accepted' then v_plan end,
      v_enc)
    returning id into v_aip;

    insert into tracks.ppas (
      aip_id, department_id, row_kind, description, sort_order, created_by)
    values (
      v_aip, d.id, 'header', 'General and Administrative Operation', 1, v_enc);

    for r in 1..4 loop
      v_ps   := case when r = 1 then 4000000 + d.idx * 310000 else 0 end;
      v_mooe := case when r = 2 then 1800000 + d.idx * 120000
                     when r = 3 then  950000 + d.idx *  45000 else 0 end;
      v_co   := case when r = 4 then 6500000 + d.idx * 520000 else 0 end;
      v_amt  := v_ps + v_mooe + v_co;

      insert into tracks.ppas (
        aip_id, department_id, row_kind, ref_code, description,
        implementing_office, start_date, end_date, expected_output,
        funding_source, amount_ps, amount_mooe, amount_fe, amount_co,
        sort_order, created_by)
      values (
        v_aip, d.id, 'ppa',
        '1000-000-2-1-01-' || lpad(d.idx::text, 3, '0') || '-' || lpad(r::text, 3, '0'),
        case r
          when 1 then 'Administrative Cost for Salaries, Wages and Benefits'
          when 2 then 'Maintenance and Other Operating Requirements'
          when 3 then 'Capacity Building and Training of Personnel'
          else        'Acquisition of Equipment and Facilities'
        end,
        d.display_name,
        make_date(v_year, 1, 1), make_date(v_year, 12, 31),
        case r
          when 1 then 'Provided salaries and wages for personnel'
          when 2 then 'Sustained day-to-day operations for twelve months'
          when 3 then 'Trained personnel on mandated programs'
          else        'Procured equipment per the approved Procurement Plan'
        end,
        'GF', v_ps, v_mooe, 0, v_co, r + 1, v_enc)
      returning id into v_row;

      v_count := v_count + 1;

      -- The head reads every line before the office signs it off.
      if v_status <> 'draft' then
        insert into tracks.ppa_reviews (
          ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
        values (
          v_row, 'department', 'approved', 'Consistent with the PPMP.', v_head,
          make_timestamptz(v_year, 2, 4 + (d.idx % 20)::int, 16, 0, 0));
      end if;

      -- City Planning's reading. A submitted office is still waiting on it,
      -- which is exactly the state the review column exists to show.
      if v_status = 'accepted' then
        insert into tracks.ppa_reviews (
          ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
        values (
          v_row, 'planning', 'approved', null, v_plan,
          make_timestamptz(v_year, 2, 25, 11, 0, 0));
      elsif v_status = 'returned' then
        if r = 2 then
          insert into tracks.ppa_reviews (
            ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
          values (
            v_row, 'planning', 'returned',
            'Split the operating requirement by object of expenditure.', v_plan,
            make_timestamptz(v_year, 2, 26, 10, 0, 0));
          insert into tracks.ppa_returns (ppa_id, reason, returned_by, returned_at)
          values (
            v_row, 'Split the operating requirement by object of expenditure.',
            v_plan, make_timestamptz(v_year, 2, 26, 10, 0, 0));
        else
          insert into tracks.ppa_reviews (
            ppa_id, stage, decision, remarks, reviewed_by, reviewed_at)
          values (v_row, 'planning', 'approved', null, v_plan,
                  make_timestamptz(v_year, 2, 26, 10, 0, 0));
        end if;
      end if;

      -- Money only follows acceptance, the way it does in the office: Budget
      -- allots against an accepted line, obligates against the allotment, and
      -- Accounting pays against the obligation. Spread across the year so the
      -- deck's execution curve has a shape rather than a step.
      if v_status = 'accepted' then
        insert into tracks.allotments (
          ppa_id, amount, allotment_date, reference_no, remarks, recorded_by)
        values (
          v_row, round(v_amt * 0.90, 2), make_date(v_year, 2, 15),
          'SARO-' || lpad(d.idx::text, 3, '0') || '-' || r,
          'First release.', v_budget);

        v_month := 3 + ((d.idx + r) % 5)::int;

        insert into tracks.obligations (
          ppa_id, obr_no, obligation_date, payee, particulars, amount, recorded_by)
        values (
          v_row, 'OBR-' || v_year || '-' || lpad((d.idx * 4 + r)::text, 4, '0'),
          make_date(v_year, v_month, 12), 'Various payees',
          'Obligated per approved programme of work.',
          round(v_amt * 0.40, 2), v_budget)
        returning id into v_ob;

        insert into tracks.disbursements (
          ppa_id, obligation_id, dv_no, check_ada_no, disbursement_date,
          payee, particulars, amount, recorded_by)
        values (
          v_row, v_ob, 'DV-' || v_year || '-' || lpad((d.idx * 4 + r)::text, 4, '0'),
          'ADA-' || lpad((d.idx * 4 + r)::text, 5, '0'),
          make_date(v_year, least(v_month + 2, 12), 20), 'Various payees',
          'Payment of obligations incurred.',
          round(v_amt * 0.40 * 0.75, 2), v_acct);

        insert into tracks.obligations (
          ppa_id, obr_no, obligation_date, payee, particulars, amount, recorded_by)
        values (
          v_row, 'OBR-' || v_year || '-' || lpad((d.idx * 4 + r + 500)::text, 4, '0'),
          make_date(v_year, least(v_month + 4, 12), 8), 'Various payees',
          'Second tranche against the same allotment.',
          round(v_amt * 0.25, 2), v_budget)
        returning id into v_ob;

        insert into tracks.disbursements (
          ppa_id, obligation_id, dv_no, disbursement_date,
          payee, particulars, amount, recorded_by)
        values (
          v_row, v_ob, 'DV-' || v_year || '-' || lpad((d.idx * 4 + r + 500)::text, 4, '0'),
          make_date(v_year, 12, 15), 'Various payees',
          'Final payment for the year.', round(v_amt * 0.25 * 0.60, 2), v_acct);

        -- Not every line reports progress, and the deck says how much of the
        -- programme its weighted average speaks for. A demo in which every row
        -- reports would hide that the report handles the gap.
        if (d.idx + r) % 3 <> 0 then
          insert into tracks.ppa_progress (
            ppa_id, as_of_date, percent_complete, remarks, recorded_by)
          values (
            v_row, make_date(v_year, 9, 30),
            least(95, 35 + ((d.idx * 7 + r * 11) % 55))::numeric(5,2),
            'Third quarter accomplishment report.', v_head);
        end if;
      end if;
    end loop;
  end loop;

  -- The paper leg. It went to the LDC and came back, which is why the period
  -- is `consolidating` and not `for_ldc` — paper comes back as well as goes
  -- out, and a demo in which it only ever goes out teaches the wrong thing.
  insert into tracks.aip_actions (
    period_id, stage, action, action_date, reference_no, remarks, recorded_by)
  values
    (v_period, 'ldc', 'endorsed', make_date(v_year, 3, 18),
     'LDC Resolution No. 04-' || v_year,
     'Endorsed to the Office of the City Mayor.', v_plan),
    (v_period, 'mayor', 'returned', make_date(v_year, 4, 2),
     'Memorandum No. 22-' || v_year,
     'Returned for realignment of the capital outlay before transmittal to the Sangguniang Panlungsod.',
     v_plan);

  perform tracks.write_audit(
    'demo.rebuild', 'aip_periods', v_period, null,
    jsonb_build_object('year', v_year, 'ppa_rows', v_count), null);

  return v_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The switch itself
-- ---------------------------------------------------------------------------
--
-- Enabling for the first time builds the year. Enabling again does not rebuild
-- it: somebody turning the demo back on after a week wants what they left, and
-- rebuilding is its own button that says what it does.

create or replace function tracks.set_demo_mode(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = tracks, public
as $$
begin
  perform tracks.require_role(array['planning_admin']);

  insert into tracks.lgu_settings (id, demo_mode) values (true, p_on)
  on conflict (id) do update set demo_mode = excluded.demo_mode;

  if p_on and not exists (select 1 from tracks.aip_periods where is_demo) then
    perform tracks.rebuild_demo_data();
  end if;

  perform tracks.write_audit(
    case when p_on then 'demo.enable' else 'demo.disable' end,
    'lgu_settings', null, null, jsonb_build_object('demo_mode', p_on), null);

  return p_on;
end;
$$;

revoke execute on function tracks.rebuild_demo_data()      from public;
revoke execute on function tracks.set_demo_mode(boolean)   from public;
grant  execute on function tracks.rebuild_demo_data()      to authenticated;
grant  execute on function tracks.set_demo_mode(boolean)   to authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the settings panel needs to say
-- ---------------------------------------------------------------------------
--
-- The panel reports how much is in the demo year — and has to be able to do it
-- WHILE the year is hidden, which is exactly when somebody is deciding whether
-- to turn it back on. Every other read of the demo period goes through RLS and
-- correctly sees nothing, so this one function is the deliberate exception: it
-- is SECURITY DEFINER, it is planning-administrator only, and it returns three
-- counts and a title. It exposes no row.

create or replace function tracks.demo_standing()
returns jsonb
language plpgsql
stable
security definer
set search_path = tracks, public
as $$
declare
  v_period record;
begin
  perform tracks.require_role(array['planning_admin']);

  select per.id, per.year, per.title into v_period
  from tracks.aip_periods per where per.is_demo
  order by per.year desc limit 1;

  if v_period.id is null then
    return jsonb_build_object('enabled', tracks.demo_mode_enabled(), 'period', null);
  end if;

  return jsonb_build_object(
    'enabled', tracks.demo_mode_enabled(),
    'period', jsonb_build_object(
      'year',  v_period.year,
      'title', v_period.title,
      'aipCount', (select count(*) from tracks.aips a where a.period_id = v_period.id),
      'ppaCount', (select count(*) from tracks.ppas p
                   join tracks.aips a on a.id = p.aip_id
                   where a.period_id = v_period.id and p.row_kind = 'ppa')));
end;
$$;

revoke execute on function tracks.demo_standing() from public;
grant execute on function tracks.demo_standing() to authenticated;
