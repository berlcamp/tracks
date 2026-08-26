'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpToLine, Check, CheckCircle2, ChevronDown,
  CircleDashed, Filter, Pencil, Plus, Trash2, Undo2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildGrid, filterRows } from '@/lib/aip/grid-model'
import { REVIEW_STATUS_LABELS } from '@/lib/auth/permissions'
import { money, moneyTotal, schedule } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PpaRowView, ReviewDecision } from '@/types/tracks'

/**
 * The AIP grid.
 *
 * It is a plain table on purpose. The office reads this document in Excel every
 * year, so the layout is theirs: sector band, department band, the column-C
 * heading rows, the numbered money columns, the subtotal rows. Editing is
 * through a modal — the cells themselves are never editable in place, which is
 * what keeps a mis-click from silently changing a figure in a submitted
 * programme.
 *
 * Rows are added the way a spreadsheet adds them: from a menu on the row you
 * are looking at, above it or below it. The menu lives in a leading column
 * outside the printed (1)–(15) numbering, because every printed column is
 * asserted against the real workbook by tests/aip-template.test.ts.
 */

export type RowPlacement = 'above' | 'below' | 'end'

export interface AipGridProps {
  rows: PpaRowView[]
  /** Which rows this viewer may open for editing. */
  canEdit: (row: PpaRowView) => boolean
  /** Mirrors tracks.can_modify_aip_structure: may rows be added or removed. */
  canAddRow: boolean
  /** Mirrors tracks.review_ppa(): may this viewer decide on rows right now. */
  canReview?: boolean
  /** Show column (0), the reading each row has had. Off for the printout view. */
  showReviewColumn?: boolean
  showDepartmentBands?: boolean
  onAdd?: (anchor: PpaRowView | null, placement: RowPlacement) => void
  onEdit?: (row: PpaRowView) => void
  onDelete?: (row: PpaRowView) => void
  onReview?: (row: PpaRowView, decision: ReviewDecision) => void
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
  rows, canEdit, canAddRow, canReview = false,
  showReviewColumn = false,
  showDepartmentBands = true, onAdd, onEdit, onDelete, onReview,
}: AipGridProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => filterRows(rows, query), [rows, query])
  const grid = useMemo(
    () => buildGrid(filtered, { showDepartmentBands, filtered: query.trim().length > 0 }),
    [filtered, showDepartmentBands, query],
  )

  // The menu column earns its place only if this viewer can do something. On a
  // returned AIP that is true for the returned rows alone, which is why canEdit
  // is consulted rather than canAddRow on its own.
  const interactive = useMemo(
    () => canAddRow || canReview || filtered.some(canEdit),
    [canAddRow, canReview, filtered, canEdit],
  )
  const columnCount =
    HEAD.length + (interactive ? 1 : 0) + (showReviewColumn ? 1 : 0)

  const menuCell = (row: PpaRowView) => {
    if (!interactive) return null
    return (
      <td className={cn(CELL, 'w-10 px-1')}>
        <RowMenu
          row={row}
          canEditRow={canEdit(row)}
          canModifyStructure={canAddRow}
          canReview={canReview && row.row_kind === 'ppa'}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          onReview={onReview}
        />
      </td>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by description, ref. code, funding source…"
            className="pl-8"
          />
        </div>
        {query ? (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {rows.length} rows
          </span>
        ) : null}
      </div>

      {/* The table scrolls inside its own container; the page never scrolls
          sideways. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {interactive ? <th className={cn(CELL, 'w-10')}><span className="sr-only">Row actions</span></th> : null}
              {showReviewColumn ? (
                <th className={cn(CELL, 'w-28 font-semibold whitespace-nowrap')}>
                  <span className="block">Review</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    not printed
                  </span>
                </th>
              ) : null}
              {HEAD.map((column) => (
                <th key={column.label}
                    className={cn(CELL, 'font-semibold whitespace-nowrap', column.className)}>
                  <span className="block">{column.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {column.hint}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-16 text-center text-muted-foreground">
                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <p>No programs, projects or activities yet.</p>
                      {canAddRow ? (
                        <Button size="sm" onClick={() => onAdd?.(null, 'end')}>
                          <Plus className="size-4" /> Add the first row
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    'No rows match this filter.'
                  )}
                </td>
              </tr>
            ) : null}

            {grid.map((entry) => {
              switch (entry.kind) {
                case 'sector':
                  return (
                    <tr key={entry.key}>
                      <td colSpan={columnCount}
                          className={cn(CELL, 'bg-[#76923c] font-semibold text-white')}>
                        {entry.heading}
                      </td>
                    </tr>
                  )
                case 'department':
                  return (
                    <tr key={entry.key}>
                      <td colSpan={columnCount} className={cn(CELL, 'font-semibold')}>
                        {entry.displayName}
                      </td>
                    </tr>
                  )
                case 'group':
                  return (
                    <tr key={entry.key} className="hover:bg-muted/40">
                      {menuCell(entry.row)}
                      {showReviewColumn ? <td className={cn(CELL, 'w-28')} /> : null}
                      <td colSpan={HEAD.length}
                          className={cn(CELL, 'font-semibold')}>
                        {entry.name}
                      </td>
                    </tr>
                  )
                case 'ppa': {
                  const row = entry.row
                  return (
                    <tr key={entry.key}
                        className={cn('hover:bg-muted/40', row.is_returned && 'bg-amber-500/10')}>
                      {menuCell(row)}
                      {showReviewColumn ? (
                        <td className={cn(CELL, 'w-28')}><ReviewBadge row={row} /></td>
                      ) : null}
                      <td className={cn(CELL, 'whitespace-nowrap font-mono text-xs')}>{row.ref_code ?? ''}</td>
                      <td className={cn(CELL, 'text-center tabular-nums')}>{row.item_no ?? ''}</td>
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
                      {interactive ? <td className={cn(CELL, 'w-10')} /> : null}
                      {showReviewColumn ? <td className={cn(CELL, 'w-28')} /> : null}
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

/**
 * What a viewer may do to one row. The contents are computed per row rather
 * than per screen: on a returned AIP only the returned items open, and nothing
 * may be added or removed, which is what can_modify_aip_structure enforces in
 * the database.
 */
function RowMenu({
  row, canEditRow, canModifyStructure, canReview,
  onAdd, onEdit, onDelete, onReview,
}: {
  row: PpaRowView
  canEditRow: boolean
  canModifyStructure: boolean
  canReview: boolean
  onAdd?: (anchor: PpaRowView | null, placement: RowPlacement) => void
  onEdit?: (row: PpaRowView) => void
  onDelete?: (row: PpaRowView) => void
  onReview?: (row: PpaRowView, decision: ReviewDecision) => void
}) {
  const label = row.row_kind === 'header' ? row.description : `item ${row.item_no}`
  if (!canEditRow && !canModifyStructure && !canReview) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7"
                aria-label={`Actions for ${label}`}>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {canReview ? (
          <>
            <DropdownMenuItem onSelect={() => onReview?.(row, 'approved')}>
              <Check className="size-4" />
              {row.review_status === 'approved' ? 'Approve again' : 'Approve'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onReview?.(row, 'returned')}>
              <Undo2 className="size-4" /> Return for revision
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {canModifyStructure ? (
          <>
            <DropdownMenuItem onSelect={() => onAdd?.(row, 'above')}>
              <ArrowUpToLine className="size-4" /> Add row above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd?.(row, 'below')}>
              <ArrowDownToLine className="size-4" /> Add row below
            </DropdownMenuItem>
          </>
        ) : null}

        {canEditRow ? (
          <>
            {canModifyStructure ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => onEdit?.(row)}>
              <Pencil className="size-4" /> Edit row
            </DropdownMenuItem>
          </>
        ) : null}

        {canModifyStructure ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(row)}>
              <Trash2 className="size-4" /> Delete row
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * What has happened to this row, in the column the office reads down before
 * anything else. It is deliberately not one of the numbered columns: nothing
 * here is printed on the AIP form.
 */
function ReviewBadge({ row }: { row: PpaRowView }) {
  const status = row.review_status ?? 'pending'
  const label = REVIEW_STATUS_LABELS[status]

  if (status === 'approved') {
    return (
      <Badge variant="outline"
             className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" /> Approved
      </Badge>
    )
  }
  if (status === 'returned') {
    const badge = (
      <Badge variant="outline"
             className="border-amber-500/50 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-3" /> For revision
      </Badge>
    )
    return row.review_remarks ? (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{row.review_remarks}</TooltipContent>
      </Tooltip>
    ) : badge
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleDashed className="size-3" /> {label}
    </span>
  )
}
