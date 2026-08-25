import Link from 'next/link'
import { ArrowRight, FileSpreadsheet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSession } from '@/lib/auth/session'
import { getCurrentPeriod, listAips } from '@/lib/data/aip'
import { AIP_STATUS_LABELS, PERIOD_STATUS_LABELS, isDepartmentUser, isPlanning } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

export default async function DashboardPage() {
  const session = await requireSession()
  const period = await getCurrentPeriod()

  if (!period) {
    return (
      <EmptyState
        title="No AIP period yet"
        body="The City Planning Office has not opened an investment programme year."
      />
    )
  }

  const aips = await listAips(period.id)
  const mine = session.department
    ? aips.filter((a) => a.department_id === session.department!.id)
    : []
  const grandTotal = aips
    .filter((a) => a.kind === 'annual')
    .reduce((sum, a) => sum + Number(a.total_amount), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{period.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {session.profile.full_name.split(' ')[0]}.
          </p>
        </div>
        <Badge variant="secondary">{PERIOD_STATUS_LABELS[period.status]}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Submissions" value={String(aips.filter((a) => a.kind === 'annual').length)}
              hint="departments with an annual AIP" />
        <Stat label="Accepted" value={String(aips.filter((a) => a.status === 'accepted').length)}
              hint="taken into the consolidation" />
        <Stat label="Items returned"
              value={String(aips.reduce((n, a) => n + a.open_returns, 0))}
              hint="awaiting correction" />
        <Stat label="Programmed" value={moneyTotal(grandTotal)} hint="annual AIP, all sectors" mono />
      </div>

      {isDepartmentUser(session.role) ? (
        <Card>
          <CardHeader>
            <CardTitle>Your office</CardTitle>
            <CardDescription>
              {session.department?.display_name ?? 'No department assigned'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No AIP started for CY {period.year} yet.
              </p>
            ) : (
              mine.map((aip) => (
                <div key={aip.aip_id}
                     className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                  <div>
                    <p className="font-medium">
                      {aip.kind === 'supplemental'
                        ? `Supplemental AIP No. ${aip.supplemental_no}`
                        : 'Annual Investment Program'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {aip.ppa_count} item{aip.ppa_count === 1 ? '' : 's'} ·{' '}
                      <span className="font-mono">{moneyTotal(aip.total_amount)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{AIP_STATUS_LABELS[aip.status]}</Badge>
                    <Button asChild size="sm" variant="outline">
                      <Link href={routes.aip(aip.aip_id) as never}>
                        Open <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {isPlanning(session.role, session.isSuperAdmin) ? (
        <Card>
          <CardHeader>
            <CardTitle>Consolidation</CardTitle>
            <CardDescription>
              Every department&apos;s submission for CY {period.year}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={routes.aips as never}>Review submissions</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={routes.consolidated as never}>
                <FileSpreadsheet className="size-4" /> Consolidated AIP
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Stat({ label, value, hint, mono }: {
  label: string; value: string; hint: string; mono?: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          title={value}
          className={cn(
            'truncate',
            mono ? 'font-mono text-xl tabular-nums' : 'text-2xl',
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
