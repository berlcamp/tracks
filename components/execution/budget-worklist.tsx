'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Filter } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { moneyTotal } from '@/lib/format'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import {
  STAGE_FILTERS, STAGE_LABELS, budgetStage, countByStage, type BudgetStage,
} from '@/lib/execution/worklist'
import type { MonitoringRow } from '@/lib/data/execution'

/**
 * The Budget Office's worklist: every PPA in the programme, and the one thing
 * outstanding on each.
 *
 * It is a list rather than a list-beside-a-ledger, because the two-column
 * layout meant reading eleven columns of figures through a third of the screen.
 * The ledger is a page of its own now; this one exists to find the row.
 */
export function BudgetWorklist({ rows }: { rows: MonitoringRow[] }) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<BudgetStage | null>(null)

  const counts = useMemo(() => countByStage(rows), [rows])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (stage && budgetStage(row) !== stage) return false
      if (!needle) return true
      return (
        row.description.toLowerCase().includes(needle) ||
        row.department_name.toLowerCase().includes(needle) ||
        row.department_code.toLowerCase().includes(needle) ||
        (row.fund_label ?? '').toLowerCase().includes(needle) ||
        (row.ref_code ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rows, query, stage])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by PPA, office, fund or ref. code…"
            className="pl-8"
            aria-label="Filter the worklist"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={stage === filter.value ? 'secondary' : 'ghost'}
              className={cn(stage !== filter.value && 'text-muted-foreground')}
              aria-pressed={stage === filter.value}
              onClick={() => setStage(stage === filter.value ? null : filter.value)}
            >
              {filter.label}
              <span className="tabular-nums">{counts[filter.value]}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Program / Project / Activity</TableHead>
              <TableHead className="text-right">Allotted</TableHead>
              <TableHead className="text-right">Obligated</TableHead>
              <TableHead className="text-right">Unpaid</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center text-muted-foreground">
                  {rows.length === 0
                    ? 'No PPAs to work against yet.'
                    : 'Nothing matches that filter.'}
                </TableCell>
              </TableRow>
            ) : null}

            {filtered.map((row) => {
              const outstanding = budgetStage(row)
              return (
                <TableRow key={row.ppa_id}>
                  {/* The programmed amount sits under the title rather than in
                      a column of its own: it is what the row is worth, not a
                      figure anybody scans down. The three that are scanned are
                      the ones the offices move. */}
                  <TableCell className="max-w-[26rem] py-3 align-top font-medium">
                    <span className="block truncate" title={row.description}>
                      <span className="text-muted-foreground tabular-nums">{row.item_no}. </span>
                      {row.description}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {row.department_code}
                      {row.fund_label ? ` · ${row.fund_label}` : ''} · programmed{' '}
                      <span className="font-mono tabular-nums">
                        {moneyTotal(row.approved_amount)}
                      </span>
                    </span>
                  </TableCell>
                  <Amount value={row.allotted} />
                  <Amount value={row.obligated} />
                  <Amount value={row.unpaid_obligations} />
                  <TableCell className="align-top">
                    <StageBadge stage={outstanding} />
                  </TableCell>
                  <TableCell className="align-top">
                    <Button asChild size="icon" variant="ghost">
                      <Link href={routes.budgetPpa(row.ppa_id) as never}>
                        <ArrowRight className="size-4" />
                        <span className="sr-only">
                          Open the ledger for {row.description}
                        </span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function Amount({ value }: { value: number | string }) {
  return (
    <TableCell className="text-right align-top font-mono text-sm tabular-nums">
      {Number(value) === 0
        ? <span className="text-muted-foreground">—</span>
        : moneyTotal(value)}
    </TableCell>
  )
}

/**
 * Colour carries the same thing the words do, never on its own: "settled" is
 * the only quiet state, and the rest read as work whether or not the reader
 * sees the difference between amber and slate.
 */
function StageBadge({ stage }: { stage: BudgetStage }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap font-normal',
        stage === 'unallotted' && 'border-slate-400/50',
        stage === 'unpaid' && 'border-amber-500/50 text-amber-700 dark:text-amber-400',
        stage === 'unobligated' && 'border-sky-500/50 text-sky-700 dark:text-sky-400',
        stage === 'settled' && 'text-muted-foreground',
      )}
    >
      {STAGE_LABELS[stage]}
    </Badge>
  )
}
