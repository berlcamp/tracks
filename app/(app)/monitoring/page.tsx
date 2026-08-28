import Link from 'next/link'
import { requireSession } from '@/lib/auth/session'
import { getCurrentPeriod } from '@/lib/data/aip'
import { getMonitoring, summarise } from '@/lib/data/execution'
import { listFiledFunds } from '@/lib/data/statutory'
import { MonitoringReport } from '@/components/execution/monitoring-report'
import { Button } from '@/components/ui/button'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * The monitoring report.
 *
 * CONFIRMED: this is not a separate mandated form. It is the AIP's own layout
 * with the execution columns appended (Allotment / Obligated / Disbursed /
 * Unobligated / % / % Physical), so the office reads utilisation against the
 * same row order it approved the programme in.
 */
export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ fund?: string }>
}) {
  const session = await requireSession()
  const { fund: requestedFund } = await searchParams
  const period = await getCurrentPeriod()

  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  // One document at a time. The report is read as the programme it belongs to,
  // and mixing four funds into one list would undo the separation that makes
  // each of them a document in the first place. The Budget worklist is the
  // opposite case and stays unified.
  //
  // Only the funds this reader has a document for: a department sees the ones
  // its own office filed, not the four that exist. A tab that opens on an empty
  // report is worse than no tab.
  const funds = await listFiledFunds(period.id, session.department?.id ?? null)
  const fundId = funds.some((f) => f.fund_id === requestedFund) ? requestedFund! : null
  const fund = fundId ? funds.find((f) => f.fund_id === fundId)! : null

  const all = await getMonitoring(period.id, { fundId })
  const rows = session.department
    ? all.filter((row) => row.department_id === session.department!.id)
    : all
  const totals = summarise(rows)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CY {period.year} · {fund ? fund.fund_name : 'annual investment programme'} ·
          physical and financial accomplishment
          {session.department ? ` · ${session.department.display_name}` : ' · all departments'}
        </p>
      </div>

      {funds.length > 0 ? (
        <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border p-1">
          <DocumentTab href={routes.monitoring} label="Annual" active={!fundId} />
          {funds.map((f) => (
            <DocumentTab
              key={f.fund_id}
              href={`${routes.monitoring}?fund=${f.fund_id}`}
              label={f.fund_label}
              active={fundId === f.fund_id}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Programmed" value={totals.approved} />
        <Figure label="Allotted" value={totals.allotted} />
        <Figure label="Obligated" value={totals.obligated}
                rate={rate(totals.obligated, totals.allotted)} />
        <Figure label="Disbursed" value={totals.disbursed}
                rate={rate(totals.disbursed, totals.allotted)} />
      </div>

      <MonitoringReport rows={rows} />
    </div>
  )
}

/** One document of the year, in the switch above the report. */
function DocumentTab({ href, label, active }: {
  href: string; label: string; active: boolean
}) {
  return (
    <Button asChild size="sm" variant={active ? 'secondary' : 'ghost'}
            className={cn(!active && 'text-muted-foreground')}>
      <Link href={href as never}>{label}</Link>
    </Button>
  )
}

function rate(part: number, whole: number): string | null {
  if (whole <= 0) return null
  return `${((part / whole) * 100).toFixed(1)}% of allotment`
}

function Figure({ label, value, rate: hint }: {
  label: string; value: number; rate?: string | null
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums" title={moneyTotal(value)}>
        {moneyTotal(value)}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
