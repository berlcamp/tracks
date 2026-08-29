'use client'

import { useState, useTransition } from 'react'
import { Download, Send, CheckCircle2, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AipGrid, type RowPlacement } from './aip-grid'
import { ReopenDialog } from './reopen-dialog'
import { ReviewDialog } from './review-dialog'
import { SubmissionSwitcher } from './submission-switcher'
import { PpaDialog } from './ppa-dialog'
import { RowHistoryDialog } from './row-history'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { acceptAip, resolveReturn, submitAip } from '@/app/actions/aip'
import { deletePpa } from '@/app/actions/ppa'
import { moneyTotal } from '@/lib/format'
import {
  AIP_STATUS_LABELS, canAccept, canDeleteRow, canEditPpa, canModifyStructure,
  canReopen, canReviewPpa, canSeeReviewColumn, canSubmit, lockOf, reviewStage,
  type EditContext,
} from '@/lib/auth/permissions'
import { routes } from '@/lib/routes'
import type {
  Aip, AipPeriod, AipTotals, Department, PpaRowView, ReviewDecision,
} from '@/types/tracks'

/**
 * The single-AIP screen: grid plus the workflow buttons that apply to it.
 *
 * Every button here is mirrored by a database rule. The UI hides what a user
 * cannot do; the database is what actually refuses.
 */
export function AipWorkspace({
  aip, period, department, rows, siblings, ctx, fundLabel,
}: {
  aip: Aip
  period: AipPeriod
  department: Department
  rows: PpaRowView[]
  siblings: AipTotals[]
  ctx: EditContext
  /** "20% CDF" when this document is a statutory filing, else null. */
  fundLabel?: string | null
}) {
  const [editing, setEditing] = useState<PpaRowView | null>(null)
  const [anchor, setAnchor] = useState<PpaRowView | null>(null)
  const [placement, setPlacement] = useState<RowPlacement>('end')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<PpaRowView | null>(null)
  const [reviewing, setReviewing] = useState<PpaRowView | null>(null)
  const [decision, setDecision] = useState<ReviewDecision>('approved')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [history, setHistory] = useState<PpaRowView | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const openReturns = rows.filter((row) => row.is_returned).length
  const programmeRows = rows.filter((row) => row.row_kind === 'ppa')
  const unread = programmeRows.filter((row) => row.review_status !== 'approved').length
  const stage = reviewStage(aip.status)
  const mayAdd = canModifyStructure(ctx)
  const mayReview = canReviewPpa(ctx)
  const maySubmit = canSubmit(ctx, openReturns, unread)
  const mayAccept = canAccept(ctx, openReturns, unread)
  const mayReopen = canReopen(ctx)

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
              {fundLabel
                ? (aip.kind === 'supplemental'
                    ? `${fundLabel} — Supplemental No. ${aip.supplemental_no}`
                    : fundLabel)
                : aip.kind === 'supplemental'
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

          {mayReopen ? (
            <Button variant="outline" disabled={pending} onClick={() => setReopenOpen(true)}>
              <RotateCcw className="size-4" /> Reopen
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

      {programmeRows.length > 0 && (mayReview || ctx.role === 'dept_head') ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm">
          <span className="font-medium">
            {programmeRows.length - unread} of {programmeRows.length} row
            {programmeRows.length === 1 ? '' : 's'} approved
          </span>
          <span className="text-muted-foreground">
            {stage === 'department'
              ? '— the head reads every line before this AIP is sent in'
              : '— the City Planning Sector Officer is reading these'}
          </span>
          {unread > 0 && ctx.role === 'dept_head' && stage === 'department' ? (
            <span className="ml-auto text-muted-foreground">
              Submitting opens once nothing is left waiting.
            </span>
          ) : null}
          {unread > 0 && mayReview && stage === 'planning' ? (
            <span className="ml-auto text-muted-foreground">
              Accepting opens once every row has been read.
            </span>
          ) : null}
        </div>
      ) : null}

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
          {canEditPpa(ctx, lockOf(row)) ? (
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
        canReview={mayReview}
        showReviewColumn={canSeeReviewColumn(ctx) || openReturns > 0}
        showAuthorColumn={mayAdd || mayReview}
        canEdit={(row) => canEditPpa(ctx, lockOf(row))}
        canDelete={(row) => canDeleteRow(ctx, lockOf(row))}
        onAdd={(row, where) => {
          setEditing(null); setAnchor(row); setPlacement(where); setDialogOpen(true)
        }}
        onEdit={(row) => { setEditing(row); setAnchor(null); setDialogOpen(true) }}
        onDelete={(row) => setDeleting(row)}
        onReview={(row, next) => {
          setReviewing(row); setDecision(next); setReviewOpen(true)
        }}
        onHistory={(row) => { setHistory(row); setHistoryOpen(true) }}
      />

      <PpaDialog
        aipId={aip.id}
        row={editing}
        anchor={anchor}
        placement={placement}
        fundLabel={fundLabel ?? null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <RowHistoryDialog row={history} open={historyOpen} onOpenChange={setHistoryOpen} />

      <ReviewDialog
        row={reviewing}
        decision={decision}
        stage={stage}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />

      <ReopenDialog
        aip={aip}
        departmentName={department.display_name}
        open={reopenOpen}
        onOpenChange={setReopenOpen}
      />

      <AlertDialog open={deleting !== null}
                   onOpenChange={(next) => { if (!next) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.row_kind === 'header'
                ? `Delete the heading “${deleting.description}”?`
                : `Delete item ${deleting?.item_no}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.row_kind === 'header'
                ? 'The rows under it stay exactly where they are — a heading is a '
                  + 'caption, not a container.'
                : `${deleting?.description} · ${moneyTotal(deleting?.amount_total ?? 0)}. `
                  + 'The rows below renumber themselves.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                const target = deleting
                if (!target) return
                startTransition(async () => {
                  const result = await deletePpa(target.id, aip.id)
                  if (result.ok) toast.success('Row deleted.')
                  else toast.error(result.error)
                  setDeleting(null)
                })
              }}
            >
              Delete row
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
