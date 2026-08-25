'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { moneyTotal } from '@/lib/format'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'
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

  const grouped = useMemo(() => {
    const out: Array<{ kind: 'band'; key: string; label: string } | { kind: 'row'; key: string; row: MonitoringRow }> = []
    let sector: string | null = null
    let department: string | null = null
    for (const row of filtered) {
      if (row.sector_id !== sector) {
        sector = row.sector_id
        department = null
        out.push({ kind: 'band', key: `s-${row.sector_id}`, label: row.sector_heading })
      }
      if (row.department_id !== department) {
        department = row.department_id
        out.push({ kind: 'band', key: `d-${row.department_id}`, label: row.department_name })
      }
      out.push({ kind: 'row', key: row.ppa_id, row })
    }
    return out
  }, [filtered])

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
            {grouped.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center text-muted-foreground">
                  {rows.length === 0
                    ? 'Nothing to monitor yet — no accepted PPAs for this year.'
                    : 'No rows match this filter.'}
                </td>
              </tr>
            ) : null}

            {grouped.map((entry) =>
              entry.kind === 'band' ? (
                <tr key={entry.key}>
                  <td colSpan={10} className={cn(CELL, 'bg-muted/60 font-semibold')}>
                    {entry.label}
                  </td>
                </tr>
              ) : (
                <tr key={entry.key} className="hover:bg-muted/40">
                  <td className={cn(CELL, 'text-center tabular-nums')}>{entry.row.item_no}</td>
                  <td className={CELL}>
                    <span>{entry.row.description}</span>
                    {entry.row.ref_code ? (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {entry.row.ref_code}
                      </span>
                    ) : null}
                  </td>
                  <Money value={entry.row.approved_amount} />
                  <Money value={entry.row.allotted} />
                  <Money value={entry.row.obligated} />
                  <Money value={entry.row.disbursed} />
                  <Money value={entry.row.unobligated_balance} />
                  <td className={cn(CELL, 'text-right font-mono tabular-nums')}>
                    {entry.row.obligation_rate === null ? '—' : `${entry.row.obligation_rate}%`}
                  </td>
                  <td className={cn(CELL, 'text-right font-mono tabular-nums')}>
                    {entry.row.physical_percent === null ? '—' : `${entry.row.physical_percent}%`}
                  </td>
                  <td className={cn(CELL, 'whitespace-nowrap')}>
                    <Link href={routes.monitoringPpa(entry.row.ppa_id) as never}
                          className="text-sm underline underline-offset-4">
                      Ledger
                    </Link>
                  </td>
                </tr>
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
