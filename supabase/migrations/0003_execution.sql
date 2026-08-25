-- 0003_execution.sql
-- What happens to a PPA after the resolution: the paper trail, budget
-- allotments, obligations, disbursements and physical progress.
--
-- Obligations and disbursements are TRANSACTIONS, not periodic snapshots — one
-- row per OBR and one row per DV. Utilization is therefore always derivable at
-- any as-of date without a rebuild.

-- ---------------------------------------------------------------------------
-- ppa_revisions trigger
--
-- Placed here (not in 0002) because it depends on tracks.current_profile_id().
-- Generated columns are excluded from the diff: amount_total is a function of
-- the four component columns and would double-report every amount change.
-- ---------------------------------------------------------------------------

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
begin
  if tg_op = 'INSERT' then
    insert into tracks.ppa_revisions (ppa_id, aip_id, action, new_values, changed_by)
    values (new.id, new.aip_id, 'create', to_jsonb(new) - 'amount_total', tracks.current_profile_id());
    return new;
  elsif tg_op = 'DELETE' then
    insert into tracks.ppa_revisions (ppa_id, aip_id, action, old_values, changed_by)
    values (old.id, old.aip_id, 'delete', to_jsonb(old) - 'amount_total', tracks.current_profile_id());
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
    ppa_id, aip_id, action, changed_fields, old_values, new_values, changed_by
  ) values (
    new.id, new.aip_id, 'update', v_changed,
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_changed) k),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_changed) k),
    tracks.current_profile_id()
  );
  return new;
end;
$$;

create trigger ppas_record_revision
  after insert or update or delete on tracks.ppas
  for each row execute function tracks.ppas_record_revision();

-- ---------------------------------------------------------------------------
-- aip_actions  — the paper leg (LDC -> Mayor -> City Council).
--
-- The folder leaves the building and the system learns nothing until it comes
-- back. City Planning encodes what the returned paper says: which body acted,
-- when, under what resolution number, and the scan.
-- ---------------------------------------------------------------------------

