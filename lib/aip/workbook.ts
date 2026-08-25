// Builds the official AIP workbook.
//
// The output is a reproduction of CY 2027 Annual Investment Program_Consolidated
// v3.xlsx: the same 3-row merged header, the same (1)-(15) column numbering, the
// same sector/department band rows, the same subtotal rows, the same column
// widths and the same accounting format.
//
// Two deliberate departures from the source, both confirmed:
//   * the AMOUNT caption reads "(In Pesos)", not "(In Thousand Pesos)" — the
//     source caption is wrong; its figures are already pesos.
//   * no cell contains a formula. Every total is the number the database
//     computed, so a workbook opened years later cannot silently recalculate
//     into #REF!, as the source SUMMARY sheet has already done in four places.

import ExcelJS from 'exceljs'
import type { AipExportData, AmountSet, DepartmentBlock, PpaRow, SectorBlock } from './types'
import {
  COLUMN_COUNT, COLUMN_WIDTHS, DEFAULT_COL_WIDTH, DEPARTMENT_TOTAL_FILL,
  MONEY_FORMAT, SECTOR_FILL, SUMMARY_SECTOR_FILL,
  font, formatSchedule, solidFill, thinBorder,
} from './style'

const COLS = 'ABCDEFGHIJKLMNOPQ'.split('')

/** Columns (8) through (12) — PS, MOOE, FE, CO, Total. */
const MONEY_COLS = [9, 10, 11, 12, 13] as const

export function buildAipWorkbook(data: AipExportData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TRACKS'
  wb.created = new Date(Date.UTC(data.year - 1, 0, 1))
  wb.modified = wb.created

  if (data.scope === 'consolidated') addSummarySheet(wb, data)
  for (const sector of data.sectors) addSectorSheet(wb, sector, data)
  return wb
}

// ---------------------------------------------------------------------------
// Sector worksheet
// ---------------------------------------------------------------------------

function addSectorSheet(wb: ExcelJS.Workbook, sector: SectorBlock, data: AipExportData) {
  const ws = wb.addWorksheet(sector.sheetName, {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.12, right: 0.12, top: 0.51, bottom: 0.51, header: 0.3, footer: 0.3 },
      printTitlesRow: '8:10',
    },
    properties: { defaultColWidth: DEFAULT_COL_WIDTH },
  })

  for (const [col, width] of Object.entries(COLUMN_WIDTHS)) {
    ws.getColumn(col).width = width
  }
  ws.getColumn('P').hidden = true

  writeFormHeader(ws, data)

  let row = 11
  row = writeSectorBand(ws, row, sector.heading)

  for (const dept of sector.departments) {
    row = writeDepartmentBand(ws, row, dept.displayName)
    row = writeDepartmentRows(ws, row, dept)
    row = writeTotalRow(ws, row, `${dept.displayName} TOTAL`, dept.totals, DEPARTMENT_TOTAL_FILL)
  }

  writeTotalRow(ws, row, `${sector.heading} - TOTAL`, sector.totals, SECTOR_FILL)
  // The grid is frozen below the numbered header so a 400-row sector still shows
  // which column is which.
  ws.views = [{ state: 'frozen', ySplit: 10 }]
}

