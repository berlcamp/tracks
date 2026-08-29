import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { requireRole } from '@/lib/auth/session'
import { getLandingPeriod } from '@/lib/data/aip'
import { getMonitoring, summarise } from '@/lib/data/execution'
import { BudgetWorklist } from '@/components/execution/budget-worklist'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * Budget and Accounting's workspace: the programme as a list of work.
 *
 * The report lives at /monitoring and answers "where are we"; this answers
 * "what is left to do", which is a different question and a different shape.
 * The ledger a row opens into is the one place money is entered.
 */
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ ppa?: string }>
}) {
  await requireRole(['budget', 'accounting', 'planning_staff', 'planning_admin'])
  const { ppa } = await searchParams
  // The ledger used to be the right-hand column of this page, selected with
  // ?ppa=. Old links still work.
  if (ppa) redirect(routes.budgetPpa(ppa) as never)

  // The demo year while demo mode is on, otherwise the latest programme.
  // /budget has no year picker, so without this the demo programme — the one
  // thing on the system with allotments, OBRs and disbursements already on it —
  // could not be reached from the screen that exists to work them. The year is
  // badged DEMO beside the heading, because this screen is also where real
  // money is recorded and a clerk has to see which programme they are in.
  const period = await getLandingPeriod()
  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  const rows = await getMonitoring(period.id)
  const totals = summarise(rows)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Budget &amp; Obligations</h1>
          {period.is_demo ? <Badge variant="outline">DEMO</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          CY {period.year} · allotments and obligations are recorded by the Budget Office,
          disbursements by Accounting.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Programmed" value={totals.approved}
                hint={`${rows.length} PPA${rows.length === 1 ? '' : 's'} in the programme`} />
        <Figure label="Allotted" value={totals.allotted}
                hint={gap(totals.approved, totals.allotted,
                          'not yet released', 'allotted beyond the programme')} />
        <Figure label="Obligated" value={totals.obligated}
                hint={gap(totals.allotted, totals.obligated,
                          'of the allotment unobligated', 'obligated beyond the allotment')} />
        <Figure label="Disbursed" value={totals.disbursed}
                hint={gap(totals.obligated, totals.disbursed,
                          'obligated and unpaid', 'disbursed beyond the obligations')} />
      </div>

      <BudgetWorklist rows={rows} />
    </div>
  )
}

/**
 * The distance between two of the figures, said in the direction it actually
 * runs. A negative "remaining" reads as an accounting error rather than the
 * overrun it is — and an OBR raised before the allotment landed is exactly the
 * thing the Budget Office wants named.
 */
function gap(from: number, to: number, under: string, over: string): string {
  const difference = from - to
  return difference < 0
    ? `${moneyTotal(Math.abs(difference))} ${over}`
    : `${moneyTotal(difference)} ${under}`
}

function Figure({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums"
         title={moneyTotal(value)}>
        {moneyTotal(value)}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
    </div>
  )
}