create table tracks.aip_actions (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references tracks.aip_periods(id) on delete cascade,
  aip_id       uuid references tracks.aips(id) on delete cascade,  -- set for a supplemental
  stage        text not null check (stage in ('ldc', 'mayor', 'council')),
  action       text not null default 'approved'
                 check (action in ('endorsed', 'approved', 'approved_with_changes', 'returned')),
  action_date  date,
  reference_no text,                       -- resolution / ordinance number
  remarks      text,
  document_url text,                       -- scanned resolution in Storage
  recorded_by  uuid references tracks.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index aip_actions_period_idx on tracks.aip_actions (period_id, stage);

create trigger aip_actions_set_updated_at
  before update on tracks.aip_actions
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- allotments  — Budget Office recording releases against Planning's approved
-- figures. Multiple rows per PPA: a release is rarely the full year in one go.
--
-- Utilization is measured against the SUM of these, not against the PPA's
-- approved amount. The two are shown side by side in every report precisely
-- because they differ.
-- ---------------------------------------------------------------------------

create table tracks.allotments (
  id             uuid primary key default gen_random_uuid(),
  ppa_id         uuid not null references tracks.ppas(id) on delete restrict,
  amount         numeric(16,2) not null check (amount > 0),
  allotment_date date not null,
  reference_no   text,
  remarks        text,
  recorded_by    uuid references tracks.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index allotments_ppa_idx on tracks.allotments (ppa_id, allotment_date);

create trigger allotments_set_updated_at
  before update on tracks.allotments
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- obligations  — Budget Office. One row per Obligation Request (OBR).
-- ---------------------------------------------------------------------------

create table tracks.obligations (
  id               uuid primary key default gen_random_uuid(),
  ppa_id           uuid not null references tracks.ppas(id) on delete restrict,
  obr_no           text,
  obligation_date  date not null,
  payee            text,
  particulars      text,
  amount           numeric(16,2) not null check (amount > 0),
  status           text not null default 'active'
                     check (status in ('active', 'cancelled')),
  cancel_reason    text,
  recorded_by      uuid references tracks.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint obligations_cancel_reason_required
    check (status = 'active' or (cancel_reason is not null and length(trim(cancel_reason)) > 0)),
  -- Lets a disbursement's obligation_id and ppa_id be tied together by the FK
  -- below rather than by application code.
  unique (id, ppa_id)
);

create index obligations_ppa_idx on tracks.obligations (ppa_id, obligation_date);
create index obligations_obr_idx on tracks.obligations (obr_no) where obr_no is not null;

create trigger obligations_set_updated_at
  before update on tracks.obligations
  for each row execute function tracks.set_updated_at();

-- ---------------------------------------------------------------------------
-- disbursements  — Accounting. One row per Disbursement Voucher (DV).
--
-- obligation_id is NULLABLE: Accounting can record a payment against the PPA
-- alone when the OBR is not to hand. When it IS set, the composite FK guarantees
-- the obligation belongs to the same PPA — you cannot pay CMO's OBR out of
-- CSWDO's project. Rows with a null obligation_id are what the
-- "unliquidated obligations" report has to except.
-- ---------------------------------------------------------------------------

create table tracks.disbursements (
  id                uuid primary key default gen_random_uuid(),
  ppa_id            uuid not null,
  obligation_id     uuid,
  dv_no             text,
  check_ada_no      text,
  disbursement_date date not null,
  payee             text,
  particulars       text,
  amount            numeric(16,2) not null check (amount > 0),
  status            text not null default 'active'
                      check (status in ('active', 'cancelled')),
  cancel_reason     text,
  recorded_by       uuid references tracks.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint disbursements_cancel_reason_required
    check (status = 'active' or (cancel_reason is not null and length(trim(cancel_reason)) > 0)),
  foreign key (ppa_id) references tracks.ppas(id) on delete restrict,
  foreign key (obligation_id, ppa_id)
    references tracks.obligations (id, ppa_id) on delete restrict
);

create index disbursements_ppa_idx on tracks.disbursements (ppa_id, disbursement_date);
create index disbursements_obligation_idx on tracks.disbursements (obligation_id);

create trigger disbursements_set_updated_at
  before update on tracks.disbursements
  for each row execute function tracks.set_updated_at();

-- A cancelled obligation must not keep live disbursements hanging off it, and
-- the paid total must never exceed what was obligated. Both are checked here
-- rather than in TypeScript because both are money rules.
create or replace function tracks.disbursements_check_obligation()
returns trigger
language plpgsql
as $$
declare
  v_obligated numeric(16,2);
  v_status    text;
  v_paid      numeric(16,2);
begin
  if new.obligation_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select amount, status into v_obligated, v_status
  from tracks.obligations where id = new.obligation_id;

  if v_status = 'cancelled' then
    raise exception 'Cannot record a disbursement against a cancelled obligation.'
      using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from tracks.disbursements
  where obligation_id = new.obligation_id
    and status = 'active'
    and id <> new.id;

  if v_paid + new.amount > v_obligated then
    raise exception 'Disbursements (%) would exceed the obligated amount (%).',
      v_paid + new.amount, v_obligated using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger disbursements_check_obligation
  before insert or update on tracks.disbursements
  for each row execute function tracks.disbursements_check_obligation();

-- ---------------------------------------------------------------------------
-- ppa_progress  — manually entered physical accomplishment, as-of a date.
-- Snapshots, not transactions: "40% as of 31 March".
-- ---------------------------------------------------------------------------

create table tracks.ppa_progress (
  id               uuid primary key default gen_random_uuid(),
  ppa_id           uuid not null references tracks.ppas(id) on delete cascade,
  as_of_date       date not null,
  percent_complete numeric(5,2) not null check (percent_complete between 0 and 100),
  remarks          text,
  recorded_by      uuid references tracks.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (ppa_id, as_of_date)
);

create index ppa_progress_ppa_idx on tracks.ppa_progress (ppa_id, as_of_date desc);

create trigger ppa_progress_set_updated_at
  before update on tracks.ppa_progress
  for each row execute function tracks.set_updated_at();
