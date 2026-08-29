import Link from 'next/link'
import { FlaskConical } from 'lucide-react'
import { routes } from '@/lib/routes'
import type { AipPeriod } from '@/types/tracks'

/**
 * A strip that says demo mode is on, and points at the year it built.
 *
 * It exists because the demo year is deliberately dated BEHIND the real
 * programme — `getCurrentPeriod()` takes the latest year, so a demo dated ahead
 * of the office's own would become the year every screen opened on. The cost of
 * that choice is that turning demo mode on changes nothing on the screen you
 * are already looking at, which reads exactly like a switch that does not work.
 * This is the way in.
 *
 * It is shown to everybody, not only the administrator who turned it on, and
 * that is the more important half: whoever is looking at TRACKS should be able
 * to tell at a glance that a pretend programme is in the year picker.
 */
export function DemoBanner({ period, isDepartmentUser }: {
  period: AipPeriod
  isDepartmentUser: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <FlaskConical className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <span className="font-medium">Demo mode is on.</span>
      <span className="text-muted-foreground">
        CY {period.year} is a pretend programme, in the year picker beside the real one.
      </span>
      <Link
        href={(isDepartmentUser
          ? routes.aipsFor(period.id)
          : routes.consolidatedFor(period.id)) as never}
        className="font-medium underline underline-offset-4"
      >
        Open it
      </Link>
    </div>
  )
}
