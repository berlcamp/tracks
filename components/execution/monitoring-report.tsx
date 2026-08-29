'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { moneyTotal } from '@/lib/format'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'
import { groupByDepartment, obligationRate } from '@/lib/execution/worklist'
import type { MonitoringRow } from '@/lib/data/execution'

/**
 * The AIP laid out as usual, with the execution columns appended. The office
 * reads utilisation against the same row order it approved the programme in, so
 * the sector and department bands stay.
 */
const CELL = 'border border-border/70 px-2 py-1.5 align-top'

export function MonitoringReport({ rows }: { rows: MonitoringRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [row.description, row.ref_code, row.department_name, row.implementing_office]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)))
  }, [rows, query])

  const isFiltered = query.trim() !== ''

  // The same banding the Budget worklist uses, so the two execution screens
  // agree on what an office's figures are. The sector band is this report's
  // own: it keeps the AIP's printed order, and a department belongs to exactly
  // one sector, so a sector opens where its first office does.
  const groups = useMemo(() => groupByDepartment(filtered), [filtered])

  const banded = useMemo(() => {
    const out: Array<
      | { kind: 'sector'; key: string; label: string }
      | { kind: 'department'; key: string; group: (typeof groups)[number] }
    > = []
    let sector: string | null = null
    for (const group of groups) {
      if (group.sector_id !== sector) {
        sector = group.sector_id
        out.push({ kind: 'sector', key: `s-${group.sector_id}`, label: group.sector_heading })
      }
      out.push({ kind: 'department', key: `d-${group.department_id}`, group })
    }
    return out
  }, [groups])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative max-w-sm">
        <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)}
               placeholder="Filter by PPA, department or office…" className="pl-8" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className={cn(CELL, 'w-12 text-center font-semibold')}>No.</th>
              <th className={cn(CELL, 'min-w-72 font-semibold')}>Program / Project / Activity</th>
              <th className={cn(CELL, 'w-36 text-right font-semibold')}>Programmed</th>
              <th className={cn(CELL, 'w-36 text-right font-semibold')}>Allotment</th>
              <th className={cn(CELL, 'w-36 text-right font-semibold')}>Obligated</th>
              <th className={cn(CELL, 'w-36 text-right font-semibold')}>Disbursed</th>
              <th className={cn(CELL, 'w-36 text-right font-semibold')}>Unobligated</th>
              <th className={cn(CELL, 'w-32 text-right font-semibold')}>Oblig. %</th>
              <th className={cn(CELL, 'w-32 text-right font-semibold')}>Physical %</th>
              <th className={cn(CELL, 'w-20')} />
            </tr>
          </thead>
          <tbody>
            {banded.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center text-muted-foreground">
                  {rows.length === 0
                    ? 'Nothing to monitor yet — no accepted PPAs for this year.'
                    : 'No rows match this filter.'}
                </td>
              </tr>
            ) : null}

            {banded.map((entry) =>
              entry.kind === 'sector' ? (
                <tr key={entry.key}>
                  <td colSpan={10} className={cn(CELL, 'bg-muted/60 font-semibold')}>
                    {entry.label}
                  </td>
                </tr>
              ) : (
                <Fragment key={entry.key}>
                  <tr>
                    <td colSpan={10} className={cn(CELL, 'bg-muted/60 font-semibold')}>
                      {entry.group.department_name}
                    </td>
                  </tr>

                  {entry.group.rows.map((row) => (
                    <tr key={row.ppa_id} className="hover:bg-muted/40">
                      <td className={cn(CELL, 'text-center tabular-nums')}>{row.item_no}</td>
                      <td className={CELL}>
                        <span>{row.description}</span>
                        {row.ref_code ? (
                          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                            {row.ref_code}
                          </span>
                        ) : null}
                      </td>
                      <Money value={row.approved_amount} />
                      <Money value={row.allotted} />
                      <Money value={row.obligated} />
                      <Money value={row.disbursed} />
                      <Money value={row.unobligated_balance} />
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>
                        {row.obligation_rate === null ? '—' : `${row.obligation_rate}%`}
                      </td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>
                        {row.physical_percent === null ? '—' : `${row.physical_percent}%`}
                      </td>
                      <td className={cn(CELL, 'whitespace-nowrap')}>
                        <Link href={routes.monitoringPpa(row.ppa_id) as never}
                              className="text-sm underline underline-offset-4">
                          Ledger
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {/* The office's own figures, over the rows on screen — the
                      subtotal the worklist prints, in this report's columns. A
                      filtered one says so, as the AIP grid's does.

                      Physical % is left blank rather than averaged: progress
                      that was never reported is its own state and is not 0%,
                      and a weighted average that quietly counted it as one
                      would flatter every office that reports nothing. */}
                  <tr className="bg-muted/30 font-medium">
                    <td className={CELL} />
                    <td className={cn(CELL, 'text-right')}>
                      Subtotal · {entry.group.department_code}
                      {isFiltered ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (filtered rows only)
                        </span>
                      ) : null}
                    </td>
                    <Money value={entry.group.totals.approved} />
                    <Money value={entry.group.totals.allotted} />
                    <Money value={entry.group.totals.obligated} />
                    <Money value={entry.group.totals.disbursed} />
                    <Money value={entry.group.totals.unobligated} />
                    <td className={cn(CELL, 'text-right font-mono tabular-nums')}>
                      {obligationRate(entry.group.totals) ?? '—'}
                    </td>
                    <td className={CELL} />
                    <td className={CELL} />
                  </tr>
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Money({ value }: { value: number }) {
  return (
    <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(value)}</td>
  )
}
