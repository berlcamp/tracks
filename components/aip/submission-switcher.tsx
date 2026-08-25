'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { AIP_STATUS_LABELS } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { AipTotals } from '@/types/tracks'

/**
 * A department's submissions for one year, side by side.
 *
 * They are NOT merged into a single view. A supplemental only ever adds PPAs —
 * it never amends the annual AIP's rows — so each one is a document in its own
 * right, with its own status, its own council leg and its own printout. Merging
 * them would invent a combined programme that no office ever approved.
 *
 * The combined figure is shown once, at the end, because that is the number
 * people ask for after the supplementals start arriving.
 */
export function SubmissionSwitcher({
  submissions, currentAipId,
}: {
  submissions: AipTotals[]
  currentAipId: string
}) {
  if (submissions.length < 2) return null

  const combined = submissions.reduce((sum, s) => sum + Number(s.total_amount), 0)

  return (
    <nav aria-label="Submissions for this year"
         className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Submissions for this year</h2>
        <p className="text-sm text-muted-foreground">
          Combined:{' '}
          <span className="font-mono font-medium tabular-nums text-foreground">
            {moneyTotal(combined)}
          </span>
        </p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {submissions.map((submission) => {
          const isCurrent = submission.aip_id === currentAipId
          const label = submission.kind === 'supplemental'
            ? `Supplemental No. ${submission.supplemental_no}`
            : 'Annual'

          return (
            <li key={submission.aip_id}>
              <Link
                href={routes.aip(submission.aip_id) as never}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex min-w-48 flex-col gap-1 rounded-md border px-3 py-2 transition-colors',
                  isCurrent
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {label}
                  <Badge variant="outline" className="font-normal">
                    {AIP_STATUS_LABELS[submission.status]}
                  </Badge>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {moneyTotal(submission.total_amount)} · {submission.ppa_count}{' '}
                  item{submission.ppa_count === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
