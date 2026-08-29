'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ppaHistory } from '@/app/actions/ppa'
import { actorOf, changesOf, headlineOf, snapshotDescription } from '@/lib/aip/history'
import type { PpaRevision, PpaRowView } from '@/types/tracks'

/**
 * Everything that has ever happened to one row of the programme.
 *
 * The trail is the database's, not this screen's: `tracks.ppa_revisions` is
 * written by trigger on every insert, update and delete of `tracks.ppas`, so a
 * change made through a route nobody remembered to instrument is in here too.
 * It is append-only for everyone — no UPDATE policy, no DELETE policy, planning
 * admin included — which is what makes it worth reading.
 *
 * It is on screen only, like the review and "Encoded by" columns, and is never
 * printed on the AIP form.
 */
export function RowHistoryDialog({
  row, open, onOpenChange,
}: {
  row: PpaRowView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            {row?.row_kind === 'header'
              ? 'History of this heading'
              : `History of item ${row?.item_no ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {row
              ? `${row.description} · ${row.department_name}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {open && row ? <Trail key={row.id} ppaId={row.id} /> : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Fetched on open rather than with the grid. A consolidated programme is two
 * thousand rows and each one has a history; loading all of them to show one
 * would be two thousand reads nobody asked for.
 *
 * Keyed by the row, so a second row's trail mounts a fresh component rather
 * than clearing this one's state from inside an effect — which would set state
 * during the commit and cascade a render for every open.
 */
function Trail({ ppaId }: { ppaId: string }) {
  const [revisions, setRevisions] = useState<PpaRevision[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ppaHistory(ppaId).then((result) => {
      if (!live) return
      if (result.ok) setRevisions(result.data)
      else setError(result.error)
    })
    return () => { live = false }
  }, [ppaId])

  if (error) {
    return <p className="py-6 text-sm text-destructive">{error}</p>
  }
  if (revisions === null) {
    return <p className="py-6 text-sm text-muted-foreground">Reading the trail…</p>
  }
  if (revisions.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Nothing recorded against this row. Every change made since it was encoded is
        written here by the database itself, so an empty trail means an unchanged row.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-3">
      {revisions.map((revision) => (
        <Entry key={revision.id} revision={revision} />
      ))}
    </ol>
  )
}

function Entry({ revision }: { revision: PpaRevision }) {
  const actor = actorOf(revision)
  const changes = changesOf(revision)
  const description = snapshotDescription(revision)

  return (
    <li className="rounded-lg border border-border px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{headlineOf(revision)}</span>
        <span className="text-xs text-muted-foreground">{stamp(revision.changed_at)}</span>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{actor.name}</span>
        {actor.capacity ? (
          <Badge variant="secondary" className="font-normal">{actor.capacity}</Badge>
        ) : null}
      </p>

      {changes.length > 0 ? (
        <dl className="mt-2 flex flex-col gap-1.5">
          {changes.map((change) => (
            <div key={change.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <dt className="min-w-52 text-xs text-muted-foreground">{change.label}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground line-through">{change.from}</span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-label="became" />
                <span className="font-medium">{change.to}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {changes.length === 0 && description ? (
        <p className="mt-2 text-muted-foreground">{description}</p>
      ) : null}
    </li>
  )
}

/** "3 Sep 2026, 2:41 pm" — the trail is read for when as much as for what. */
function stamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
