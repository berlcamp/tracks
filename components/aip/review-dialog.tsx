'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { reviewPpa } from '@/app/actions/review'
import { moneyTotal } from '@/lib/format'
import type { PpaRowView, ReviewDecision } from '@/types/tracks'

/**
 * Approving a row, or sending it back.
 *
 * One dialog for both because they are the same act — reading a line and saying
 * so. Remarks are offered on an approval too: "checked against the PPMP" is
 * worth keeping, and an approval with a note attached is the thing a department
 * head can point at six months later.
 */
export function ReviewDialog({
  row, decision, stage, open, onOpenChange,
}: {
  row: PpaRowView | null
  decision: ReviewDecision
  /** Whose reading this is — it changes who the remarks are addressed to. */
  stage: 'department' | 'planning'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && row ? (
          <ReviewForm
            key={`${row.id}-${decision}`}
            row={row}
            decision={decision}
            stage={stage}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ReviewForm({
  row, decision, stage, onOpenChange,
}: {
  row: PpaRowView
  decision: ReviewDecision
  stage: 'department' | 'planning'
  onOpenChange: (open: boolean) => void
}) {
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const returning = decision === 'returned'

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (returning && remarks.trim() === '') {
      setError('Say what needs correcting before sending this row back.')
      return
    }

    startTransition(async () => {
      const result = await reviewPpa({
        aipId: row.aip_id, ppaId: row.id, decision, remarks,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(returning ? 'Sent back for revision.' : 'Row approved.')
      onOpenChange(false)
    })
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>
          {returning ? 'Return item for revision' : 'Approve item'} {row.item_no}
        </DialogTitle>
        <DialogDescription>
          {row.description} · {moneyTotal(row.amount_total)}
        </DialogDescription>
      </DialogHeader>

      <div className="my-5 grid gap-2">
        <Label htmlFor="review-remarks">
          Remarks
          {returning ? (
            <span className="text-destructive"> *</span>
          ) : (
            <span className="ml-1 text-xs font-normal text-muted-foreground">optional</span>
          )}
        </Label>
        <Textarea
          id="review-remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={3}
          autoFocus
          placeholder={returning
            ? 'What the office needs to correct.'
            : stage === 'department'
              ? 'Anything worth recording — checked against the PPMP, and so on.'
              : 'Anything worth recording for the consolidated programme.'}
        />
        {returning ? (
          <p className="text-xs text-muted-foreground">
            The office sees this, and only this row reopens for them.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} variant={returning ? 'destructive' : 'default'}>
          {pending ? 'Saving…' : returning ? 'Return for revision' : 'Approve'}
        </Button>
      </DialogFooter>
    </form>
  )
}
