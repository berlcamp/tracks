// Layout behaviour of the exporter — the things that make the printed sheet
// match the workbook the office already uses.

import { describe, expect, it, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { buildAipWorkbook } from '@/lib/aip/workbook'
import { sampleExportData, amounts } from './helpers/sample-aip'
import type { AipExportData } from '@/lib/aip/types'

async function render(data: AipExportData): Promise<ExcelJS.Workbook> {
  const buffer = await buildAipWorkbook(data).xlsx.writeBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)
  return wb
}

function columnValues(ws: ExcelJS.Worksheet, col: number): Array<string | null> {
  const out: Array<string | null> = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getCell(r, col).value
    out.push(v === null || v === undefined ? null : String(v))
  }
  return out
}

let wb: ExcelJS.Workbook
let sheet: ExcelJS.Worksheet

beforeAll(async () => {
  wb = await render(sampleExportData())
  sheet = wb.getWorksheet('PUBLIC SERVICES Sector')!
})

describe('worksheet layout', () => {
  it('creates one worksheet per sector, plus SUMMARY', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'SUMMARY', 'PUBLIC SERVICES Sector', 'SOCIAL SERVICES Sector',
    ])
  })

  it('lays out sector band, department band, group rows and data in form order', () => {
    expect(colB(sheet, 11)).toBe('GENERAL PUBLIC SECTOR')
    expect(colB(sheet, 12)).toBe("City Mayor's Office (CMO)")
    expect(colC(sheet, 13)).toBe('General and Administrative Operation')
    expect(colC(sheet, 14)).toBe('Administrative Cost for Salaries, Wages, and Benefits')
  })

  it('writes a group row only when the column-C ancestry actually changes', () => {
    // Rows 1 and 2 share one heading; rows 3 and 4 share level 1 but differ at
    // level 2, so level 1 is written once and levels 2-3 twice.
    const groups = columnValues(sheet, 3).filter((v): v is string =>
      v === 'General and Administrative Operation' ||
      v === 'SUPPORT TO NATIONAL AGENCIES' ||
      v === 'Department of Interior and Local Government' ||
      v === 'Commission on Election')
    expect(groups).toEqual([
      'General and Administrative Operation',
      'SUPPORT TO NATIONAL AGENCIES',
      'Department of Interior and Local Government',
      'General and Administrative Operation',
      'Commission on Election',
      'General and Administrative Operation',
      'General and Administrative Operation', // CPDSO's own heading
    ])
  })

  it('prints the running item number in column (2)', () => {
    const first = findRow(sheet, '1000-000-2-1-01-001-001-001')
    expect(sheet.getCell(first, 2).value).toBe(1)
    expect(sheet.getCell(first + 1, 2).value).toBe(2)
  })

  it('leaves an unused expense class blank rather than printing zero', () => {
    const first = findRow(sheet, '1000-000-2-1-01-001-001-001')
    expect(sheet.getCell(first, 9).value).toBe(86222053)   // PS
    expect(sheet.getCell(first, 10).value).toBeNull()      // MOOE
    expect(sheet.getCell(first, 11).value).toBeNull()      // FE
    expect(sheet.getCell(first, 12).value).toBeNull()      // CO
    expect(sheet.getCell(first, 13).value).toBe(86222053)  // Total is always printed
  })

  it('writes schedules as "January 2027", not a locale-dependent date', () => {
    const first = findRow(sheet, '1000-000-2-1-01-001-001-001')
    expect(sheet.getCell(first, 5).value).toBe('January 2027')
    expect(sheet.getCell(first, 6).value).toBe('December 2027')
  })

  it('closes each department with a subtotal and each sector with a total', () => {
    const deptTotal = findRow(sheet, "City Mayor's Office (CMO) TOTAL")
    expect(sheet.getCell(deptTotal, 9).value).toBe(86222053)
    expect(sheet.getCell(deptTotal, 13).value).toBe(96022053)

    const sectorTotal = findRow(sheet, 'GENERAL PUBLIC SECTOR - TOTAL')
    expect(sheet.getCell(sectorTotal, 13).value).toBe(109255718)
    expect(sectorTotal).toBeGreaterThan(deptTotal)
  })

  it('places the sector total after the LAST department, not after the first', () => {
    const cpdso = findRow(sheet, 'City Planning and Development Services Office (CPDSO) TOTAL')
    const sectorTotal = findRow(sheet, 'GENERAL PUBLIC SECTOR - TOTAL')
    expect(sectorTotal).toBe(cpdso + 1)
  })

  it('handles a department whose rows have no column-C heading at all', () => {
    const social = wb.getWorksheet('SOCIAL SERVICES Sector')!
    expect(colB(social, 11)).toBe('SOCIAL DEVELOPMENT SECTOR')
    expect(colB(social, 12)).toBe('City Health Office (CHO)')
    expect(social.getCell(13, 3).value).toBe('Acquisition of Medical Supplies')
  })

  it('contains no formulas — every number is the one the database computed', () => {
    for (const ws of wb.worksheets) {
      for (let r = 1; r <= ws.rowCount; r++) {
        for (let c = 1; c <= 17; c++) {
          const value = ws.getCell(r, c).value
          const isFormula = value !== null && typeof value === 'object' && 'formula' in value
          expect(isFormula, `${ws.name}!${ws.getCell(r, c).address}`).toBe(false)
        }
      }
    }
  })
})