/** Rows 1-10: the title block and the two-tier column header. */
function writeFormHeader(ws: ExcelJS.Worksheet, data: AipExportData) {
  const titleSuffix = data.supplementalNo
    ? `SUPPLEMENTAL ANNUAL INVESTMENT PROGRAM (AIP) NO. ${data.supplementalNo}`
    : 'ANNUAL INVESTMENT PROGRAM (AIP)'

  const titles: Array<[number, string]> = [
    [1, titleSuffix],
    [2, 'By Program/ Project/ Activity by Sector'],
    [3, `CY ${data.year}`],
  ]
  for (const [r, text] of titles) {
    ws.mergeCells(r, 1, r, COLUMN_COUNT)
    const cell = ws.getCell(r, 1)
    cell.value = text
    cell.font = font({ bold: true, size: 16 })
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    ws.getRow(r).height = 16.5
  }

  const location = ws.getCell(4, 1)
  location.value = `${data.lguType}: ${data.lguName}`
  location.font = font({ size: 10 })
  location.alignment = { vertical: 'middle' }
  ws.getRow(4).height = 16.5

  if (data.draftLabel) {
    const draft = ws.getCell(5, 15) // O5
    draft.value = data.draftLabel
    draft.font = font()
    draft.alignment = { horizontal: 'left', vertical: 'middle' }
  }
  ws.getRow(5).height = 16.5

  const note = ws.getCell(6, 1)
  note.value =
    'No Climate Change Expenditure (Please tick the box if your LGU does not have any climate change expenditure)'
  note.font = font({ size: 10 })
  ws.getRow(6).height = 16.5
  ws.getRow(7).height = 16.5

  // Row 8/9 — merged two-tier header.
  const merges: Array<[number, number, number, number]> = [
    [8, 1, 9, 1],   // A8:A9   AIP Ref. Code
    [8, 2, 9, 3],   // B8:C9   Program/Project/Activity Description
    [8, 4, 9, 4],   // D8:D9   Implementing Office
    [8, 5, 8, 6],   // E8:F8   Schedule of Implementation
    [8, 7, 9, 7],   // G8:G9   Expected Outputs
    [8, 8, 9, 8],   // H8:H9   Funding Source
    [8, 9, 8, 13],  // I8:M8   AMOUNT
    [8, 14, 8, 15], // N8:O8   AMOUNT of Climate Change expenditure
    [8, 16, 9, 16], // P8:P9   CC Typology Code
    [8, 17, 9, 17], // Q8:Q9   CC Typology Code (duplicated in the source form)
  ]
  for (const [r1, c1, r2, c2] of merges) ws.mergeCells(r1, c1, r2, c2)

  const h = (r: number, c: number, text: string) => {
    const cell = ws.getCell(r, c)
    cell.value = text
    cell.font = font({ bold: true })
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }

  h(8, 1, 'AIP Ref. Code')
  h(8, 2, 'Program/ Project/ Activity Description')
  h(8, 4, 'Implementing Office/ Department')
  h(8, 5, 'Schedule of Implementation')
  h(8, 7, 'Expected Outputs')
  h(8, 8, 'Funding Source')
  h(8, 9, 'AMOUNT\n(In Pesos)')
  h(8, 14, 'AMOUNT of Climate Change expenditure\n(In Pesos)')
  h(8, 16, 'CC Typology Code')
  h(8, 17, 'CC Typology Code')

  h(9, 5, 'Start Date')
  h(9, 6, 'Completion Date')
  h(9, 9, 'Personal Services (PS)')
  h(9, 10, 'Maintenance and Other Operating Expenses (MOOE)')
  h(9, 11, 'Financial Expenses\n(FE)')
  h(9, 12, 'Capital Outlay (CO)')
  h(9, 13, 'Total')
  h(9, 14, 'Climate Change Adaptation')
  h(9, 15, 'Climate Change Mitigation')

  ws.getRow(8).height = 32.25
  ws.getRow(9).height = 16.5

  // Row 10 — the form's column numbers. (2) sits in C because B and C are merged
  // above it, and (15) is repeated across P and Q, exactly as in the source.
  const numbers: Array<[number, string]> = [
    [1, '(1)'], [3, '(2)'], [4, '(3)'], [5, '(4)'], [6, '(5)'], [7, '(6)'],
    [8, '(7)'], [9, '(8)'], [10, '(9)'], [11, '(10)'], [12, '(11)'],
    [13, '(12)\n8+9+10+11'], [14, '(13)'], [15, '(14)'], [16, '(15)'], [17, '(15)'],
  ]
  for (const [c, text] of numbers) {
    const cell = ws.getCell(10, c)
    cell.value = text
    cell.font = font({ size: c === 13 ? 8 : 10 })
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }
  ws.getRow(10).height = 16.5

  for (let r = 8; r <= 10; r++) {
    for (let c = 1; c <= COLUMN_COUNT; c++) ws.getCell(r, c).border = thinBorder()
  }
}

function writeSectorBand(ws: ExcelJS.Worksheet, row: number, heading: string): number {
  for (let c = 1; c <= COLUMN_COUNT; c++) {
    const cell = ws.getCell(row, c)
    cell.fill = solidFill(SECTOR_FILL)
    cell.border = thinBorder()
    cell.font = font({ bold: true })
  }
  const label = ws.getCell(row, 2)
  label.value = heading
  label.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(row).height = 16.5
  return row + 1
}

function writeDepartmentBand(ws: ExcelJS.Worksheet, row: number, displayName: string): number {
  for (let c = 1; c <= COLUMN_COUNT; c++) ws.getCell(row, c).border = thinBorder()
  const label = ws.getCell(row, 2)
  label.value = displayName
  label.font = font({ bold: true })
  label.alignment = { vertical: 'middle' }
  ws.getRow(row).height = 16.5
  return row + 1
}

