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
 * progress. What each role may WRITE is decided by the panel and enforced again
 * by RLS — a department sees the obligation figures and cannot add one.
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
      />
    </div>
  )
}
