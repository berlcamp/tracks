// Folds flat view rows into the nested shape the workbook builder consumes.
//
// Note what this file does NOT do: it never adds up a column of pesos. Every
// total comes from tracks.v_aip_totals / v_sector_totals / v_period_totals, so
// the printed workbook and the on-screen grid cannot disagree. If a total is
// missing from the input it is reported as zero rather than silently derived —
// a wrong number is worse than an obvious one.

import type { AipExportData, AmountSet, DepartmentBlock, PpaRow, SectorBlock } from './types'

/** A row of tracks.v_ppa_rows. */
export interface PpaRowSource extends PpaRow {
  sectorId: string
  sectorCode: string
  sectorHeading: string
  sectorSheetName: string
  sectorSummaryLabel: string
  sectorSort: number
  departmentId: string
  departmentCode: string
  departmentName: string
  departmentSort: number
  departmentCodeNumber: number | null
}

/** A row of tracks.v_aip_totals. */
export interface DepartmentTotalSource extends AmountSet {
  departmentId: string
}

/** A row of tracks.v_sector_totals. */
export interface SectorTotalSource extends AmountSet {
  sectorId: string
}

export interface AssembleInput {
  year: number
  lguName: string
  lguType: string
  draftLabel: string | null
  ntaAmount: number | null
  scope: 'consolidated' | 'department'
  supplementalNo?: number | null
  rows: PpaRowSource[]
  departmentTotals: DepartmentTotalSource[]
  sectorTotals: SectorTotalSource[]
  grandTotals: AmountSet
}

const ZERO: AmountSet = { ps: 0, mooe: 0, fe: 0, co: 0, total: 0 }

export function assembleExportData(input: AssembleInput): AipExportData {
  const deptTotals = new Map(input.departmentTotals.map((t) => [t.departmentId, t]))
  const secTotals = new Map(input.sectorTotals.map((t) => [t.sectorId, t]))

  // Group by sector, then by department, preserving the worksheet ordering the
  // database already applied.
  const sectors = new Map<string, SectorBlock>()
  const departments = new Map<string, DepartmentBlock>()
  const sectorSort = new Map<string, number>()
  const departmentSort = new Map<string, number>()

  for (const row of input.rows) {
    let sector = sectors.get(row.sectorId)
    if (!sector) {
      sector = {
        sectorId: row.sectorId,
        code: row.sectorCode,
        heading: row.sectorHeading,
        sheetName: row.sectorSheetName,
        summaryLabel: row.sectorSummaryLabel,
        departments: [],
        totals: secTotals.get(row.sectorId) ?? ZERO,
      }
      sectors.set(row.sectorId, sector)
      sectorSort.set(row.sectorId, row.sectorSort)
    }

    let department = departments.get(row.departmentId)
    if (!department) {
      department = {
        departmentId: row.departmentId,
        code: row.departmentCode,
        displayName: row.departmentName,
        codeNumber: row.departmentCodeNumber,
        rows: [],
        totals: deptTotals.get(row.departmentId) ?? ZERO,
      }
      departments.set(row.departmentId, department)
      departmentSort.set(row.departmentId, row.departmentSort)
      sector.departments.push(department)
    }

    department.rows.push(stripSource(row))
  }

  const ordered = [...sectors.values()].sort(
    (a, b) => (sectorSort.get(a.sectorId) ?? 0) - (sectorSort.get(b.sectorId) ?? 0),
  )
  for (const sector of ordered) {
    sector.departments.sort(
      (a, b) => (departmentSort.get(a.departmentId) ?? 0) - (departmentSort.get(b.departmentId) ?? 0),
    )
  }

  return {
    year: input.year,
    lguName: input.lguName,
    lguType: input.lguType,
    draftLabel: input.draftLabel,
    ntaAmount: input.ntaAmount,
    sectors: ordered,
    grandTotals: input.grandTotals,
    scope: input.scope,
    supplementalNo: input.supplementalNo ?? null,
  }
}

/**
 * Picks the worksheet columns off a view row. Written out rather than
 * destructured-and-discarded so that a new join column added to the view cannot
 * leak into the export by accident — it has to be named here to appear.
 */
function stripSource(row: PpaRowSource): PpaRow {
  return {
    id: row.id,
    itemNo: row.itemNo,
    refCode: row.refCode,
    description: row.description,
    implementingOffice: row.implementingOffice,
    startDate: row.startDate,
    endDate: row.endDate,
    expectedOutput: row.expectedOutput,
    fundingSource: row.fundingSource,
    amountPs: row.amountPs,
    amountMooe: row.amountMooe,
    amountFe: row.amountFe,
    amountCo: row.amountCo,
    amountTotal: row.amountTotal,
    ccaAmount: row.ccaAmount,
    ccmAmount: row.ccmAmount,
    ccTypologyCode: row.ccTypologyCode,
    groupPath: row.groupPath,
  }
}
