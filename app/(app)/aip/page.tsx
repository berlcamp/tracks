import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { requireSession } from '@/lib/auth/session'
import { getCurrentPeriod, listAips } from '@/lib/data/aip'
import { AIP_STATUS_LABELS, isDepartmentUser } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { StartAipButton } from '@/components/aip/start-aip-button'
import { groupSubmissions, submissionLabel } from '@/lib/aip/submissions'
import { cn } from '@/lib/utils'

export default async function AipListPage() {
  const session = await requireSession()
  const period = await getCurrentPeriod()

  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The City Planning Office has not opened an investment programme year.
        </p>
      </div>
    )
  }

  const all = await listAips(period.id)
  const departmentScoped = isDepartmentUser(session.role) && session.department
  const rows = departmentScoped
    ? all.filter((a) => a.department_id === session.department!.id)
    : all

  const hasAnnual = rows.some((a) => a.kind === 'annual')
  // A department's supplementals sit under its annual AIP. They are separate
  // documents — a supplemental only adds PPAs — so they are listed, not merged.
  const grouped = groupSubmissions(rows)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {departmentScoped ? 'Our AIP' : 'Submissions'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CY {period.year}
            {departmentScoped ? ` · ${session.department!.display_name}` : ' · all departments'}
          </p>
        </div>

        {departmentScoped ? (
          <StartAipButton
            periodId={period.id}
            departmentId={session.department!.id}
            hasAnnual={hasAnnual}
          />
        ) : null}
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead>Submission</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">PS</TableHead>
              <TableHead className="text-right">MOOE</TableHead>
              <TableHead className="text-right">CO</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-14 text-center text-muted-foreground">
                  No submissions for CY {period.year} yet.
                </TableCell>
              </TableRow>
            ) : null}
            {grouped.flatMap((group) =>
              group.submissions.map((aip, index) => (
              <TableRow key={aip.aip_id}>
                <TableCell className={cn('font-medium', index > 0 && 'pl-8 text-muted-foreground')}>
                  {index === 0 ? aip.department_name : ''}
                </TableCell>
                <TableCell className={index > 0 ? 'text-muted-foreground' : undefined}>
                  {submissionLabel(aip)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{aip.ppa_count}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {moneyTotal(aip.total_ps)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {moneyTotal(aip.total_mooe)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {moneyTotal(aip.total_co)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {moneyTotal(aip.total_amount)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{AIP_STATUS_LABELS[aip.status]}</Badge>
                    {aip.open_returns > 0 ? (
                      <Badge variant="outline"
                             className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                        {aip.open_returns} returned
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={routes.aip(aip.aip_id) as never}>
                      Open <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
              )))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