/**
 * Emits the group rows (column C) and the PPA rows beneath them. A group row is
 * written only when the ancestry actually changes, so a department whose rows all
 * sit under one heading gets one heading — which is what makes the printed sheet
 * match the workbook the office already knows.
 */
function writeDepartmentRows(ws: ExcelJS.Worksheet, startRow: number, dept: DepartmentBlock): number {
  let row = startRow
  let previous: string[] = []

  for (const ppa of dept.rows) {
    const path = ppa.groupPath
    for (let depth = 0; depth < path.length; depth++) {
      if (previous[depth] === path[depth] && samePrefix(previous, path, depth)) continue
      row = writeGroupRow(ws, row, path[depth] ?? '')
    }
    previous = path
    row = writePpaRow(ws, row, ppa)
  }
  return row
}

function samePrefix(a: string[], b: string[], depth: number): boolean {
  for (let i = 0; i < depth; i++) if (a[i] !== b[i]) return false
  return true
}

function writeGroupRow(ws: ExcelJS.Worksheet, row: number, name: string): number {
  for (let c = 1; c <= COLUMN_COUNT; c++) ws.getCell(row, c).border = thinBorder()
  const cell = ws.getCell(row, 3)
  cell.value = name
  cell.font = font({ bold: true })
  cell.alignment = { vertical: 'middle' }
  ws.getRow(row).height = 16.5
  return row + 1
}

function writePpaRow(ws: ExcelJS.Worksheet, row: number, ppa: PpaRow): number {
  const put = (col: number, value: string | number | null) => {
    const cell = ws.getCell(row, col)
    if (value !== null && value !== '') cell.value = value
    cell.font = font()
    cell.border = thinBorder()
    return cell
  }

  put(1, ppa.refCode).alignment = { vertical: 'middle', wrapText: true }
  put(2, ppa.itemNo).alignment = { horizontal: 'center', vertical: 'middle' }
  put(3, ppa.description).alignment = { vertical: 'middle', wrapText: true }
  put(4, ppa.implementingOffice).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  put(5, formatSchedule(ppa.startDate)).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  put(6, formatSchedule(ppa.endDate)).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  put(7, ppa.expectedOutput).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  put(8, ppa.fundingSource).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  // A zero component prints blank, as in the source: only the columns a PPA
  // actually charges are filled in.
  const amounts = [ppa.amountPs, ppa.amountMooe, ppa.amountFe, ppa.amountCo]
  amounts.forEach((amount, i) => {
    const cell = put(MONEY_COLS[i]!, amount === 0 ? null : amount)
    cell.numFmt = MONEY_FORMAT
    cell.alignment = { vertical: 'middle' }
  })
  const total = put(13, ppa.amountTotal)
  total.numFmt = MONEY_FORMAT
  total.alignment = { vertical: 'middle' }

  const cca = put(14, ppa.ccaAmount)
  cca.numFmt = MONEY_FORMAT
  const ccm = put(15, ppa.ccmAmount)
  ccm.numFmt = MONEY_FORMAT
  put(16, ppa.ccTypologyCode).alignment = { horizontal: 'center', vertical: 'middle' }
  put(17, null)

  return row + 1
}

/** Department and sector subtotal rows: label merged across A:H, money in I:M. */
function writeTotalRow(
  ws: ExcelJS.Worksheet, row: number, label: string, totals: AmountSet, fill: string,
): number {
  ws.mergeCells(row, 1, row, 8)
  const labelCell = ws.getCell(row, 1)
  labelCell.value = label
  labelCell.font = font({ bold: true })
  labelCell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }
  labelCell.fill = solidFill(fill)
  labelCell.border = thinBorder()
  for (let c = 2; c <= 8; c++) ws.getCell(row, c).border = thinBorder()

  const values = [totals.ps, totals.mooe, totals.fe, totals.co, totals.total]
  MONEY_COLS.forEach((col, i) => {
    const cell = ws.getCell(row, col)
    cell.value = values[i]!
    cell.numFmt = MONEY_FORMAT
    cell.font = font({ bold: true })
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = solidFill(fill)
    cell.border = thinBorder()
  })
  for (let c = 14; c <= COLUMN_COUNT; c++) {
    const cell = ws.getCell(row, c)
    cell.fill = solidFill(fill)
    cell.border = thinBorder()
  }
  ws.getRow(row).height = 16.5
  return row + 1
}

// ---------------------------------------------------------------------------
// SUMMARY worksheet
// ---------------------------------------------------------------------------

