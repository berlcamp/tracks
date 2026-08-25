import { requireSession } from '@/lib/auth/session'
import { getCurrentPeriod } from '@/lib/data/aip'
import { getMonitoring, summarise } from '@/lib/data/execution'
import { MonitoringReport } from '@/components/execution/monitoring-report'
import { moneyTotal } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The monitoring report.
 *
 * CONFIRMED: this is not a separate mandated form. It is the AIP's own layout
 * with the execution columns appended (Allotment / Obligated / Disbursed /
 * Unobligated / % / % Physical), so the office reads utilisation against the
 * same row order it approved the programme in.
 */
export default async function MonitoringPage() {
  const session = await requireSession()
  const period = await getCurrentPeriod()

  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  const all = await getMonitoring(period.id)
  const rows = session.department
    ? all.filter((row) => row.department_id === session.department!.id)
    : all
  const totals = summarise(rows)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CY {period.year} · physical and financial accomplishment
          {session.department ? ` · ${session.department.display_name}` : ' · all departments'}
        </p>
      </div>

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
