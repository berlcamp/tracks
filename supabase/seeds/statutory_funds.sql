-- statutory_funds.sql — the four funds, and the offices that file them.
--
-- Run this AFTER 0016_statutory_funds.sql, in the SQL Editor. Safe to run
-- twice: every insert is `on conflict do nothing` and nothing here updates a
-- row that already exists.
--
-- NOTHING HERE HARDCODES A UUID. Production's departments have different ids
-- from every other install, so each row is matched on its natural key —
-- `statutory_funds.code` and `departments.code`, both unique. Copying uuids out
-- of a local database is how a seed silently attaches a fund to the wrong
-- office, or to none.
--
-- Base amounts are deliberately absent. What the 20% is 20% OF is a fact about
-- one programme year, entered by the planning administrator on the Consolidated
-- AIP screen where its consequence is visible. Until it is stated, the fund
-- reports no ceiling rather than a ceiling of zero.

begin;

-- ---------------------------------------------------------------------------
-- 1. The funds
--
-- `percentage` is written the way the statute writes it — 20, not 0.20.
-- `sheet_name` is the worksheet tab the export writes, and is unique.
-- ---------------------------------------------------------------------------

insert into tracks.statutory_funds
  (code, name, short_label, sheet_name, percentage, sort_order) values
  ('CDF20',  '20% Development Fund',
             '20% CDF',   '20% CDF',   20.00, 1),
  ('CDRRMF', '5% Disaster Risk Reduction and Management Fund',
             '5% CDRRMF', '5% CDRRMF',  5.00, 2),
  ('GAD',    '5% Gender and Development Fund',
             '5% GAD',    '5% GAD',     5.00, 3),
  ('LCPC',   '1% Local Council for the Protection of Children Fund',
             '1% LCPC',   '1% LCPC',    1.00, 4)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Which office files which fund
--
-- This is the list that decides whose "Start a document" menu offers the fund.
-- Add a pairing here and that office can file one; it never touches a document
-- already filed.
-- ---------------------------------------------------------------------------

with wanted (fund_code, department_code) as (values
  ('CDF20',  'CMO'),
  ('CDRRMF', 'CDRRMO'),
  ('GAD',    'CSWDO'),
  ('LCPC',   'CSWDO')
)
insert into tracks.statutory_fund_departments (fund_id, department_id)
select f.id, d.id
from wanted w
join tracks.statutory_funds f on f.code = w.fund_code
join tracks.departments     d on d.code = w.department_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Refuse to finish quietly
--
-- A join that matches nothing inserts nothing and reports success. That is how
-- an office ends up without its Start button with nobody able to say why, so
-- the pairings are read back and a missing one aborts the whole transaction.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  with wanted (fund_code, department_code) as (values
    ('CDF20',  'CMO'),
    ('CDRRMF', 'CDRRMO'),
    ('GAD',    'CSWDO'),
    ('LCPC',   'CSWDO')
  )
  select string_agg(format('%s → %s', w.fund_code, w.department_code), ', ')
    into v_missing
  from wanted w
  where not exists (
    select 1
    from tracks.statutory_fund_departments fd
    join tracks.statutory_funds f on f.id = fd.fund_id
    join tracks.departments     d on d.id = fd.department_id
    where f.code = w.fund_code and d.code = w.department_code
  );

  if v_missing is not null then
    raise exception
      'These pairings did not land, so a department code does not exist here: %',
      v_missing;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- What you should see: four funds, four pairings.
-- ---------------------------------------------------------------------------

select f.sort_order, f.code, f.short_label, f.percentage, d.code as filed_by
from tracks.statutory_funds f
left join tracks.statutory_fund_departments fd on fd.fund_id = f.id
left join tracks.departments d on d.id = fd.department_id
order by f.sort_order, d.code;
