// Shapes the AIP exporter consumes. These mirror the database views one-for-one
// (tracks.v_ppa_rows, tracks.v_aip_totals, tracks.v_sector_totals) so no number
// is ever recomputed in TypeScript on the way to the workbook.

/** One PPA row — column (1) through (15) of the official form. */
export interface PpaRow {
  id: string
  /** null on a heading — column (2) numbers the programme, not the page. */
  itemNo: number | null
  refCode: string | null
  description: string
  implementingOffice: string | null
  startDate: string | null // ISO date
  endDate: string | null
  expectedOutput: string | null
  fundingSource: string | null
  amountPs: number
  amountMooe: number
  amountFe: number
  amountCo: number
  amountTotal: number
  ccaAmount: number | null
  ccmAmount: number | null
  ccTypologyCode: string | null
  /** 'header' is a column-C caption: description only, printed bold across
   *  column 3 with no number and no money. */
  rowKind: 'ppa' | 'header'
}

export interface DepartmentBlock {
  departmentId: string
  code: string
  /** "City Mayor's Office (CMO)" — printed on the department band row. */
  displayName: string
  codeNumber: number | null
  rows: PpaRow[]
  totals: AmountSet
}

export interface SectorBlock {
  sectorId: string
  code: string
  /** "GENERAL PUBLIC SECTOR" — the band row inside the worksheet. */
  heading: string
  /** "PUBLIC SERVICES Sector" — the worksheet tab. */
  sheetName: string
  /** "GOVERNANCE SECTOR" — the group row on SUMMARY. */
  summaryLabel: string
  departments: DepartmentBlock[]
  totals: AmountSet
}

export interface AmountSet {
  ps: number
  mooe: number
  fe: number
  co: number
  total: number
}

export interface AipExportData {
  year: number
  /** "City" + "Bayugan" print as "City: Bayugan". */
  lguName: string
  lguType: string
  /** "1st DRAFT" — printed at O5. Omitted when null. */
  draftLabel: string | null
  /** SUMMARY's loose National Tax Allotment figure. Omitted when null. */
  ntaAmount: number | null
  sectors: SectorBlock[]
  grandTotals: AmountSet
  /**
   * A department-scoped export prints only that department and skips SUMMARY.
   * A 'fund' export is one statutory fund: every sector on ONE worksheet named
   * after the fund, no SUMMARY — SUMMARY is the AIP form's sector roll-up and
   * a 20% CDF roll-up is not that form.
   */
  scope: 'consolidated' | 'department' | 'fund'
  /** Set for a supplemental AIP: printed in the title block. */
  supplementalNo?: number | null
  /**
   * The statutory fund this document belongs to, when scope is 'fund'. Names
   * the single worksheet and replaces the title block's form name — the sheet
   * says "20% DEVELOPMENT FUND", not "ANNUAL INVESTMENT PROGRAM".
   */
  fund?: { sheetName: string; title: string } | null
}
