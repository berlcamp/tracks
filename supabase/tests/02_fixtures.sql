-- 02_fixtures.sql — a miniature City of Bayugan.
-- Two sectors' worth of departments, one open CY 2027 period, two department
-- AIPs, and one three-level group tree copied in shape from the real workbook.

-- Auth users (the stub's auth.users, not Supabase's).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'planadmin@bayugan.gov.ph', '{"full_name":"Planning Admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'planstaff@bayugan.gov.ph', '{"full_name":"Planning Staff"}'),
  ('33333333-3333-3333-3333-333333333333', 'cmohead@bayugan.gov.ph',   '{"full_name":"CMO Head"}'),
  ('44444444-4444-4444-4444-444444444444', 'cmoenc@bayugan.gov.ph',    '{"full_name":"CMO Encoder"}'),
  ('55555555-5555-5555-5555-555555555555', 'chohead@bayugan.gov.ph',   '{"full_name":"CHO Head"}'),
  ('66666666-6666-6666-6666-666666666666', 'budget@bayugan.gov.ph',    '{"full_name":"Budget Officer"}'),
  ('77777777-7777-7777-7777-777777777777', 'acctg@bayugan.gov.ph',     '{"full_name":"Accountant"}'),
  ('99999999-9999-9999-9999-999999999999', 'nobody@example.com',       '{"full_name":"Uninvited"}');

insert into tracks.profiles (id, auth_user_id, email, full_name, global_role) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'planadmin@bayugan.gov.ph', 'Planning Admin', 'user'),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'planstaff@bayugan.gov.ph', 'Planning Staff', 'user'),
  ('a0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'cmohead@bayugan.gov.ph',   'CMO Head',       'user'),
  ('a0000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'cmoenc@bayugan.gov.ph',    'CMO Encoder',    'user'),
  ('a0000000-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', 'chohead@bayugan.gov.ph',   'CHO Head',       'user'),
  ('a0000000-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'budget@bayugan.gov.ph',    'Budget Officer', 'user'),
  ('a0000000-0000-0000-0000-000000000007', '77777777-7777-7777-7777-777777777777', 'acctg@bayugan.gov.ph',     'Accountant',     'user');

insert into tracks.lgu_settings (id, lgu_name, lgu_type, province, region)
values (true, 'Bayugan', 'City', 'Agusan del Sur', 'Caraga');

insert into tracks.sectors (id, code, name, sheet_name, heading, summary_label, sort_order) values
  ('50000000-0000-0000-0000-000000000001', 'PUBLIC',   'Public Services',   'PUBLIC SERVICES Sector',   'GENERAL PUBLIC SECTOR',        'GOVERNANCE SECTOR',           1),
  ('50000000-0000-0000-0000-000000000002', 'ECONOMIC', 'Economic Services', 'ECONOMIC SERVICES Sector', 'ECONOMIC DEVELOPMENT SECTOR',  'ECONOMIC DEVELOPMENT SECTOR', 2),
  ('50000000-0000-0000-0000-000000000003', 'SOCIAL',   'Social Services',   'SOCIAL SERVICES Sector',   'SOCIAL DEVELOPMENT SECTOR',    'SOCIAL DEVELOPMENT SECTOR',   3);

insert into tracks.departments (id, sector_id, code, name, display_name, code_number, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'CMO',   'City Mayor''s Office',                        'City Mayor''s Office (CMO)',                          1,  1),
  ('d0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'CPDSO', 'City Planning and Development Services Office','City Planning and Development Services Office (CPDSO)', 9,  7),
  ('d0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'CHO',   'City Health Office',                          'City Health Office (CHO)',                            11, 1),
  ('d0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', 'CAgrO', 'City Agriculture Office',                     'City Agriculture Office (CAgrO)',                     20, 1);

insert into tracks.user_roles (profile_id, role, department_id) values
  ('a0000000-0000-0000-0000-000000000001', 'planning_admin', null),
  ('a0000000-0000-0000-0000-000000000002', 'planning_staff', null),
  ('a0000000-0000-0000-0000-000000000003', 'dept_head',    'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000004', 'dept_encoder', 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000005', 'dept_head',    'd0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000006', 'budget',       null),
  ('a0000000-0000-0000-0000-000000000007', 'accounting',   null);

insert into tracks.aip_periods (id, year, title, draft_label, nta_amount, status)
values ('60000000-0000-0000-0000-000000000001', 2027,
        'CY 2027 Annual Investment Program', '1st DRAFT', 2194073955.00, 'open');

insert into tracks.aips (id, period_id, department_id, kind, status) values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'annual', 'draft'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'annual', 'draft');

-- The three-level shape from PUBLIC SERVICES rows 135-137, plus the flat
-- one-level shape from row 13. Both must round-trip.
insert into tracks.ppa_groups (id, aip_id, parent_id, name, sort_order) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', null, 'General and Administrative Operation', 1),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', null, 'SUPPORT TO NATIONAL AGENCIES', 2),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'Department of Interior and Local Government', 1),
  ('80000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003', 'General and Administrative Operation', 1);

insert into tracks.ppas (id, aip_id, department_id, group_id, ref_code, description,
                         implementing_office, start_date, end_date, expected_output,
                         funding_source, amount_ps, amount_mooe, amount_fe, amount_co, sort_order) values
  ('90000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
   '1000-000-2-1-01-001-001-001', 'Administrative Cost for Salaries, Wages, and Benefits',
   'City Mayor''s Office', '2027-01-01', '2027-12-31', 'Provided Salaries and Wages', 'GF',
   86222053.00, 0, 0, 0, 1),
  ('90000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001',
   '1000-000-2-1-01-001-001-002', 'Administrative Cost for Travelling (Local)',
   'City Mayor''s Office', '2027-01-01', '2027-12-31', 'Provided Allocation for Transportation', 'GF',
   0, 7000000.00, 0, 0, 2),
  ('90000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004',
   '1000-000-2-1-01-001-001-003', 'Support to DILG Programs',
   'City Mayor''s Office', '2027-01-01', '2027-12-31', 'Supported DILG activities', 'GF',
   0, 500000.00, 0, 2000000.00, 1),
  ('90000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', null,
   '1000-000-2-3-11-001-001-001', 'Acquisition of Medical Supplies',
   'City Health Office', '2027-01-01', '2027-12-31', 'Procured medical supplies', 'GF',
   0, 44259528.00, 0, 16300000.00, 1);
