import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { getCurrentPeriod } from '@/lib/data/aip'
import { getMonitoring, getPpaLedger } from '@/lib/data/execution'
import { PpaLedgerPanel } from '@/components/execution/ppa-ledger-panel'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ ppa?: string }>
}) {
  const session = await requireRole(['budget', 'accounting', 'planning_staff', 'planning_admin'])
  const { ppa: selectedId } = await searchParams
  const period = await getCurrentPeriod()

  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  const rows = await getMonitoring(period.id)
  const selected = selectedId ? rows.find((row) => row.ppa_id === selectedId) ?? null : null
  const ledger = selected ? await getPpaLedger(selected.ppa_id) : null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Budget &amp; Obligations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CY {period.year} · allotments and obligations are recorded by the Budget Office,
          disbursements by Accounting.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="flex max-h-[calc(100svh-16rem)] min-w-0 flex-col overflow-y-auto rounded-lg border border-border">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No PPAs to work against yet.
            </p>
          ) : null}
          {rows.map((row) => (
            <Link
              key={row.ppa_id}
              href={`${routes.budget}?ppa=${row.ppa_id}` as never}
              className={cn(
                'border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-muted/50',
                row.ppa_id === selectedId && 'bg-muted',
              )}
            >
              <p className="font-medium">{row.description}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.department_code} · item {row.item_no}
              </p>
              <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                {moneyTotal(row.allotted)} allotted · {moneyTotal(row.obligated)} obligated
              </p>
            </Link>
          ))}
        </div>

        <div className="min-w-0">
          {selected && ledger ? (
            <PpaLedgerPanel
              ppaId={selected.ppa_id}
              title={selected.description}
              subtitle={`${selected.department_name} · item ${selected.item_no}`}
              approvedAmount={Number(selected.approved_amount)}
              ledger={ledger}
              role={session.role}
              isSuperAdmin={session.isSuperAdmin}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
              <h2 className="text-lg font-medium">Pick a PPA</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Its allotments, obligations and disbursements appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
