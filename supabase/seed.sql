-- seed.sql — applied by `supabase db reset --local` after the migrations.
-- Reference data taken from CY 2027 Annual Investment Program_Consolidated v3:
-- the three sector worksheets and the CODE NUMBER column of SUMMARY.

insert into tracks.lgu_settings (id, lgu_name, lgu_type, province, region)
values (true, 'Bayugan', 'City', 'Agusan del Sur', 'Caraga')
on conflict (id) do nothing;

insert into tracks.sectors (code, name, sheet_name, heading, summary_label, sort_order) values
  ('PUBLIC',   'Public Services',   'PUBLIC SERVICES Sector',   'GENERAL PUBLIC SECTOR',       'GOVERNANCE SECTOR',           1),
  ('ECONOMIC', 'Economic Services', 'ECONOMIC SERVICES Sector', 'ECONOMIC DEVELOPMENT SECTOR', 'ECONOMIC DEVELOPMENT SECTOR', 2),
  ('SOCIAL',   'Social Services',   'SOCIAL SERVICES Sector',   'SOCIAL DEVELOPMENT SECTOR',   'SOCIAL DEVELOPMENT SECTOR',   3)
on conflict (code) do nothing;

-- Departments, in worksheet order within each sector.
insert into tracks.departments (sector_id, code, name, display_name, code_number, sort_order)
select s.id, d.code, d.name, dn.display_name, d.code_number, d.sort_order
from (values
  ('PUBLIC',   'CMO',       'City Mayor''s Office',                                    1,  1),
  ('PUBLIC',   'CVMO',      'City Vice Mayor''s Office',                               2,  2),
  ('PUBLIC',   'SP-SEC',    'Secretary to the Sangguniang Panlungsod',                 4,  3),
  ('PUBLIC',   'CAdmO',     'City Administrator''s Office',                           13,  4),
  ('PUBLIC',   'CHRMO',     'City Human Resource Management Office',                  24,  5),
  ('PUBLIC',   'CGSO',      'City General Services Office',                           17,  6),
  ('PUBLIC',   'CPDSO',     'City Planning and Development Services Office',           9,  7),
  ('PUBLIC',   'CBO',       'City Budget Office',                                      8,  8),
  ('PUBLIC',   'CTO',       'City Treasurer''s Office',                                5,  9),
  ('PUBLIC',   'CAO',       'City Accounting Office',                                  7, 10),
  ('PUBLIC',   'CAssO',     'City Assessor''s Office',                                 6, 11),
  ('PUBLIC',   'OCBO',      'Office of the City Building Official',                   40, 12),
  ('PUBLIC',   'CLO',       'City Legal Office',                                      14, 13),
  ('PUBLIC',   'CIO',       'City Information Office',                                19, 14),
  ('PUBLIC',   'CCRO',      'City Civil Registrar''s Office',                         12, 15),
  ('ECONOMIC', 'CAgrO',     'City Agriculture Office',                                20,  1),
  ('ECONOMIC', 'CVetO',     'City Veterinary Office',                                 15,  2),
  ('ECONOMIC', 'CCDO',      'City Cooperative Development Office',                    23,  3),
  ('ECONOMIC', 'CTourismO', 'City Tourism Office',                                    41,  4),
  ('ECONOMIC', 'PESO',      'Public Employment and Services Office',                  43,  5),
  ('ECONOMIC', 'CENRO',     'City Environment and Natural Resources Office',          22,  6),
  ('ECONOMIC', 'CEO',       'City Engineering Office',                                10,  7),
  ('ECONOMIC', 'CArchO',    'City Architect Office',                                  18,  8),
  ('SOCIAL',   'CHO',       'City Health Office',                                     11,  1),
  ('SOCIAL',   'MAAMI',     'Magdalena A. Asis Medical Infirmary',                    38,  2),
  ('SOCIAL',   'CSWDO',     'City Social Welfare Development Office',                 16,  3),
  ('SOCIAL',   'CCB',       'City College of Bayugan',                                44,  4),
  ('SOCIAL',   'CDRRMO',    'City Disaster Risk Reduction and Management Office',     39,  5)
) as d(sector_code, code, name, code_number, sort_order)
cross join lateral (select id from tracks.sectors where code = d.sector_code) s
-- display_name is what prints on the department band row: "City Mayor's Office (CMO)"
cross join lateral (select d.name || ' (' || d.code || ')' as display_name) dn
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Bootstrap administrator.
--
-- auth_user_id is null on purpose. tracks.claim_invite() binds this row on the
-- first Google sign-in with a matching address — no trigger on auth.users, and
-- nothing here depends on an auth user existing yet.
-- ---------------------------------------------------------------------------

