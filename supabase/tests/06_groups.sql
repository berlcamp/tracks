-- 06_groups.sql — column-C headings, now that they are rows.
--
-- A heading is a ppas row with row_kind = 'header' carrying nothing but a
-- description. Three things have to hold or the printed form is wrong: a
-- heading may never hold money, nothing downstream may point at one, and it
-- must take no item number while still occupying a position in the document.

\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_HEAD   '''33333333-3333-3333-3333-333333333333'''
\set CMO_ENC    '''44444444-4444-4444-4444-444444444444'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''
\set H_ADMIN    '''80000000-0000-0000-0000-000000000001'''
\set PPA_1      '''90000000-0000-0000-0000-000000000001'''

-- ---------------------------------------------------------------------------
-- 23. A heading is a caption, not a line of the programme
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select row_kind from tracks.ppas where id = :H_ADMIN::uuid), 'header',
  '23a. A column-C heading is stored as a row of the AIP');

select tracks_test.eq(
  (select item_no from tracks.v_ppa_rows where id = :H_ADMIN::uuid), null::bigint,
  '23b. A heading takes no item number');

-- 4 PPAs across two AIPs; the CMO AIP has 3 of them and 4 headings.
select tracks_test.eq(
  (select max(item_no)::int from tracks.v_ppa_rows where aip_id = :CMO_AIP::uuid), 3,
  '23c. Numbering counts the programme, not the captions');

select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows
    where id = '90000000-0000-0000-0000-000000000003'), 3,
  '23d. A row after three consecutive headings still numbers 3, not 6');

select tracks_test.eq(
  (select ppa_count::int from tracks.v_aip_totals where aip_id = :CMO_AIP::uuid), 3,
  '23e. The Items count on screen excludes headings');

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  format('update tracks.ppas set amount_ps = 5000000 where id = %L', :H_ADMIN),
  '23f. A heading cannot be given money');

select tracks_test.throws(
  format('update tracks.ppas set ref_code = ''1000-000'' where id = %L', :H_ADMIN),
  '23g. A heading cannot be given a ref code');

select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, row_kind, description,
                                   amount_mooe, sort_order)
          values (%L, ''d0000000-0000-0000-0000-000000000001'', ''header'',
                  ''Paid heading'', 1000, 99)', :CMO_AIP),
  '23h. A heading cannot be created holding money');

select tracks_test.throws(
  format('insert into tracks.ppas (aip_id, department_id, row_kind, description,
                                   sort_order)
          values (%L, ''d0000000-0000-0000-0000-000000000001'', ''ppa'',
                  ''Free programme'', 99)', :CMO_AIP),
  '23i. A real row still cannot be created with no money in any expense class');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 24. Nothing downstream may attach to a heading
-- ---------------------------------------------------------------------------

select tracks_test.login(:PLAN_STAFF::uuid);
select tracks_test.throws(
  format('insert into tracks.ppa_returns (ppa_id, reason, returned_by)
          values (%L, ''Wrong caption'', tracks.current_profile_id())', :H_ADMIN),
  '24a. City Planning cannot return a heading');
select tracks_test.logout();

select tracks_test.login('66666666-6666-6666-6666-666666666666'::uuid);
select tracks_test.throws(
  format('insert into tracks.allotments (ppa_id, amount, allotment_date, created_by)
          values (%L, 1000000, ''2027-01-15'', tracks.current_profile_id())', :H_ADMIN),
  '24b. Budget cannot allot money against a heading');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 25. insert_ppa_row places a row and respects the submission lock
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_ENC::uuid);

-- Insert at position 2, between the first heading and the first PPA.
select tracks.insert_ppa_row(
  :CMO_AIP::uuid, 2, 'ppa', 'Inserted between heading and first row',
  null, null, null, null, null, 'GF', 0, 12345, 0, 0);

select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows
    where description = 'Inserted between heading and first row'), 1,
  '25a. A row inserted directly under the first heading becomes item 1');

select tracks_test.eq(
  (select item_no::int from tracks.v_ppa_rows where id = :PPA_1::uuid), 2,
  '25b. The row it displaced numbers 2, with nothing renumbered by hand');

select tracks_test.eq(
  (select description from tracks.v_ppa_rows
    where aip_id = :CMO_AIP::uuid order by sort_order limit 1),
  'General and Administrative Operation',
  '25c. The heading it was inserted under stayed above it');

-- A heading inserted mid-document.
select tracks.insert_ppa_row(:CMO_AIP::uuid, 2, 'header', 'INSERTED HEADING');
select tracks_test.eq(
  (select row_kind from tracks.v_ppa_rows
    where aip_id = :CMO_AIP::uuid order by sort_order offset 1 limit 1),
  'header',
  '25d. A heading can be inserted between two rows');

select tracks_test.eq(
  (select count(*)::int from tracks.v_ppa_rows where aip_id = :CMO_AIP::uuid), 9,
  '25e. The AIP now holds 5 headings and 4 rows');

-- Clean up, back to the fixture the money suite expects.
delete from tracks.ppas where description in
  ('Inserted between heading and first row', 'INSERTED HEADING');
select tracks_test.logout();

-- ---------------------------------------------------------------------------
-- 26. The lock applies to insert_ppa_row exactly as it does to a plain insert
-- ---------------------------------------------------------------------------

select tracks_test.login(:CMO_HEAD::uuid);
select tracks.submit_aip(:CMO_AIP::uuid);
select tracks_test.logout();

select tracks_test.login(:CMO_ENC::uuid);
select tracks_test.throws(
  format('select tracks.insert_ppa_row(%L, 2, ''header'', ''Sneaked in'')', :CMO_AIP),
  '26a. A department cannot insert a heading into a submitted AIP');

select tracks_test.eq(
  (select count(*)::int from tracks.v_ppa_rows
    where aip_id = :CMO_AIP::uuid and description = 'Sneaked in'), 0,
  '26b. And the refused insert shifted nothing — the function is one transaction');
select tracks_test.logout();

-- City Planning is not locked out, because the period is still open.
select tracks_test.login(:PLAN_STAFF::uuid);
select tracks.insert_ppa_row(:CMO_AIP::uuid, 1, 'header', 'PLANNING HEADING');
select tracks_test.eq(
  (select description from tracks.v_ppa_rows
    where aip_id = :CMO_AIP::uuid order by sort_order limit 1),
  'PLANNING HEADING',
  '26c. City Planning may still place a heading in a submitted AIP');
delete from tracks.ppas where description = 'PLANNING HEADING';
select tracks_test.logout();

-- Leave the fixture as the money suite found it.
select tracks_test.login(:PLAN_STAFF::uuid);
update tracks.aips set status = 'draft', submitted_at = null, submitted_by = null
 where id = :CMO_AIP::uuid;
select tracks_test.logout();
