'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowRight, RotateCcw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { rebuildDemoData, setDemoMode } from '@/app/actions/demo'
import { routes } from '@/lib/routes'

export interface DemoStanding {
  id: string
  year: number
  title: string
  /** Department documents in the demo year. */
  aipCount: number
  /** Lines of the programme, headings excluded. */
  ppaCount: number
}

/**
 * Demo mode: a whole worked programme year, on the real application.
 *
 * Two controls and no third: a switch that shows or hides the year, and a
 * button that puts it back the way it was seeded. There is deliberately no
 * "delete the demo" — turning the switch off hides the year rather than
 * destroying it, because a toggle that destroys data is one somebody flips by
 * accident, and because whoever turns it back on next month wants what they
 * left.
 *
 * Hiding is an RLS predicate on `aip_periods` and `aips`, not a filter in
 * TypeScript, so the year leaves every screen at once — the year picker, the
 * consolidated programme, monitoring, Budget's worklist and the presentation
 * deck — without any of them knowing demo mode exists.
 */
export function DemoPanel({ enabled, standing }: {
  enabled: boolean
  standing: DemoStanding | null
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <Label htmlFor="demo-mode" className="text-base font-medium">
                Demo mode
              </Label>
              {enabled ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Adds a complete pretend programme year — departments that have submitted
              and been accepted, reviewed line by line, with a paper trail and Budget
              and Accounting&apos;s figures already recorded against it. It appears in
              the year picker beside the real programme, marked{' '}
              <Badge variant="outline" className="align-middle">DEMO</Badge>.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Turning it off hides the year everywhere. Nothing is deleted, and turning
              it back on brings it back exactly as you left it.
            </p>

            {/* The demo year is dated BEHIND the real programme on purpose, so
                it can never become the year every screen opens on. The cost is
                that turning the switch on changes nothing on the screen you are
                looking at — so the switch has to hand you the way in. */}
            {enabled && standing ? (
              <Link
                href={routes.consolidatedFor(standing.id) as never}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
              >
                Open the demo programme (CY {standing.year})
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </div>

          <Switch
            id="demo-mode"
            checked={enabled}
            disabled={pending}
            onCheckedChange={(next) =>
              startTransition(async () => {
                const result = await setDemoMode(next)
                if (!result.ok) { toast.error(result.error); return }
                toast.success(next
                  ? 'Demo mode is on. The demo year is in the programme picker.'
                  : 'Demo mode is off. The demo year is hidden.')
              })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-base font-medium">Reset the demo data</p>
            {standing ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {standing.title} currently holds {standing.aipCount}{' '}
                {standing.aipCount === 1 ? 'department document' : 'department documents'}
                {' '}and {standing.ppaCount}{' '}
                {standing.ppaCount === 1 ? 'line' : 'lines'} of the programme. Resetting
                discards every edit, review, allotment, obligation and disbursement made
                during a demonstration and seeds the year again.
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">
                No demo year has been built yet. Turning demo mode on builds it.
              </p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                It cannot reach the real programme. Every statement in
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  rebuild_demo_data()
                </code>
                is scoped to the demo year, so the worst it can damage is the demo.
              </span>
            </p>
          </div>

          <Button
            variant="outline"
            disabled={pending || standing === null}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw className="size-4" /> Reset demo data
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset {standing ? standing.title : 'the demo year'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everything anyone has done to the demo programme is discarded and the year
              is seeded again from scratch. The real programme is untouched — this
              reaches nothing outside the demo year.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Leave it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                startTransition(async () => {
                  const result = await rebuildDemoData()
                  if (result.ok) toast.success('The demo year is back to its starting state.')
                  else toast.error(result.error)
                  setConfirming(false)
                })
              }}
            >
              Reset it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
