// Maps the database views onto the exporter's input shape.
//
// The mappers are transport-agnostic on purpose: the same functions serve the
// PostgREST client in the app and a raw `pg` connection in scripts, so there is
// exactly one place where a column name is spelled.

import type { AmountSet } from './types'
import type {
  AssembleInput, DepartmentTotalSource, PpaRowSource, SectorTotalSource,
} from './assemble'

/** snake_case row from tracks.v_ppa_rows. */
export interface VPpaRow {
  id: string
  item_no: number | string
  ref_code: string | null
  description: string
  implementing_office: string | null
  start_date: string | Date | null
  end_date: string | Date | null
  expected_output: string | null
  funding_source: string | null
  amount_ps: string | number
  amount_mooe: string | number
  amount_fe: string | number
  amount_co: string | number
  amount_total: string | number
  cca_amount: string | number | null
  ccm_amount: string | number | null
  cc_typology_code: string | null
  row_kind: 'ppa' | 'header'
  sort_order: string | number
  sector_id: string
  sector_code: string
  sector_heading: string
  sector_sheet_name: string
  sector_sort: number
  department_id: string
  department_code: string
  department_name: string
  department_sort: number
}

/** Postgres returns numeric as a string to preserve precision. */
function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' ? value : Number(value)
}

function optionalNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'number' ? value : Number(value)
}

function isoDate(value: string | Date | null): string | null {
  if (value === null) return null
  if (value instanceof Date) {
    // toISOString would shift the day for anyone east of UTC.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return value.slice(0, 10)
}

export function toPpaRowSource(
  row: VPpaRow,
  extras: { summaryLabel: string; codeNumber: number | null },
): PpaRowSource {
  return {
    id: row.id,
    itemNo: Number(row.item_no),
    refCode: row.ref_code,
    description: row.description,
    implementingOffice: row.implementing_office,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    expectedOutput: row.expected_output,
    fundingSource: row.funding_source,
    amountPs: num(row.amount_ps),
    amountMooe: num(row.amount_mooe),
    amountFe: num(row.amount_fe),
    amountCo: num(row.amount_co),
    amountTotal: num(row.amount_total),
    ccaAmount: optionalNum(row.cca_amount),
    ccmAmount: optionalNum(row.ccm_amount),
    ccTypologyCode: row.cc_typology_code,
    rowKind: row.row_kind,
    sectorId: row.sector_id,
    sectorCode: row.sector_code,
    sectorHeading: row.sector_heading,
    sectorSheetName: row.sector_sheet_name,
    sectorSummaryLabel: extras.summaryLabel,
    sectorSort: Number(row.sector_sort),
    departmentId: row.department_id,
    departmentCode: row.department_code,
    departmentName: row.department_name,
    departmentSort: Number(row.department_sort),
    departmentCodeNumber: extras.codeNumber,
  }
}

export function toAmountSet(row: {
  total_ps: string | number; total_mooe: string | number
  total_fe: string | number; total_co: string | number; total_amount: string | number
}): AmountSet {
  return {
    ps: num(row.total_ps),
    mooe: num(row.total_mooe),
    fe: num(row.total_fe),
    co: num(row.total_co),
    total: num(row.total_amount),
  }
}

export function toDepartmentTotal(row: Parameters<typeof toAmountSet>[0] & {
  department_id: string
}): DepartmentTotalSource {
  return { departmentId: row.department_id, ...toAmountSet(row) }
}

export function toSectorTotal(row: Parameters<typeof toAmountSet>[0] & {
  sector_id: string
}): SectorTotalSource {
  return { sectorId: row.sector_id, ...toAmountSet(row) }
}

export type { AssembleInput }
