import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getPpaLedger } from '@/lib/data/execution'
import { PpaLedgerPanel } from '@/components/execution/ppa-ledger-panel'
import { routes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * One PPA's execution ledger, reachable by anyone provisioned.
 *
 * /budget is the Budget and Accounting workspace and is barred to departments;
 * this is the same ledger from the monitoring side, where an implementing office
 * can see what has been allotted against its project and report physical
 * progress.
 *
 * Money is read-only here whoever is looking, Budget included. An allotment, an
 * OBR or a DV is entered in one place — the workspace — so that the report is a
 * thing people read rather than a second door into the ledger. Progress is not
 * money and is reported from here, because the office doing the work is the
 * office that knows.
 */
export default async function MonitoringPpaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireSession()
  const supabase = await createClient()

  const { data: ppa } = await supabase
    .from('v_ppa_rows')
    .select('id, description, department_name, item_no, amount_total')
    .eq('id', id)
    .maybeSingle<{
      id: string
      description: string
      department_name: string
      item_no: number
      amount_total: number
    }>()

  // RLS returns nothing for a PPA this caller may not read, so a missing row is
  // genuinely "not found" from their point of view.
  if (!ppa) notFound()

  const ledger = await getPpaLedger(id)
  // Only offer the way to the workspace to someone the workspace will let in.
  const canWorkTheLedger = session.isSuperAdmin || (session.role !== null &&
    ['budget', 'accounting', 'planning_staff', 'planning_admin'].includes(session.role))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={routes.monitoring as never}>
            <ArrowLeft className="size-4" /> Back to monitoring
          </Link>
        </Button>
      </div>

      <PpaLedgerPanel
        ppaId={ppa.id}
        title={ppa.description}
        subtitle={`${ppa.department_name} · item ${ppa.item_no}`}
        approvedAmount={Number(ppa.amount_total)}
        ledger={ledger}
        role={session.role}
        isSuperAdmin={session.isSuperAdmin}
        canRecordMoney={false}
      />

      {canWorkTheLedger ? (
        <p className="text-sm text-muted-foreground">
          Allotments, obligations and disbursements are recorded in{' '}
          <Link href={routes.budgetPpa(ppa.id) as never}
                className="font-medium underline underline-offset-4">
            Budget &amp; Obligations
          </Link>
          .
        </p>
      ) : null}
    </div>
  )
}