function addSummarySheet(wb: ExcelJS.Workbook, data: AipExportData) {
  const ws = wb.addWorksheet('SUMMARY', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const widths: Record<string, number> = {
    A: 4.29, B: 10.71, C: 25.29, D: 17.71, E: 19.71, F: 18.14, G: 18.29, H: 18.57,
  }
  for (const [col, width] of Object.entries(widths)) ws.getColumn(col).width = width

  ws.mergeCells('B2:H2')
  const title = ws.getCell('B2')
  title.value = 'SUMMARY OF ANNUAL INVESTMENT PROGRAM (AIP)'
  title.font = font({ bold: true, size: 14 })
  title.alignment = { horizontal: 'center' }

  ws.mergeCells('B3:H3')
  const year = ws.getCell('B3')
  year.value = `CY ${data.year}`
  year.font = font({ bold: true, size: 14 })
  year.alignment = { horizontal: 'center' }

  ws.mergeCells('B5:B6')
  ws.mergeCells('C5:C6')
  ws.mergeCells('D5:H5')
  const head = (ref: string, text: string) => {
    const cell = ws.getCell(ref)
    cell.value = text
    cell.font = font({ bold: true })
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = thinBorder()
  }
  head('B5', 'CODE NUMBER')
  head('C5', 'DEPARTMENT')
  head('D5', 'AMOUNT\n(In Pesos)')
  head('D6', 'Personal Services (PS)')
  head('E6', 'Maintenance and Other Operating Expenses (MOOE)')
  head('F6', 'Financial Expenses\n(FE)')
  head('G6', 'Capital Outlay (CO)')
  head('H6', 'Total')

  let row = 7
  for (const sector of data.sectors) {
    for (let c = 2; c <= 8; c++) {
      const cell = ws.getCell(row, c)
      cell.fill = solidFill(SUMMARY_SECTOR_FILL)
      cell.border = thinBorder()
      cell.font = font({ bold: true })
    }
    const label = ws.getCell(row, 3)
    label.value = sector.summaryLabel
    label.alignment = { horizontal: 'left', wrapText: true }
    row++

    for (const dept of sector.departments) {
      row = writeSummaryDepartmentRow(ws, row, dept)
    }
    row = writeSummaryTotalRow(ws, row, 'SUB-TOTAL', sector.totals, false)
  }

  row++
  row = writeSummaryTotalRow(ws, row, 'GRAND TOTAL', data.grandTotals, true)

  if (data.ntaAmount !== null) {
    row += 3
    const label = ws.getCell(row, 3)
    label.value = `${data.year} NTA`
    label.font = font()
    const value = ws.getCell(row, 4)
    value.value = data.ntaAmount
    value.numFmt = MONEY_FORMAT
    value.font = font()
  }
}

function writeSummaryDepartmentRow(ws: ExcelJS.Worksheet, row: number, dept: DepartmentBlock): number {
  const code = ws.getCell(row, 2)
  code.value = dept.codeNumber
  code.font = font()
  code.alignment = { horizontal: 'center', wrapText: true }
  code.border = thinBorder()

  const name = ws.getCell(row, 3)
  name.value = dept.code
  name.font = font()
  name.alignment = { horizontal: 'left', wrapText: true }
  name.border = thinBorder()

  const values = [dept.totals.ps, dept.totals.mooe, dept.totals.fe, dept.totals.co, dept.totals.total]
  values.forEach((value, i) => {
    const cell = ws.getCell(row, 4 + i)
    cell.value = value
    cell.numFmt = MONEY_FORMAT
    cell.font = font()
    cell.border = thinBorder()
  })
  return row + 1
}

function writeSummaryTotalRow(
  ws: ExcelJS.Worksheet, row: number, label: string, totals: AmountSet, emphasise: boolean,
): number {
  const cell = ws.getCell(row, 3)
  cell.value = label
  cell.font = font({ bold: emphasise, size: emphasise ? 13 : 12 })
  cell.alignment = { horizontal: 'right' }
  cell.border = thinBorder()
  ws.getCell(row, 2).border = thinBorder()
  if (emphasise) {
    for (let c = 2; c <= 8; c++) ws.getCell(row, c).fill = solidFill(SUMMARY_SECTOR_FILL)
  }

  const values = [totals.ps, totals.mooe, totals.fe, totals.co, totals.total]
  values.forEach((value, i) => {
    const money = ws.getCell(row, 4 + i)
    money.value = value
    money.numFmt = MONEY_FORMAT
    money.font = font({ bold: emphasise })
    money.border = thinBorder()
  })
  return row + 1
}

export { COLS }
