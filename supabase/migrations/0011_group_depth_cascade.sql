-- 0011_group_depth_cascade.sql
-- Column-C groups: two fixes that both surface as soon as headings are edited
-- rather than only seeded.
--
--   1. Deleting a heading that has PPAs under it fails outright.
--   2. Moving a heading leaves its descendants holding a stale depth.
--
-- ---------------------------------------------------------------------------
-- 1. ppas_group_id_aip_id_fkey — ON DELETE SET NULL nulls the WHOLE key
-- ---------------------------------------------------------------------------
--
-- The FK is composite, (group_id, aip_id) -> ppa_groups (id, aip_id), and a
-- plain ON DELETE SET NULL sets every column of the referencing key to null.
-- Postgres generates, verbatim:
--
--   UPDATE ONLY tracks.ppas SET group_id = NULL, aip_id = NULL WHERE ...
--
-- ppas.aip_id is NOT NULL, so deleting any heading with rows beneath it raises
-- `null value in column "aip_id"` and rolls back. The intent was only ever to
-- let go of the heading — a PPA is not owned by its column-C caption, and
-- removing a caption must not detach the row from its AIP.
--
-- Postgres 15 added the column list for exactly this. Restrict the set-null to
-- group_id and the row keeps its AIP, its department and its money.

alter table tracks.ppas
  drop constraint ppas_group_id_aip_id_fkey;

alter table tracks.ppas
  add constraint ppas_group_id_aip_id_fkey
  foreign key (group_id, aip_id)
  references tracks.ppa_groups (id, aip_id)
  on delete set null (group_id);

-- ---------------------------------------------------------------------------
-- 2. Keep `depth` true for descendants when a group is reparented
-- ---------------------------------------------------------------------------
--
-- ppa_groups_set_depth() is a BEFORE trigger on the row being changed, so it
-- only ever fixes that one row. Moving a subtree left its descendants holding
-- the depth they had under the old parent:
--
--   ROOT-A                                ROOT-B
--     CHILD        depth 2                  CHILD        depth 1  (recomputed)
--       GRANDCHILD depth 3       ->           GRANDCHILD depth 3  (WRONG, is 2)
--
-- That is not cosmetic. v_ppa_group_paths builds sort_path by slicing on
-- `depth` (`w.sort_path[1:c.depth - 1] || c.sort_order || ...`), and v_ppa_rows
-- orders the whole AIP by sort_path. A stale depth writes a PPA into the wrong
-- slot of the sort array, so column (2) renumbers itself wrongly and the
-- exported worksheet prints rows out of order.
--
-- Fixed with an AFTER trigger that walks the subtree once. The recursive update
-- touches `depth` only, and the trigger below is `update of parent_id`, so it
-- cannot re-enter. The depth 1..4 CHECK still applies to every descendant: a
-- move that would push a grandchild past the cap raises and rolls the whole
-- statement back, which is the intended answer rather than a silent truncation.

create or replace function tracks.ppa_groups_sync_descendant_depth()
returns trigger
language plpgsql
as $$
begin
  with recursive subtree as (
    select g.id, new.depth + 1 as new_depth
    from tracks.ppa_groups g
    where g.parent_id = new.id

    union all

    select c.id, s.new_depth + 1
    from tracks.ppa_groups c
    join subtree s on c.parent_id = s.id
  )
  update tracks.ppa_groups g
     set depth = s.new_depth
    from subtree s
   where g.id = s.id
     and g.depth is distinct from s.new_depth;

  return null;
end;
$$;

create trigger ppa_groups_depth_cascade
  after update of parent_id on tracks.ppa_groups
  for each row
  when (old.depth is distinct from new.depth)
  execute function tracks.ppa_groups_sync_descendant_depth();
