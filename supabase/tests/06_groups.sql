-- 06_groups.sql — the column-C group tree under editing.
--
-- 05_money proves the tree renders and that a cycle is refused. This suite
-- covers what happens when someone MOVES a heading, which is what the group
-- editor in the AIP workspace does. depth is derived, and a stale depth is not
-- cosmetic: v_ppa_group_paths slices sort_path on it, so a wrong depth reorders
-- the printed worksheet.

\set PLAN_STAFF '''22222222-2222-2222-2222-222222222222'''
\set CMO_AIP    '''70000000-0000-0000-0000-000000000001'''

\set G_ADMIN    '''80000000-0000-0000-0000-000000000001'''
\set G_SUPPORT  '''80000000-0000-0000-0000-000000000002'''
\set G_DILG     '''80000000-0000-0000-0000-000000000003'''
\set G_DILG_ADM '''80000000-0000-0000-0000-000000000004'''

-- ---------------------------------------------------------------------------
-- 20. Reparenting carries the whole subtree's depth with it
-- ---------------------------------------------------------------------------

select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG::uuid), 2,
  '20a. Baseline: DILG sits at depth 2 under SUPPORT TO NATIONAL AGENCIES');
select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG_ADM::uuid), 3,
  '20b. Baseline: its child sits at depth 3');

select tracks_test.login(:PLAN_STAFF::uuid);
update tracks.ppa_groups set parent_id = null where id = :G_DILG::uuid;

select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG::uuid), 1,
  '20c. Promoting DILG to a top-level heading puts it at depth 1');
select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG_ADM::uuid), 2,
  '20d. Its child follows to depth 2 — the descendant is not left stale');

-- The path the grid and the exporter actually read.
select tracks_test.eq(
  (select array_length(name_path, 1) from tracks.v_ppa_group_paths
    where id = :G_DILG_ADM::uuid), 2,
  '20e. v_ppa_group_paths reports a two-deep ancestry after the move');

-- Put it back and confirm the depths return, so the move is reversible.
update tracks.ppa_groups set parent_id = :G_SUPPORT::uuid where id = :G_DILG::uuid;
select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG::uuid), 2,
  '20f. Moving it back restores depth 2');
select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = :G_DILG_ADM::uuid), 3,
  '20g. And the child returns to depth 3');
select tracks_test.eq(
  (select path_label from tracks.v_ppa_group_paths where id = :G_DILG_ADM::uuid),
  'SUPPORT TO NATIONAL AGENCIES › Department of Interior and Local Government '
  '› General and Administrative Operation',
  '20h. The full column-C path is intact after the round trip');

-- ---------------------------------------------------------------------------
-- 21. A move that would push a descendant past the depth cap is refused
-- ---------------------------------------------------------------------------

insert into tracks.ppa_groups (id, aip_id, parent_id, name, sort_order) values
  ('81000000-0000-0000-0000-000000000001', :CMO_AIP::uuid, null, 'DEEP ROOT', 90),
  ('81000000-0000-0000-0000-000000000002', :CMO_AIP::uuid,
   '81000000-0000-0000-0000-000000000001', 'Deep level 2', 1),
  ('81000000-0000-0000-0000-000000000003', :CMO_AIP::uuid,
   '81000000-0000-0000-0000-000000000002', 'Deep level 3', 1),
  ('81000000-0000-0000-0000-000000000004', :CMO_AIP::uuid,
   '81000000-0000-0000-0000-000000000003', 'Deep level 4', 1);

select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = '81000000-0000-0000-0000-000000000004'), 4,
  '21a. A four-deep chain is allowed');

-- DEEP ROOT under an existing depth-1 heading would make its leaf depth 5.
select tracks_test.throws(
  format('update tracks.ppa_groups set parent_id = %L where id = %L',
         '80000000-0000-0000-0000-000000000001',
         '81000000-0000-0000-0000-000000000001'),
  '21b. A move that would push a descendant to depth 5 is refused');

select tracks_test.eq(
  (select depth from tracks.ppa_groups where id = '81000000-0000-0000-0000-000000000004'), 4,
  '21c. And the refused move left every depth in the subtree untouched');

-- ---------------------------------------------------------------------------
-- 22. Deleting a heading keeps its PPAs, and takes its children with it
-- ---------------------------------------------------------------------------

insert into tracks.ppas (id, aip_id, department_id, group_id, description,
                         amount_mooe, sort_order)
values ('91000000-0000-0000-0000-000000000001', :CMO_AIP::uuid,
        'd0000000-0000-0000-0000-000000000001',
        '81000000-0000-0000-0000-000000000003', 'Row under a doomed heading', 5000, 50);

delete from tracks.ppa_groups where id = '81000000-0000-0000-0000-000000000001';

select tracks_test.eq(
  (select count(*)::int from tracks.ppa_groups
    where id::text like '81000000%'), 0,
  '22a. Deleting a heading cascades to its child headings');
select tracks_test.eq(
  (select group_id from tracks.ppas where id = '91000000-0000-0000-0000-000000000001'),
  null::uuid,
  '22b. Its PPAs survive, ungrouped — a heading is not a container of money');

delete from tracks.ppas where id = '91000000-0000-0000-0000-000000000001';
select tracks_test.logout();
