'use client'

import { useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  createGroup, deleteGroup, moveGroup, renameGroup, reorderGroup,
} from '@/app/actions/ppa'
import type { PpaGroup, PpaRowView } from '@/types/tracks'

/**
 * The column-C heading editor.
 *
 * Column C of the AIP form is a tree, not a label: a PPA filed under a
 * third-level heading prints its two ancestors above it, and the heading's
 * position is what orders the worksheet. So this edits the tree directly —
 * indented, with the moves that change the printout — rather than offering a
 * flat list of names.
 *
 * Nothing here computes an amount. Headings carry no money; they group rows
 * whose totals come from the views.
 */

const TOP_LEVEL = '__top__'
/** Matches the depth 1..4 CHECK on tracks.ppa_groups. */
const MAX_DEPTH = 4

export interface GroupsDialogProps {
  aipId: string
  groups: PpaGroup[]
  /** Used only to tell someone how many rows a delete would leave ungrouped. */
  rows: PpaRowView[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TreeNode {
  group: PpaGroup
  /** Position among its own siblings, for the up/down affordances. */
  isFirst: boolean
  isLast: boolean
  /** Ids of this heading and everything beneath it — an invalid move target. */
  subtree: Set<string>
  /** Levels below this heading, so a move that would breach the cap is hidden. */
  height: number
}

export function GroupsDialog({ aipId, groups, rows, open, onOpenChange }: GroupsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Column-C headings</DialogTitle>
          <DialogDescription>
            The programme, project and activity headings the rows are filed under. A
            row keeps its place if you rename a heading, and stays in the AIP if you
            delete one.
          </DialogDescription>
        </DialogHeader>
        {open ? <GroupsEditor aipId={aipId} groups={groups} rows={rows} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupsEditor({ aipId, groups, rows }: Omit<GroupsDialogProps, 'open' | 'onOpenChange'>) {
  const [pending, startTransition] = useTransition()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [deleting, setDeleting] = useState<PpaGroup | null>(null)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState<string>(TOP_LEVEL)

  const tree = useMemo(() => buildTree(groups), [groups])

  /** How many rows sit directly under each heading. */
  const rowCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!row.group_id) continue
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1)
    }
    return counts
  }, [rows])

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) toast.success(success)
      else toast.error(result.error)
    })
  }

  function add(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await createGroup({
        aipId, name, parentId: newParent === TOP_LEVEL ? '' : newParent,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Heading added.')
      setNewName('')
      // Keep the parent selected: headings are typed in runs under one parent.
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {tree.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No headings yet. Rows without one print directly under the department,
          which is how the shorter departments file their programme.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tree.map((node) => {
            const group = node.group
            const count = rowCounts.get(group.id) ?? 0
            const isRenaming = renaming === group.id

            return (
              <li
                key={group.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                style={{ marginInlineStart: `${(group.depth - 1) * 1.5}rem` }}
              >
                {group.depth > 1 ? (
                  <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}

                {isRenaming ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const name = draftName.trim()
                      if (!name) return
                      startTransition(async () => {
                        const result = await renameGroup({ aipId, groupId: group.id, name })
                        if (!result.ok) {
                          toast.error(result.error)
                          return
                        }
                        toast.success('Heading renamed.')
                        setRenaming(null)
                      })
                    }}
                  >
                    <Label htmlFor={`rename-${group.id}`} className="sr-only">
                      Rename {group.name}
                    </Label>
                    <Input
                      id={`rename-${group.id}`}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      autoFocus
                      className="h-8"
                    />
                    <Button type="submit" size="sm" disabled={pending}>Save</Button>
                    <Button
                      type="button" size="icon" variant="ghost" className="size-8"
                      onClick={() => setRenaming(null)}
                    >
                      <X className="size-4" />
                      <span className="sr-only">Cancel rename</span>
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium">{group.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {count === 0 ? 'no rows' : `${count} row${count === 1 ? '' : 's'}`}
                    </span>

                    <MoveSelect
                      node={node}
                      groups={groups}
                      disabled={pending}
                      onMove={(parentId) =>
                        run(() => moveGroup({ aipId, groupId: group.id, parentId }),
                            'Heading moved.')}
                    />

                    <div className="flex items-center">
                      <Button
                        type="button" size="icon" variant="ghost" className="size-8"
                        disabled={pending || node.isFirst}
                        onClick={() => run(() => reorderGroup(aipId, group.id, 'up'),
                                           'Moved up.')}
                      >
                        <ChevronUp className="size-4" />
                        <span className="sr-only">Move {group.name} up</span>
                      </Button>
                      <Button
                        type="button" size="icon" variant="ghost" className="size-8"
                        disabled={pending || node.isLast}
                        onClick={() => run(() => reorderGroup(aipId, group.id, 'down'),
                                           'Moved down.')}
                      >
                        <ChevronDown className="size-4" />
                        <span className="sr-only">Move {group.name} down</span>
                      </Button>
                      <Button
                        type="button" size="icon" variant="ghost" className="size-8"
                        disabled={pending}
                        onClick={() => { setRenaming(group.id); setDraftName(group.name) }}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Rename {group.name}</span>
                      </Button>
                      <Button
                        type="button" size="icon" variant="ghost"
                        className="size-8 text-destructive hover:text-destructive"
                        disabled={pending}
                        onClick={() => setDeleting(group)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete {group.name}</span>
                      </Button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Add a heading</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor="new-group-name">Name</Label>
            <Input
              id="new-group-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="General and Administrative Operation"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-group-parent">Under</Label>
            <Select value={newParent} onValueChange={setNewParent}>
              <SelectTrigger id="new-group-parent" className="sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP_LEVEL}>Top level</SelectItem>
                {groups
                  .filter((group) => group.depth < MAX_DEPTH)
                  .map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {'— '.repeat(Math.max(0, group.depth - 1))}{group.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Button type="submit" disabled={pending || newName.trim() === ''}>
            <Plus className="size-4" /> Add heading
          </Button>
        </div>
      </form>

      <DeleteGroupAlert
        group={deleting}
        directRows={deleting ? rowCounts.get(deleting.id) ?? 0 : 0}
        descendants={deleting ? descendantsOf(tree, deleting.id) : []}
        rowCounts={rowCounts}
        pending={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const group = deleting
          if (!group) return
          startTransition(async () => {
            const result = await deleteGroup(aipId, group.id)
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            toast.success('Heading deleted. Its rows are still in the AIP.')
            setDeleting(null)
          })
        }}
      />
    </div>
  )
}

/**
 * Reparenting. The list deliberately excludes the heading itself, everything
 * beneath it, and any parent that would push this subtree past the depth cap —
 * the database refuses all three, and an option that can only fail is worse
 * than no option.
 */
function MoveSelect({
  node, groups, disabled, onMove,
}: {
  node: TreeNode
  groups: PpaGroup[]
  disabled: boolean
  onMove: (parentId: string) => void
}) {
  const current = node.group.parent_id ?? TOP_LEVEL
  const options = groups.filter(
    (candidate) =>
      !node.subtree.has(candidate.id) && candidate.depth + node.height < MAX_DEPTH,
  )

  return (
    <>
      <Label htmlFor={`move-${node.group.id}`} className="sr-only">
        File {node.group.name} under
      </Label>
      <Select
        value={current}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === current) return
          onMove(value === TOP_LEVEL ? '' : value)
        }}
      >
        <SelectTrigger id={`move-${node.group.id}`} className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOP_LEVEL}>Top level</SelectItem>
          {options.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {'— '.repeat(Math.max(0, group.depth - 1))}{group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

function DeleteGroupAlert({
  group, directRows, descendants, rowCounts, pending, onCancel, onConfirm,
}: {
  group: PpaGroup | null
  directRows: number
  descendants: PpaGroup[]
  rowCounts: Map<string, number>
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const descendantRows = descendants.reduce(
    (total, child) => total + (rowCounts.get(child.id) ?? 0), 0)
  const affected = directRows + descendantRows

  return (
    <AlertDialog open={group !== null} onOpenChange={(next) => { if (!next) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{group?.name}”?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {descendants.length > 0 ? (
                <p>
                  Its {descendants.length} sub-heading
                  {descendants.length === 1 ? '' : 's'} will be deleted too.
                </p>
              ) : null}
              {affected > 0 ? (
                <p>
                  {affected} row{affected === 1 ? '' : 's'} will stay in the AIP with no
                  column-C heading, keeping their amounts. You can file them under
                  another heading afterwards.
                </p>
              ) : (
                <p>No rows are filed under it.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => { event.preventDefault(); onConfirm() }}
          >
            Delete heading
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Flattens the headings into the order they print in, and works out what each
 * one needs to know about its own position. `groups` arrives ordered by
 * sort_order, which is per-sibling — so the tree has to be walked, not sorted.
 */
function buildTree(groups: PpaGroup[]): TreeNode[] {
  const children = new Map<string | null, PpaGroup[]>()
  for (const group of groups) {
    const key = group.parent_id
    const bucket = children.get(key)
    if (bucket) bucket.push(group)
    else children.set(key, [group])
  }
  for (const bucket of children.values()) bucket.sort((a, b) => a.sort_order - b.sort_order)

  const out: TreeNode[] = []

  const walk = (parentId: string | null) => {
    const siblings = children.get(parentId) ?? []
    siblings.forEach((group, index) => {
      const node: TreeNode = {
        group,
        isFirst: index === 0,
        isLast: index === siblings.length - 1,
        subtree: new Set([group.id]),
        height: 0,
      }
      out.push(node)
      const before = out.length
      walk(group.id)
      // Everything appended by that walk is beneath this heading.
      for (const descendant of out.slice(before)) {
        node.subtree.add(descendant.group.id)
        node.height = Math.max(node.height, descendant.group.depth - group.depth)
      }
    })
  }

  walk(null)

  // A heading orphaned by a parent the reader cannot see would vanish from this
  // list. Nothing in the schema allows it, but dropping rows silently is the
  // one failure this component must not have.
  if (out.length !== groups.length) {
    const seen = new Set(out.map((node) => node.group.id))
    for (const group of groups) {
      if (seen.has(group.id)) continue
      out.push({ group, isFirst: true, isLast: true, subtree: new Set([group.id]), height: 0 })
    }
  }

  return out
}

function descendantsOf(tree: TreeNode[], groupId: string): PpaGroup[] {
  const node = tree.find((candidate) => candidate.group.id === groupId)
  if (!node) return []
  return tree
    .filter((candidate) => candidate.group.id !== groupId && node.subtree.has(candidate.group.id))
    .map((candidate) => candidate.group)
}
