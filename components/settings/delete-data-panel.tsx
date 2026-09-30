'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteProgrammeData } from '@/app/actions/settings'

const CONFIRM_WORD = 'DELETE'

/**
 * The super administrator's way to empty the programme — every department
 * document in every year, demo included, and everything recorded against them.
 *
 * Settings survive it: sectors, departments, statutory funds, AIP periods and
 * access. So do the audit log and the revision trail, which nobody may delete.
 * `tracks.delete_programme_data()` checks the role and the typed word again.
 */
export function DeleteDataPanel() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, startTransition] = useTransition()

  const close = () => { setOpen(false); setTyped('') }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-destructive/40 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-base font-medium">Delete all programme data</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Deletes every department document in every year, the demo year included:
              every PPA row, review, return, progress report, allotment, obligation,
              disbursement, council leg and statutory base. Every period is set back
              to Open.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Kept: sectors, departments, statutory funds, AIP periods, and every
              account, role and invitation. The audit log and the revision history are
              never deleted.
            </p>
          </div>

          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 className="size-4" /> Delete all data
          </Button>
        </div>
      </div>

      <AlertDialog open={open} onOpenChange={(next) => { if (!next) close() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all programme data?</AlertDialogTitle>
            <AlertDialogDescription>
              Every department&apos;s submissions and every peso recorded against them
              are deleted, in every year. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="delete-data-confirm">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              id="delete-data-confirm"
              autoComplete="off"
              value={typed}
              disabled={pending}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || typed !== CONFIRM_WORD}
              onClick={(event) => {
                event.preventDefault()
                startTransition(async () => {
                  const result = await deleteProgrammeData(typed)
                  if (!result.ok) { toast.error(result.error); return }
                  toast.success(`Deleted ${result.data.aips} documents and `
                    + `${result.data.ppas} PPA rows.`)
                  close()
                })
              }}
            >
              {pending ? 'Deleting…' : 'Delete everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
