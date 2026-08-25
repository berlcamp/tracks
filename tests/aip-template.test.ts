// Asserts the generated workbook against the geometry of the real form.
//
// tests/fixtures/template-geometry.json was extracted from
// "CY 2027 Annual Investment Program_Consolidated v3.xlsx" — the file the City
// Planning Office actually prints. If someone changes a column width or drops a
// merge, this fails rather than shipping a workbook the office cannot use.

import { describe, expect, it, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import template from './fixtures/template-geometry.json'
import { buildAipWorkbook } from '@/lib/aip/workbook'
import { sampleExportData } from './helpers/sample-aip'

/** A..Q. R-U in the source are the office's scratch columns and are out of scope. */
const IN_SCOPE = /^[A-Q]$/

let sheet: ExcelJS.Worksheet
let summary: ExcelJS.Worksheet

beforeAll(async () => {
  const built = buildAipWorkbook(sampleExportData())
  const buffer = await built.xlsx.writeBuffer()
  const reloaded = new ExcelJS.Workbook()
  await reloaded.xlsx.load(buffer as ArrayBuffer)
  sheet = reloaded.getWorksheet('PUBLIC SERVICES Sector')!
  summary = reloaded.getWorksheet('SUMMARY')!
})

describe('sector worksheet matches the official form', () => {
  it('uses the template column widths', () => {
    for (const [col, width] of Object.entries(template.columnWidths)) {
      if (!IN_SCOPE.test(col)) continue
      expect(sheet.getColumn(col).width, `column ${col}`).toBeCloseTo(width, 2)
    }
  })

  it('hides column P, as the source does', () => {
    for (const col of template.hiddenColumns) {
      if (!IN_SCOPE.test(col)) continue
      expect(sheet.getColumn(col).hidden, `column ${col}`).toBe(true)
    }
  })

  it('reproduces every header merge', () => {
    const merges = new Set(sheet.model.merges ?? [])
    for (const range of template.headerMerges) expect(merges).toContain(range)
    for (const range of template.titleMerges) expect(merges).toContain(range)
  })

  it('reproduces the (1)-(15) column numbering, including the repeated (15)', () => {
    for (const [ref, text] of Object.entries(template.headerRow10)) {
      expect(normalise(sheet.getCell(ref).value), ref).toBe(text)
    }
  })

  it('reproduces the two-tier header text', () => {
    for (const [ref, text] of Object.entries(template.headerRow9)) {
      expect(normalise(sheet.getCell(ref).value), ref).toBe(text)
    }
    // Row 8 matches except for the corrected AMOUNT caption.
    for (const [ref, text] of Object.entries(template.headerRow8)) {
      const expected = text.replace(/\(In Thousand Pesos\)/, '(In Pesos)')
      expect(normalise(sheet.getCell(ref).value), ref).toBe(expected)
    }
  })

  it('corrects the "In Thousand Pesos" caption, which the source gets wrong', () => {
    expect(template.headerRow8.I8).toContain('In Thousand Pesos')
    expect(normalise(sheet.getCell('I8').value)).toBe('AMOUNT (In Pesos)')
  })

  it('uses the template accounting format on every money cell', () => {
    // The first PPA lands on row 14 in both workbooks: sector band, department
    // band, group row, then data.
    const first = findRowByPrefix(sheet, '1000-000-2-1-01-001-001-001')
    expect(first).toBe(14)
    // ExcelJS drops the redundant backslash escape in front of the literal
    // minus on write. Excel renders both identically, so the comparison ignores
    // escapes rather than pinning a quirk of one writer.
    for (const col of ['I', 'J', 'K', 'L', 'M']) {
      expect(unescape(sheet.getCell(`${col}${first}`).numFmt), col)
        .toBe(unescape(template.moneyNumberFormat))
    }
  })

  it('uses the template band colours', () => {
    expect(fillOf(sheet, 'B11')).toBe(template.fills.sectorBand)
    const deptTotal = findRowByPrefix(sheet, "City Mayor's Office (CMO) TOTAL")
    expect(fillOf(sheet, `A${deptTotal}`)).toBe(template.fills.departmentTotal)
    const sectorTotal = findRowByPrefix(sheet, 'GENERAL PUBLIC SECTOR - TOTAL')
    expect(fillOf(sheet, `A${sectorTotal}`)).toBe(template.fills.sectorTotal)
  })

  it('merges each subtotal label across A:H, as the source does', () => {
    const deptTotal = findRowByPrefix(sheet, "City Mayor's Office (CMO) TOTAL")
    expect(sheet.model.merges).toContain(`A${deptTotal}:H${deptTotal}`)
  })

  it('reproduces the title block and the climate-change note', () => {
    expect(normalise(sheet.getCell('A1').value)).toBe(template.titles.A1)
    expect(normalise(sheet.getCell('A2').value)).toBe(template.titles.A2)
    expect(normalise(sheet.getCell('A6').value)).toBe(template.titles.A6)
    expect(normalise(sheet.getCell('A4').value)).toBe('City: Bayugan')
  })

  it('keeps the header row heights', () => {
    for (const [row, height] of Object.entries(template.rowHeights)) {
      expect(sheet.getRow(Number(row)).height, `row ${row}`).toBeCloseTo(height, 2)
    }
  })
})

describe('SUMMARY worksheet matches the official form', () => {
  it('uses the template column widths', () => {
    for (const [col, width] of Object.entries(template.summary.columnWidths)) {
      expect(summary.getColumn(col).width, `column ${col}`).toBeCloseTo(width, 2)
    }
  })

  it('reproduces the header merges and labels', () => {
    const merges = new Set(summary.model.merges ?? [])
    for (const range of template.summary.merges) expect(merges).toContain(range)
    for (const [ref, text] of Object.entries(template.summary.headerRow6)) {
      expect(normalise(summary.getCell(ref).value), ref).toBe(text)
    }
    expect(normalise(summary.getCell('B5').value)).toBe('CODE NUMBER')
    expect(normalise(summary.getCell('C5').value)).toBe('DEPARTMENT')
  })

  it('uses the template sector fill', () => {
    expect(fillOf(summary, 'C7')).toBe(template.summary.sectorFill)
  })
})

function unescape(format: string | undefined): string {
  return (format ?? '').replace(/\\/g, '')
}

function normalise(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null
  return String(value).replace(/\s+/g, ' ').trim()
}

function fillOf(ws: ExcelJS.Worksheet, ref: string): string | undefined {
  const fill = ws.getCell(ref).fill
  return fill && fill.type === 'pattern' ? fill.fgColor?.argb : undefined
}

function findRowByPrefix(ws: ExcelJS.Worksheet, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (normalise(ws.getCell(r, 1).value) === text) return r
  }
  throw new Error(`row starting "${text}" not found`)
}
