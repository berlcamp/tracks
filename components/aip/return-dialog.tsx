'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { returnPpa } from '@/app/actions/aip'
import type { PpaRowView } from '@/types/tracks'

/** City Planning sending one item back. The reason is required — it is the only
 *  thing the department has to work from. */
export function ReturnDialog({
  row, open, onOpenChange,
}: {
  row: PpaRowView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!row) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remounted per row, so the reason box starts empty without an effect
            that would set state during commit. */}
        {open ? <ReturnForm key={row.id} row={row} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ReturnForm({ row, onOpenChange }: {
  row: PpaRowView
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <>
        <DialogHeader>
          <DialogTitle>Return this item for correction</DialogTitle>
          <DialogDescription>
            Item {row.item_no} — {row.description}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            startTransition(async () => {
              const result = await returnPpa({ ppaId: row.id, reason })
              if (!result.ok) {
                setError(result.error)
                return
              }
              toast.success('Item returned to the department.')
              onOpenChange(false)
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="reason">What needs correcting?</Label>
            <Textarea id="reason" rows={4} required value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Salaries exceed the HR plantilla figure. Please reconcile." />
            <p className="text-xs text-muted-foreground">
              Only this item reopens for the department. The rest of the submission stays
              locked.
            </p>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Returning…' : 'Return item'}
            </Button>
          </DialogFooter>
        </form>
    </>
  )
}
