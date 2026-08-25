'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SettingsTable, TableCell, TableRow } from './settings-table'
import { FormField } from './sectors-panel'
import { setPeriodStatus, upsertPeriod } from '@/app/actions/settings'
import { PERIOD_STATUS_LABELS } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import type { AipPeriod, PeriodStatus } from '@/types/tracks'

const STATUSES: PeriodStatus[] = [
  'open', 'consolidating', 'for_ldc', 'for_mayor', 'for_council', 'approved', 'closed',
]

/**
 * The period's status is the paper trail: it says where the printed programme
 * currently is. Changing it is the one thing on this page that is not a plain
 * update — it goes through tracks.set_period_status so the move is audited.
 */
export function PeriodsPanel({ periods }: { periods: AipPeriod[] }) {
  const [editing, setEditing] = useState<AipPeriod | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <SettingsTable
        description="One period per calendar year. Closing a period freezes every AIP in it, including City Planning's own edits."
        addLabel="Add period"
        onAdd={() => { setEditing(null); setOpen(true) }}
        head={['Year', 'Title', 'Draft label', 'NTA', 'Status', '']}
      >
        {periods.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
              No AIP periods yet.
            </TableCell>
          </TableRow>
        ) : null}
        {periods.map((period) => (
          <TableRow key={period.id}>
            <TableCell className="font-medium tabular-nums">{period.year}</TableCell>
            <TableCell>{period.title}</TableCell>
            <TableCell>{period.draft_label ?? '—'}</TableCell>
            <TableCell className="font-mono tabular-nums">
              {period.nta_amount === null ? '—' : moneyTotal(period.nta_amount)}
            </TableCell>
            <TableCell>
              <Select
                value={period.status}
                onValueChange={(status) =>
                  startTransition(async () => {
                    const result = await setPeriodStatus(period.id, status)
                    if (result.ok) toast.success(`Moved to ${PERIOD_STATUS_LABELS[status as PeriodStatus]}.`)
                    else toast.error(result.error)
                  })}
              >
                <SelectTrigger className="w-56" disabled={pending}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PERIOD_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost"
                      onClick={() => { setEditing(period); setOpen(true) }}>
                Edit
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </SettingsTable>

      <PeriodDialog period={editing} open={open} onOpenChange={setOpen} />
    </>
  )
}

function PeriodDialog({ period, open, onOpenChange }: {
  period: AipPeriod | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setError(null); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{period ? 'Edit AIP period' : 'Add AIP period'}</DialogTitle>
          <DialogDescription>
            The draft label prints in the workbook header; the NTA figure prints on SUMMARY.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await upsertPeriod({
                id: period?.id,
                year: String(form.get('year') ?? ''),
                title: String(form.get('title') ?? ''),
                draftLabel: String(form.get('draftLabel') ?? ''),
                ntaAmount: String(form.get('ntaAmount') ?? ''),
              })
              if (!result.ok) { setError(result.error); return }
              toast.success(period ? 'Period updated.' : 'Period added.')
              onOpenChange(false)
            })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Year" name="year" defaultValue={period?.year?.toString()} required
                       placeholder="2027" />
            <FormField label="Draft label" name="draftLabel"
                       defaultValue={period?.draft_label ?? ''} placeholder="1st DRAFT" />
          </div>
          <FormField label="Title" name="title" defaultValue={period?.title} required
                     placeholder="CY 2027 Annual Investment Program" />
          <FormField label="National Tax Allotment" name="ntaAmount"
                     defaultValue={period?.nta_amount?.toString() ?? ''}
                     placeholder="2194073955.00"
                     hint="Printed as a loose figure at the foot of SUMMARY." />

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

