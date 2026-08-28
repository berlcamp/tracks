import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth/session'
import { StatutoryStanding } from '@/components/aip/statutory-standing'
import { getFundTotals } from '@/lib/data/statutory'
import { moneyTotal } from '@/lib/format'
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
import { PaperTrailButton, type AipActionRow } from '@/components/aip/paper-trail'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { isPlanning } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ConsolidatedPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; kind?: string; fund?: string }>
}) {
  const session = await requireRole([
    'planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer',
  ])

  const { period: requestedPeriod, kind: requestedKind, fund: requestedFund } =
    await searchParams
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

  // A statutory fund is a third document beside the annual programme and its
  // supplementals — never a slice of either. A fund id that no longer exists
  // falls back to the annual programme rather than an error page, the same way
  // a stale period does.
  const fundStandings = await getFundTotals(period.id)
  const fundId = fundStandings.some((f) => f.fund_id === requestedFund)
    ? requestedFund ?? null
    : null
  const standing = fundId
    ? fundStandings.find((f) => f.fund_id === fundId) ?? null
    : null

  const consolidated = await getConsolidated(period.id, { kind, fundId })
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
    supabase.from('v_aip_totals').select('status, kind, fund_id').eq('period_id', period.id),
    supabase.from('v_ppa_rows').select('planning_status, fund_id')
      .eq('period_id', period.id).eq('row_kind', 'ppa'),
  ])
  const allSubmissions =
    (submissions ?? []) as { status: string; kind: string; fund_id: string | null }[]
  // Counted over the annual programme alone, because that is now exactly what
  // finalize_aip_period() counts. A half-encoded 1% LCPC is not a reason to
  // hold the document the LDC votes on — but it is worth saying out loud, so
  // it is reported beneath as a warning rather than folded into these numbers.
  const annualSubmissions = allSubmissions.filter((s) => !s.fund_id)
  const unsubmitted = annualSubmissions
    .filter((s) => s.status === 'draft' || s.status === 'returned').length
  const hasSupplementals = annualSubmissions.some((s) => s.kind === 'supplemental')
  const unfiledStatutory = allSubmissions
    .filter((s) => s.fund_id && (s.status === 'draft' || s.status === 'returned')).length
  const programme = ((reviewRows ?? []) as
    { planning_status: string; fund_id: string | null }[]).filter((r) => !r.fund_id)

  // Only the funds actually filed against. "40m across 4 statutory funds" when
  // three of them are empty states a spread that does not exist.
  const filedFunds = fundStandings.filter((f) => f.document_count > 0)
  const statutoryTotal = filedFunds
    .reduce((sum, f) => sum + Number(f.programmed_amount), 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {standing ? standing.fund_name : 'Consolidated AIP'}
          </h1>
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
          {/* The paper trail is the annual programme's legs with the LDC, the
              Mayor and the City Council — recorded against the period, not
              against a document. Showing it under a fund would say the 20% CDF
              went to the LDC on its own, which it did not. */}
          {fundId ? null : (
            <PaperTrailButton
              periodId={period.id}
              actions={(actions ?? []) as AipActionRow[]}
              canRecord={isPlanning(session.role, session.isSuperAdmin)}
            />
          )}
          <Button asChild variant="outline">
            <a href={routes.consolidatedExport(period.id, kind, fundId)}>
              <Download className="size-4" /> Export to Excel
            </a>
          </Button>
        </div>
      </div>

      {/* One switch across every document of the year. The statutory funds sit
          beside the annual programme rather than under it: each is its own
          document with its own review, and none is in the AIP's grand total. */}
      {hasSupplementals || fundStandings.length > 0 ? (
        <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border p-1">
          <DocumentTab
            href={routes.consolidatedFor(period.id, 'annual')}
            label="Annual"
            active={!fundId && kind === 'annual'}
          />
          {hasSupplementals ? (
            <DocumentTab
              href={routes.consolidatedFor(period.id, 'supplemental')}
              label="Supplementals"
              active={!fundId && kind === 'supplemental'}
            />
          ) : null}
          {fundStandings.map((f) => (
            <DocumentTab
              key={f.fund_id}
              href={routes.consolidatedFor(period.id, 'annual', f.fund_id)}
              label={f.fund_label}
              active={fundId === f.fund_id}
            />
          ))}
        </div>
      ) : null}

      {standing ? (
        <StatutoryStanding standing={standing} canSetBase={maySetStatus} />
      ) : null}

      {/* Stated once, as a figure, beside the programme — never inside it. The
          AIP form's GRAND TOTAL is the annual programme and nothing else. */}
      {!fundId && kind === 'annual' && filedFunds.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Filed beside this programme: {moneyTotal(statutoryTotal)} across{' '}
          {filedFunds.length === 1 ? 'one statutory fund' : `${filedFunds.length} statutory funds`}.
          It is not part of the grand total above.
        </p>
      ) : null}

      {mayFinalize && kind === 'annual' && !fundId ? (
        <>
          <FinalizePanel
            periodId={period.id}
            unsubmitted={unsubmitted}
            pending={programme.filter((row) => row.planning_status === 'pending').length}
            returned={programme.filter((row) => row.planning_status === 'returned').length}
          />
          {unfiledStatutory > 0 ? (
            <p className="text-sm text-muted-foreground">
              {unfiledStatutory === 1
                ? 'One statutory document is still with its office.'
                : `${unfiledStatutory} statutory documents are still with their offices.`}{' '}
              Finalising the programme does not wait for them, and does not accept them.
            </p>
          ) : null}
        </>
      ) : null}

      <ConsolidatedGrid rows={consolidated.rows} />
    </div>
  )
}

/** One document of the year, in the switch above the grid. */
function DocumentTab({ href, label, active }: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Button
      asChild
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      className={cn(!active && 'text-muted-foreground')}
    >
      <Link href={href as never}>{label}</Link>
    </Button>
  )
}
