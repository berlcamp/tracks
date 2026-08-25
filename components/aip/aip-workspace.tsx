'use client'

import { useState, useTransition } from 'react'
import { Download, Send, CheckCircle2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AipGrid } from './aip-grid'
import { SubmissionSwitcher } from './submission-switcher'
import { PpaDialog } from './ppa-dialog'
import { ReturnDialog } from './return-dialog'
import { acceptAip, resolveReturn, submitAip } from '@/app/actions/aip'
import {
  AIP_STATUS_LABELS, canAccept, canEditPpa, canModifyStructure, canReturnItems, canSubmit,
  type EditContext,
} from '@/lib/auth/permissions'
import { routes } from '@/lib/routes'
import type {
  Aip, AipPeriod, AipTotals, Department, PpaGroup, PpaRowView,
} from '@/types/tracks'

/**
 * The single-AIP screen: grid plus the workflow buttons that apply to it.
 *
 * Every button here is mirrored by a database rule. The UI hides what a user
 * cannot do; the database is what actually refuses.
 */
export function AipWorkspace({
  aip, period, department, rows, groups, siblings, ctx,
}: {
  aip: Aip
  period: AipPeriod
  department: Department
  rows: PpaRowView[]
  groups: PpaGroup[]
  siblings: AipTotals[]
  ctx: EditContext
}) {
  const [editing, setEditing] = useState<PpaRowView | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [returning, setReturning] = useState<PpaRowView | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const openReturns = rows.filter((row) => row.is_returned).length
  const mayAdd = canModifyStructure(ctx)
  const maySubmit = canSubmit(ctx, openReturns)
  const mayAccept = canAccept(ctx, openReturns)
  const mayReturn = canReturnItems(ctx)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {department.display_name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>CY {period.year}</span>
            <span aria-hidden>·</span>
            <span>
              {aip.kind === 'supplemental'
                ? `Supplemental AIP No. ${aip.supplemental_no}`
                : 'Annual Investment Program'}
            </span>
            <Badge variant={badgeVariant(aip.status)}>{AIP_STATUS_LABELS[aip.status]}</Badge>
            {openReturns > 0 ? (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                {openReturns} item{openReturns === 1 ? '' : 's'} returned
              </Badge>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <a href={routes.aipExport(aip.id)}>
              <Download className="size-4" /> Export to Excel
            </a>
          </Button>

          {maySubmit ? (
            <Button
              disabled={pending || rows.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await submitAip(aip.id)
                  if (result.ok) toast.success('Submitted to the City Planning Office.')
                  else toast.error(result.error)
                })}
            >
              <Send className="size-4" /> Submit to City Planning
            </Button>
          ) : null}

          {mayAccept ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await acceptAip(aip.id)
                  if (result.ok) toast.success('Accepted into the consolidated AIP.')
                  else toast.error(result.error)
                })}
            >
              <CheckCircle2 className="size-4" /> Accept
            </Button>
          ) : null}
        </div>
      </div>

      <SubmissionSwitcher submissions={siblings} currentAipId={aip.id} />

      {aip.status === 'returned' && openReturns > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium">
            City Planning returned {openReturns} item{openReturns === 1 ? '' : 's'}.
          </p>
          <p className="mt-1 text-muted-foreground">
            Only those rows can be edited. Correct each one, mark it resolved, then submit
            again.
          </p>
        </div>
      ) : null}

      {rows.filter((row) => row.is_returned).map((row) => (
        <div key={row.id}
             className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
          <div>
            <p className="font-medium">Item {row.item_no} — {row.description}</p>
            <p className="mt-0.5 text-muted-foreground">{row.open_return_reason}</p>
          </div>
          {canEditPpa(ctx, true) ? (
            <Button
              size="sm" variant="outline" disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await resolveReturn(row.id)
                  if (result.ok) toast.success('Marked as corrected.')
                  else toast.error(result.error)
                })}
            >
              <Undo2 className="size-4" /> Mark corrected
            </Button>
          ) : null}
        </div>
      ))}

      <AipGrid
        rows={rows}
        showDepartmentBands={false}
        canAddRow={mayAdd}
        canReturnItems={mayReturn}
        canEdit={(row) => canEditPpa(ctx, row.is_returned)}
        onAdd={() => { setEditing(null); setDialogOpen(true) }}
        onEdit={(row) => { setEditing(row); setDialogOpen(true) }}
        onReturn={(row) => { setReturning(row); setReturnOpen(true) }}
      />

      <PpaDialog
        aipId={aip.id}
        groups={groups}
        row={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <ReturnDialog row={returning} open={returnOpen} onOpenChange={setReturnOpen} />
    </div>
  )
}

function badgeVariant(status: Aip['status']) {
  switch (status) {
    case 'accepted': return 'default' as const
    case 'submitted': return 'secondary' as const
    case 'returned': return 'outline' as const
    default: return 'outline' as const
  }
}
