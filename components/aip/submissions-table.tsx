import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { AIP_STATUS_LABELS } from '@/lib/auth/permissions'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { submissionLabel } from '@/lib/aip/submissions'
import type { DepartmentSubmissions } from '@/lib/aip/submissions'
import type { AipTotals } from '@/types/tracks'
import { cn } from '@/lib/utils'

/**
 * One department per band, its submissions nested underneath.
 *
 * Shared by the annual programme's list and the statutory funds' list, because
 * they are the same document read the same way — what separates them is that
 * they are two tables and never one, not that either is laid out differently.
 */
export function SubmissionsTable<T extends AipTotals & { open_returns: number; ppa_count: number }>({
  groups, emptyMessage,
}: {
  groups: DepartmentSubmissions<T>[]
  emptyMessage: string
}) {
  return (
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
          {groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-14 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
          {groups.flatMap((group) =>
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
  )
}
