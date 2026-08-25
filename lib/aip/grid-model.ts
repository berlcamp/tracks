// Turns a flat list of PPA rows into the sequence of rows the grid renders:
// sector band, department band, column-C group rows, data rows, subtotals.
//
// Kept as a pure function, away from React, because this is the layout logic
// that has to agree with the exported workbook — and the only way to be sure of
// that is to test it.

import type { PpaRowView } from '@/types/tracks'

export interface AmountTotals {
  ps: number
  mooe: number
  fe: number
  co: number
  total: number
}

export type GridRow =
  | { kind: 'sector'; key: string; sectorId: string; heading: string }
  | { kind: 'department'; key: string; departmentId: string; displayName: string }
  | { kind: 'group'; key: string; depth: number; name: string }
  | { kind: 'ppa'; key: string; row: PpaRowView }
  | { kind: 'departmentTotal'; key: string; label: string; totals: AmountTotals; filtered: boolean }
  | { kind: 'sectorTotal'; key: string; label: string; totals: AmountTotals; filtered: boolean }

export interface BuildGridOptions {
  /** Show the sector band rows. A department AIP has only one sector, but the
   *  office still expects to see it named — it is on their printout. */
  showSectorBands?: boolean
  /** Show department band rows. Off for a single-department grid. */
  showDepartmentBands?: boolean
  /** True when a filter is active, so subtotal rows can say so. */
  filtered?: boolean
}

const EMPTY: AmountTotals = { ps: 0, mooe: 0, fe: 0, co: 0, total: 0 }

function add(a: AmountTotals, row: PpaRowView): AmountTotals {
  return {
    ps: a.ps + Number(row.amount_ps),
    mooe: a.mooe + Number(row.amount_mooe),
    fe: a.fe + Number(row.amount_fe),
    co: a.co + Number(row.amount_co),
    total: a.total + Number(row.amount_total),
  }
}

/**
 * Rows must already be in worksheet order (see sortWorksheet).
 *
 * Subtotals here are computed over the rows actually shown, so a filtered grid
 * adds up to what is on screen rather than silently displaying a total that
 * includes rows the user cannot see. `filtered` marks those rows so the UI can
 * say so out loud.
 */
export function buildGrid(rows: PpaRowView[], options: BuildGridOptions = {}): GridRow[] {
  const {
    showSectorBands = true,
    showDepartmentBands = true,
    filtered = false,
  } = options

  const out: GridRow[] = []
  let sectorId: string | null = null
  let departmentId: string | null = null
  let groupPath: string[] = []
  let sectorTotals = EMPTY
  let departmentTotals = EMPTY
  let sectorLabel = ''
  let departmentLabel = ''

  const flushDepartment = () => {
    if (departmentId === null) return
    out.push({
      kind: 'departmentTotal',
      key: `dt-${departmentId}-${out.length}`,
      label: `${departmentLabel} TOTAL`,
      totals: departmentTotals,
      filtered,
    })
    departmentTotals = EMPTY
  }

  const flushSector = () => {
    if (sectorId === null) return
    out.push({
      kind: 'sectorTotal',
      key: `st-${sectorId}-${out.length}`,
      label: `${sectorLabel} - TOTAL`,
      totals: sectorTotals,
      filtered,
    })
    sectorTotals = EMPTY
  }

  for (const row of rows) {
    if (row.sector_id !== sectorId) {
      flushDepartment()
      flushSector()
      departmentId = null
      groupPath = []
      sectorId = row.sector_id
      sectorLabel = row.sector_heading
      if (showSectorBands) {
        out.push({
          kind: 'sector', key: `s-${row.sector_id}`,
          sectorId: row.sector_id, heading: row.sector_heading,
        })
      }
    }

    if (row.department_id !== departmentId) {
      flushDepartment()
      groupPath = []
      departmentId = row.department_id
      departmentLabel = row.department_name
      if (showDepartmentBands) {
        out.push({
          kind: 'department', key: `d-${row.department_id}`,
          departmentId: row.department_id, displayName: row.department_name,
        })
      }
    }

    const path = row.group_path ?? []
    for (let depth = 0; depth < path.length; depth++) {
      if (groupPath[depth] === path[depth] && samePrefix(groupPath, path, depth)) continue
      out.push({
        kind: 'group',
        key: `g-${row.id}-${depth}`,
        depth: depth + 1,
        name: path[depth] ?? '',
      })
    }
    groupPath = path

    out.push({ kind: 'ppa', key: `p-${row.id}`, row })
    departmentTotals = add(departmentTotals, row)
    sectorTotals = add(sectorTotals, row)
  }

  flushDepartment()
  flushSector()
  return out
}

function samePrefix(a: string[], b: string[], depth: number): boolean {
  for (let i = 0; i < depth; i++) if (a[i] !== b[i]) return false
  return true
}

/** Free-text filter across the columns an officer actually searches. */
export function filterRows(rows: PpaRowView[], query: string): PpaRowView[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((row) =>
    [
      row.ref_code, row.description, row.implementing_office,
      row.expected_output, row.funding_source, ...(row.group_path ?? []),
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle)))
}
