'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Filter, Pencil, Plus, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildGrid, filterRows } from '@/lib/aip/grid-model'
import { money, moneyTotal, schedule } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PpaRowView } from '@/types/tracks'

/**
 * The AIP grid.
 *
 * It is a plain table on purpose. The office reads this document in Excel every
 * year, so the layout is theirs: sector band, department band, the column-C
 * group rows, the numbered money columns, the subtotal rows. Editing is through
 * a modal — the cells themselves are never editable in place, which is what
 * keeps a mis-click from silently changing a figure in a submitted programme.
 */

export interface AipGridProps {
  rows: PpaRowView[]
  /** Which rows this viewer may open for editing. */
  canEdit: (row: PpaRowView) => boolean
  canAddRow: boolean
  canReturnItems: boolean
  showDepartmentBands?: boolean
  onEdit?: (row: PpaRowView) => void
  onAdd?: () => void
  onReturn?: (row: PpaRowView) => void
}

const HEAD = [
  { label: 'AIP Ref. Code', hint: '(1)', className: 'w-44' },
  { label: 'No.', hint: '(2)', className: 'w-12 text-center' },
  { label: 'Program / Project / Activity', hint: '(2)', className: 'min-w-72' },
  { label: 'Implementing Office', hint: '(3)', className: 'w-48' },
  { label: 'Start', hint: '(4)', className: 'w-28' },
  { label: 'Completion', hint: '(5)', className: 'w-28' },
  { label: 'Expected Output', hint: '(6)', className: 'min-w-64' },
  { label: 'Funding', hint: '(7)', className: 'w-28' },
  { label: 'PS', hint: '(8)', className: 'w-36 text-right' },
  { label: 'MOOE', hint: '(9)', className: 'w-36 text-right' },
  { label: 'FE', hint: '(10)', className: 'w-32 text-right' },
  { label: 'CO', hint: '(11)', className: 'w-36 text-right' },
  { label: 'Total', hint: '(12)', className: 'w-36 text-right' },
]

const CELL = 'border border-border/70 px-2 py-1.5 align-top'

export function AipGrid({
  rows, canEdit, canAddRow, canReturnItems,
  showDepartmentBands = true, onEdit, onAdd, onReturn,
}: AipGridProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => filterRows(rows, query), [rows, query])
  const grid = useMemo(
    () => buildGrid(filtered, { showDepartmentBands, filtered: query.trim().length > 0 }),
    [filtered, showDepartmentBands, query],
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by description, ref. code, funding source, group…"
            className="pl-8"
          />
        </div>
        {query ? (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {rows.length} rows
          </span>
        ) : null}
        <div className="ml-auto">
          {canAddRow ? (
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" /> Add row
            </Button>
          ) : null}
        </div>
      </div>

      {/* The table scrolls inside its own container; the page never scrolls
          sideways. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {HEAD.map((column) => (
                <th key={column.label}
                    className={cn(CELL, 'font-semibold whitespace-nowrap', column.className)}>
                  <span className="block">{column.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {column.hint}
                  </span>
                </th>
              ))}
              <th className={cn(CELL, 'w-24')} />
            </tr>
          </thead>
          <tbody>
            {grid.length === 0 ? (
              <tr>
                <td colSpan={HEAD.length + 1} className="px-4 py-16 text-center text-muted-foreground">
                  {rows.length === 0
                    ? 'No programs, projects or activities yet.'
                    : 'No rows match this filter.'}
                </td>
              </tr>
            ) : null}

            {grid.map((entry) => {
              switch (entry.kind) {
                case 'sector':
                  return (
                    <tr key={entry.key}>
                      <td colSpan={HEAD.length + 1}
                          className={cn(CELL, 'bg-[#76923c] font-semibold text-white')}>
                        {entry.heading}
                      </td>
                    </tr>
                  )
                case 'department':
                  return (
                    <tr key={entry.key}>
                      <td colSpan={HEAD.length + 1} className={cn(CELL, 'font-semibold')}>
                        {entry.displayName}
                      </td>
                    </tr>
                  )
                case 'group':
                  return (
                    <tr key={entry.key}>
                      <td colSpan={HEAD.length + 1}
                          className={cn(CELL, 'font-medium text-muted-foreground')}
                          style={{ paddingLeft: `${0.5 + (entry.depth - 1) * 1.25}rem` }}>
                        {entry.name}
                      </td>
                    </tr>
                  )
                case 'ppa': {
                  const row = entry.row
                  const editable = canEdit(row)
                  return (
                    <tr key={entry.key}
                        className={cn('hover:bg-muted/40', row.is_returned && 'bg-amber-500/10')}>
                      <td className={cn(CELL, 'whitespace-nowrap font-mono text-xs')}>{row.ref_code ?? ''}</td>
                      <td className={cn(CELL, 'text-center tabular-nums')}>{row.item_no}</td>
                      <td className={CELL}>
                        <div className="flex items-start gap-2">
                          <span>{row.description}</span>
                          {row.is_returned ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline"
                                       className="shrink-0 border-amber-500/50 text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="size-3" /> Returned
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {row.open_return_reason}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </td>
                      <td className={CELL}>{row.implementing_office ?? ''}</td>
                      <td className={cn(CELL, 'whitespace-nowrap')}>{schedule(row.start_date)}</td>
                      <td className={cn(CELL, 'whitespace-nowrap')}>{schedule(row.end_date)}</td>
                      <td className={cn(CELL, 'text-muted-foreground')}>{row.expected_output ?? ''}</td>
                      <td className={cn(CELL, 'text-center')}>{row.funding_source ?? ''}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{money(row.amount_ps)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{money(row.amount_mooe)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{money(row.amount_fe)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{money(row.amount_co)}</td>
                      <td className={cn(CELL, 'text-right font-mono font-medium tabular-nums')}>
                        {moneyTotal(row.amount_total)}
                      </td>
                      <td className={cn(CELL, 'whitespace-nowrap')}>
                        <div className="flex items-center gap-1">
                          {editable ? (
                            <Button size="icon" variant="ghost" className="size-7"
                                    aria-label={`Edit ${row.description}`}
                                    onClick={() => onEdit?.(row)}>
                              <Pencil className="size-3.5" />
                            </Button>
                          ) : null}
                          {canReturnItems && !row.is_returned ? (
                            <Button size="icon" variant="ghost" className="size-7"
                                    aria-label={`Return ${row.description}`}
                                    onClick={() => onReturn?.(row)}>
                              <Undo2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                }
                case 'departmentTotal':
                case 'sectorTotal': {
                  const isSector = entry.kind === 'sectorTotal'
                  return (
                    <tr key={entry.key}
                        className={cn(
                          'font-semibold',
                          isSector ? 'bg-[#76923c] text-white' : 'bg-[#d6e3bc] text-neutral-900',
                        )}>
                      <td colSpan={8} className={cn(CELL, 'text-right')}>
                        {entry.label}
                        {entry.filtered ? (
                          <span className="ml-2 font-normal opacity-80">(filtered rows only)</span>
                        ) : null}
                      </td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(entry.totals.ps)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(entry.totals.mooe)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(entry.totals.fe)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(entry.totals.co)}</td>
                      <td className={cn(CELL, 'text-right font-mono tabular-nums')}>{moneyTotal(entry.totals.total)}</td>
                      <td className={CELL} />
                    </tr>
                  )
                }
              }
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
