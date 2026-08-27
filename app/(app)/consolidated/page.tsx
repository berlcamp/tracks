import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth/session'
import { getConsolidated, getPeriods, resolvePeriod } from '@/lib/data/aip'
import {
  PERIOD_STATUS_LABELS, canFinalizePeriod, canSetPeriodStatus,
} from '@/lib/auth/permissions'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { ConsolidatedGrid } from '@/components/aip/consolidated-grid'
import { FinalizePanel } from '@/components/aip/finalize-panel'
import { PeriodPicker } from '@/components/aip/period-picker'
import { PeriodStatusControl } from '@/components/aip/period-status-control'
import { PaperTrail, type AipActionRow } from '@/components/aip/paper-trail'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { isPlanning } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ConsolidatedPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; kind?: string }>
}) {
  const session = await requireRole([
    'planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer',
  ])

  const { period: requestedPeriod, kind: requestedKind } = await searchParams
  // The supplementals are consolidated as their own document. They are never
  // folded into the annual programme — a supplemental only ADDS PPAs, and a
  // merged sheet would be a programme no office ever approved.
  const kind = requestedKind === 'supplemental' ? 'supplemental' as const : 'annual' as const

  const [period, periods] = await Promise.all([
    resolvePeriod(requestedPeriod), getPeriods(),
  ])
  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  const consolidated = await getConsolidated(period.id, kind)
  if (!consolidated) return null

  const supabase = await createClient()
  const { data: actions } = await supabase
    .from('aip_actions').select('*').eq('period_id', period.id)
    .order('action_date', { ascending: false })

  const mayFinalize = canFinalizePeriod(session.role, session.isSuperAdmin, period.status)
  // Where the printed folder is, moved from Settings: it is a fact about this
  // document, not reference data. The badge is for everyone who cannot move it.
  const maySetStatus = canSetPeriodStatus(session.role, session.isSuperAdmin)
  // What is still outstanding, counted from the rows themselves rather than
  // trusted from a status column — the same three questions the database asks
  // before it will let the programme go forward, over every submission in the
  // period because that is what finalize_aip_period() counts. Reading them off
  // the rows on screen would have the panel say "ready" over the annual
  // programme while the RPC refused over a supplemental nobody had read.
  const [{ data: submissions }, { data: reviewRows }] = await Promise.all([
    supabase.from('v_aip_totals').select('status, kind').eq('period_id', period.id),
    supabase.from('v_ppa_rows').select('planning_status')
      .eq('period_id', period.id).eq('row_kind', 'ppa'),
  ])
  const allSubmissions = (submissions ?? []) as { status: string; kind: string }[]
  const unsubmitted = allSubmissions
    .filter((s) => s.status === 'draft' || s.status === 'returned').length
  const hasSupplementals = allSubmissions.some((s) => s.kind === 'supplemental')
  const programme = (reviewRows ?? []) as { planning_status: string }[]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Consolidated AIP</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{period.title}</span>
            {maySetStatus
              ? null
              : <Badge variant="secondary">{PERIOD_STATUS_LABELS[period.status]}</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {periods.length > 1 ? (
            <PeriodPicker periods={periods} currentId={period.id} />
          ) : null}
          {maySetStatus ? (
            <PeriodStatusControl periodId={period.id} status={period.status} />
          ) : null}
          <Button asChild variant="outline">
            <a href={routes.consolidatedExport(period.id, kind)}>
              <Download className="size-4" /> Export to Excel
            </a>
          </Button>
        </div>
      </div>

      {hasSupplementals ? (
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border p-1">
          {(['annual', 'supplemental'] as const).map((option) => (
            <Button
              key={option}
              asChild
              size="sm"
              variant={option === kind ? 'secondary' : 'ghost'}
              className={cn(option !== kind && 'text-muted-foreground')}
            >
              <Link href={routes.consolidatedFor(period.id, option) as never}>
                {option === 'annual' ? 'Annual' : 'Supplementals'}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      {mayFinalize && kind === 'annual' ? (
        <FinalizePanel
          periodId={period.id}
          unsubmitted={unsubmitted}
          pending={programme.filter((row) => row.planning_status === 'pending').length}
          returned={programme.filter((row) => row.planning_status === 'returned').length}
        />
      ) : null}

      <PaperTrail
        periodId={period.id}
        actions={(actions ?? []) as AipActionRow[]}
        canRecord={isPlanning(session.role, session.isSuperAdmin)}
      />

      <ConsolidatedGrid rows={consolidated.rows} />
    </div>
  )
}
