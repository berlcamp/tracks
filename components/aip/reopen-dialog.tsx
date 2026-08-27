'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { reopenAip } from '@/app/actions/aip'
import { AIP_STATUS_LABELS } from '@/lib/auth/permissions'
import type { Aip } from '@/types/tracks'

/**
 * City Planning handing a submission back to the office that sent it.
 *
 * The reason is required by tracks.reopen_aip() and kept in the audit log,
 * because this undoes something a department did and, when the AIP had been
 * accepted, something City Planning itself did. An office that finds its
 * programme in draft again is owed the sentence explaining why.
 */
export function ReopenDialog({
  aip, departmentName, open, onOpenChange,
}: {
  aip: Aip
  departmentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <ReopenForm
            key={aip.id}
            aip={aip}
            departmentName={departmentName}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ReopenForm({
  aip, departmentName, onOpenChange,
}: {
  aip: Aip
  departmentName: string
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (reason.trim() === '') {
      setError('Say why this submission is going back.')
      return
    }

    startTransition(async () => {
      const result = await reopenAip(aip.id, reason.trim())
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Reopened. The office owns it again.')
      onOpenChange(false)
    })
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Reopen this submission?</DialogTitle>
        <DialogDescription>
          {departmentName} · {AIP_STATUS_LABELS[aip.status]}
        </DialogDescription>
      </DialogHeader>

      <div className="my-5 grid gap-3">
        <p className="text-sm text-muted-foreground">
          It goes back to the office as a draft
          {aip.status === 'accepted' ? ', and it stops being accepted' : ''}. Every
          decision already recorded stays on the row, so the head can submit again
          without re-reading lines they have already passed — but they do have to
          submit it, and City Planning reads it afresh afterwards.
        </p>

        <div className="grid gap-2">
          <Label htmlFor="reopen-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="reopen-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            autoFocus
            placeholder="Wrong file sent in; accepted before the rows were read; and so on."
          />
          <p className="text-xs text-muted-foreground">
            Kept in the audit log against your name.
          </p>
        </div>
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
        <Button type="submit" disabled={pending}>
          {pending ? 'Reopening…' : 'Reopen submission'}
        </Button>
      </DialogFooter>
    </form>
  )
}
