import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getPpaLedger } from '@/lib/data/execution'
import { PpaLedgerPanel } from '@/components/execution/ppa-ledger-panel'
import { routes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * One PPA's ledger, in the workspace — the one place an allotment, an OBR or a
 * DV is entered. The same ledger is readable from monitoring, where the money
 * buttons are withheld: a report that also takes entries is a report people
 * edit by accident.
 */
export default async function BudgetPpaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireRole([
    'budget', 'accounting', 'planning_staff', 'planning_admin',
  ])
  const { id } = await params
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

  if (!ppa) notFound()

  const ledger = await getPpaLedger(id)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={routes.budget as never}>
            <ArrowLeft className="size-4" /> Back to the worklist
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
        canRecordMoney
      />
    </div>
  )
}