describe('SUMMARY sheet', () => {
  it('lists every department with its code number and totals', () => {
    const summary = wb.getWorksheet('SUMMARY')!
    expect(summary.getCell('C7').value).toBe('GOVERNANCE SECTOR')
    expect(summary.getCell('B8').value).toBe(1)
    expect(summary.getCell('C8').value).toBe('CMO')
    expect(summary.getCell('H8').value).toBe(96022053)
    expect(summary.getCell('C9').value).toBe('CPDSO')
    expect(summary.getCell('C10').value).toBe('SUB-TOTAL')
    expect(summary.getCell('H10').value).toBe(109255718)
  })

  it('ends with the grand total and the NTA figure', () => {
    const summary = wb.getWorksheet('SUMMARY')!
    const grand = findRowIn(summary, 3, 'GRAND TOTAL')
    expect(summary.getCell(grand, 8).value).toBe(169815246)
    const nta = findRowIn(summary, 3, '2027 NTA')
    expect(summary.getCell(nta, 4).value).toBe(2194073955)
  })
})

describe('department-scoped export', () => {
  it('omits SUMMARY and prints only that department', async () => {
    const data = sampleExportData()
    const departmentOnly: AipExportData = {
      ...data,
      scope: 'department',
      sectors: [{ ...data.sectors[0]!, departments: [data.sectors[0]!.departments[0]!] }],
    }
    const only = await render(departmentOnly)
    expect(only.worksheets.map((w) => w.name)).toEqual(['PUBLIC SERVICES Sector'])
    const ws = only.getWorksheet('PUBLIC SERVICES Sector')!
    expect(columnValues(ws, 2)).toContain("City Mayor's Office (CMO)")
    expect(columnValues(ws, 2)).not.toContain(
      'City Planning and Development Services Office (CPDSO)')
  })
})

describe('supplemental AIP', () => {
  it('names itself in the title block', async () => {
    const data = sampleExportData()
    const supplemental = await render({ ...data, supplementalNo: 1 })
    const ws = supplemental.getWorksheet('PUBLIC SERVICES Sector')!
    expect(ws.getCell('A1').value).toBe('SUPPLEMENTAL ANNUAL INVESTMENT PROGRAM (AIP) NO. 1')
  })
})

describe('an empty department', () => {
  it('still prints its band row and a zero subtotal', async () => {
    const data = sampleExportData()
    const empty: AipExportData = {
      ...data,
      sectors: [{
        ...data.sectors[0]!,
        departments: [{
          departmentId: 'dept-empty', code: 'CTO', displayName: "City Treasurer's Office (CTO)",
          codeNumber: 5, rows: [], totals: amounts(),
        }],
      }],
    }
    const wbEmpty = await render(empty)
    const ws = wbEmpty.getWorksheet('PUBLIC SERVICES Sector')!
    expect(colB(ws, 12)).toBe("City Treasurer's Office (CTO)")
    expect(ws.getCell(13, 1).value).toBe("City Treasurer's Office (CTO) TOTAL")
    expect(ws.getCell(13, 13).value).toBe(0)
  })
})

function colB(ws: ExcelJS.Worksheet, row: number): string | null {
  const v = ws.getCell(row, 2).value
  return v === null || v === undefined ? null : String(v)
}
function colC(ws: ExcelJS.Worksheet, row: number): string | null {
  const v = ws.getCell(row, 3).value
  return v === null || v === undefined ? null : String(v)
}
function findRow(ws: ExcelJS.Worksheet, text: string): number {
  return findRowIn(ws, 1, text)
}
function findRowIn(ws: ExcelJS.Worksheet, col: number, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getCell(r, col).value ?? '').trim() === text) return r
  }
  throw new Error(`"${text}" not found in column ${col}`)
}

