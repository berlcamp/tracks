'use client'

import { useState, useTransition } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { finalizePeriod } from '@/app/actions/review'

/**
 * The City Planning Administrator's one signature over the whole consolidated
 * programme.
 *
 * It is deliberately not offered while anything is outstanding, and it says
 * WHICH thing: an administrator who is told only "you cannot do this" has to go
 * hunting through 28 departments. The database refuses the same cases — this
 * only stops the button being a trap.
 */
export function FinalizePanel({
  periodId, unsubmitted, pending: pendingRows, returned,
}: {
  periodId: string
  /** Department AIPs still sitting in draft or returned. */
  unsubmitted: number
  /** Rows City Planning has not read yet. */
  pending: number
  /** Rows sent back and not yet resolved. */
  returned: number
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, startTransition] = useTransition()

  const blockers: string[] = []
  if (unsubmitted > 0) {
    blockers.push(
      `${unsubmitted} department AIP${unsubmitted === 1 ? '' : 's'} still with the office`)
  }
  if (returned > 0) {
    blockers.push(`${returned} row${returned === 1 ? '' : 's'} out for revision`)
  }
  if (pendingRows > 0) {
    blockers.push(`${pendingRows} row${pendingRows === 1 ? '' : 's'} not yet checked`)
  }

  const ready = blockers.length === 0

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
      <ShieldCheck className={ready ? 'size-5 text-emerald-600' : 'size-5 text-muted-foreground'} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {ready
            ? 'Every row has been checked. The programme is ready to go forward.'
            : 'Not ready to finalise'}
        </p>
        {ready ? (
          <p className="mt-0.5 text-sm text-muted-foreground">
            Finalising accepts every department&rsquo;s AIP and locks the programme, so what
            the LDC, the Mayor and the Sangguniang Panlungsod receive cannot move afterwards.
          </p>
        ) : (
          <ul className="mt-0.5 text-sm text-muted-foreground">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        )}
      </div>
      <Button disabled={!ready || busy} onClick={() => setConfirming(true)}>
        <Lock className="size-4" /> Finalise and lock
      </Button>

      <AlertDialog open={confirming} onOpenChange={(next) => { if (!next) setConfirming(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalise the consolidated AIP?</AlertDialogTitle>
            <AlertDialogDescription>
              Every submitted department AIP is accepted and the whole programme closes for
              editing — City Planning included. It moves to &ldquo;With the LDC&rdquo;. This
              is the version that gets printed and signed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                startTransition(async () => {
                  const result = await finalizePeriod(periodId)
                  if (result.ok) toast.success('Programme finalised and locked.')
                  else toast.error(result.error)
                  setConfirming(false)
                })
              }}
            >
              Finalise and lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
