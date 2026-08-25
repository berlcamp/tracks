import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth/session'
import { getConsolidated, getCurrentPeriod } from '@/lib/data/aip'
import { PERIOD_STATUS_LABELS } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { ConsolidatedGrid } from '@/components/aip/consolidated-grid'
import { PaperTrail, type AipActionRow } from '@/components/aip/paper-trail'
import { createClient } from '@/lib/supabase/server'
import { isPlanning } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ConsolidatedPage() {
  const session = await requireRole([
    'planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer',
  ])

  const period = await getCurrentPeriod()
  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
      </div>
    )
  }

  const consolidated = await getConsolidated(period.id)
  if (!consolidated) return null

  const supabase = await createClient()
  const { data: actions } = await supabase
    .from('aip_actions').select('*').eq('period_id', period.id)
    .order('action_date', { ascending: false })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Consolidated AIP</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{period.title}</span>
            <Badge variant="secondary">{PERIOD_STATUS_LABELS[period.status]}</Badge>
            {period.draft_label ? <Badge variant="outline">{period.draft_label}</Badge> : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Grand total</p>
            <p className="font-mono text-lg font-semibold tabular-nums">
              {moneyTotal(consolidated.periodTotals?.total_amount ?? 0)}
            </p>
          </div>
          <Button asChild variant="outline">
            <a href={routes.consolidatedExport(period.id)}>
              <Download className="size-4" /> Export to Excel
            </a>
          </Button>
        </div>
      </div>

      <PaperTrail
        periodId={period.id}
        actions={(actions ?? []) as AipActionRow[]}
        canRecord={isPlanning(session.role, session.isSuperAdmin)}
      />

      <ConsolidatedGrid rows={consolidated.rows} />
    </div>
  )
}