insert into tracks.profiles (email, full_name, global_role)
values ('berlcamp@gmail.com', 'Berl Campomanes', 'super_admin')
on conflict (email) do nothing;

insert into tracks.user_roles (profile_id, role)
select id, 'planning_admin' from tracks.profiles where email = 'berlcamp@gmail.com'
on conflict (profile_id) do nothing;

insert into tracks.aip_periods (year, title, draft_label, nta_amount, status)
values (2027, 'CY 2027 Annual Investment Program', '1st DRAFT', 2194073955.00, 'open')
on conflict (year) do nothing;

-- ---------------------------------------------------------------------------
-- One department AIP with real rows, so the grid, the totals and the export
-- have something to render on a fresh database.
-- ---------------------------------------------------------------------------

with per as (select id from tracks.aip_periods where year = 2027),
     dep as (select id from tracks.departments where code = 'CMO')
insert into tracks.aips (period_id, department_id, kind, status)
select per.id, dep.id, 'annual', 'draft' from per, dep
on conflict do nothing;

with a as (
  select a.id from tracks.aips a
  join tracks.departments d on d.id = a.department_id
  join tracks.aip_periods p on p.id = a.period_id
  where d.code = 'CMO' and p.year = 2027 and a.kind = 'annual'
)
insert into tracks.ppa_groups (aip_id, parent_id, name, sort_order)
select a.id, null, 'General and Administrative Operation', 1 from a
where not exists (select 1 from tracks.ppa_groups g where g.aip_id = (select id from a));

with a as (
  select a.id as aip_id, a.department_id from tracks.aips a
  join tracks.departments d on d.id = a.department_id
  join tracks.aip_periods p on p.id = a.period_id
  where d.code = 'CMO' and p.year = 2027 and a.kind = 'annual'
),
g as (select id from tracks.ppa_groups where aip_id = (select aip_id from a) limit 1)
insert into tracks.ppas (aip_id, department_id, group_id, ref_code, description,
                         implementing_office, start_date, end_date, expected_output,
                         funding_source, amount_ps, amount_mooe, amount_fe, amount_co, sort_order)
select a.aip_id, a.department_id, g.id, v.ref_code, v.description,
       'City Mayor''s Office', date '2027-01-01', date '2027-12-31', v.expected_output,
       'GF', v.ps, v.mooe, 0, v.co, v.sort_order
from a, g, (values
  ('1000-000-2-1-01-001-001-001', 'Administrative Cost for Salaries, Wages, and Benefits',
   'Provided Salaries and Wages for the services rendered by CMO Personnel', 86222053.00, 0.00, 0.00, 1),
  ('1000-000-2-1-01-001-001-002', 'Administrative Cost for Travelling (Local)',
   'Provided Allocation for Transportation, Travel per Diems and Ferriage', 0.00, 7000000.00, 0.00, 2),
  ('1000-000-2-1-01-001-001-007', 'Acquisition of Office Supplies',
   'Procured Office Supplies based on the approved Project Procurement Management Plan', 0.00, 3500000.00, 0.00, 3),
  ('1000-000-2-1-01-001-001-0030', 'Acquisition of Office Equipment',
   'Procured Office Equipment based on the approved Project Procurement Management Plan', 0.00, 0.00, 20000000.00, 4)
) as v(ref_code, description, expected_output, ps, mooe, co, sort_order)
where not exists (select 1 from tracks.ppas p where p.aip_id = (select aip_id from a));
