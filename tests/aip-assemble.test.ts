// Folding flat view rows into the nested export shape.

import { describe, expect, it } from 'vitest'
import { assembleExportData, type PpaRowSource } from '@/lib/aip/assemble'
import { amounts } from './helpers/sample-aip'

function row(overrides: Partial<PpaRowSource> & { id: string }): PpaRowSource {
  return {
    itemNo: 1,
    refCode: null,
    description: 'A PPA',
    implementingOffice: null,
    startDate: null,
    endDate: null,
    expectedOutput: null,
    fundingSource: null,
    amountPs: 0, amountMooe: 1000, amountFe: 0, amountCo: 0, amountTotal: 1000,
    ccaAmount: null, ccmAmount: null, ccTypologyCode: null,
    rowKind: 'ppa',
    sectorId: 'sec-public', sectorCode: 'PUBLIC', sectorHeading: 'GENERAL PUBLIC SECTOR',
    sectorSheetName: 'PUBLIC SERVICES Sector', sectorSummaryLabel: 'GOVERNANCE SECTOR',
    sectorSort: 1,
    departmentId: 'dep-cmo', departmentCode: 'CMO', departmentName: "City Mayor's Office (CMO)",
    departmentSort: 1, departmentCodeNumber: 1,
    ...overrides,
  }
}

const base = {
  year: 2027,
  lguName: 'Bayugan',
  lguType: 'City',
  draftLabel: null,
  ntaAmount: null,
  scope: 'consolidated' as const,
}

describe('assembleExportData', () => {
  it('groups rows by sector then department', () => {
    const data = assembleExportData({
      ...base,
      rows: [
        row({ id: '1' }),
        row({ id: '2', departmentId: 'dep-cpdso', departmentCode: 'CPDSO',
              departmentName: 'CPDSO', departmentSort: 7 }),
        row({ id: '3', sectorId: 'sec-social', sectorCode: 'SOCIAL',
              sectorHeading: 'SOCIAL DEVELOPMENT SECTOR',
              sectorSheetName: 'SOCIAL SERVICES Sector',
              sectorSummaryLabel: 'SOCIAL DEVELOPMENT SECTOR', sectorSort: 3,
              departmentId: 'dep-cho', departmentCode: 'CHO', departmentName: 'CHO' }),
      ],
      departmentTotals: [], sectorTotals: [], grandTotals: amounts(),
    })

    expect(data.sectors.map((s) => s.code)).toEqual(['PUBLIC', 'SOCIAL'])
    expect(data.sectors[0]!.departments.map((d) => d.code)).toEqual(['CMO', 'CPDSO'])
    expect(data.sectors[1]!.departments.map((d) => d.code)).toEqual(['CHO'])
  })

  it('orders sectors and departments by the database sort, not by arrival', () => {
    const data = assembleExportData({
      ...base,
      rows: [
        row({ id: '1', sectorId: 'sec-social', sectorCode: 'SOCIAL', sectorSort: 3,
              sectorSheetName: 'SOCIAL SERVICES Sector',
              sectorSummaryLabel: 'SOCIAL', sectorHeading: 'SOCIAL',
              departmentId: 'dep-cho', departmentCode: 'CHO', departmentName: 'CHO' }),
        row({ id: '2', departmentId: 'dep-cpdso', departmentCode: 'CPDSO',
              departmentName: 'CPDSO', departmentSort: 7 }),
        row({ id: '3' }),
      ],
      departmentTotals: [], sectorTotals: [], grandTotals: amounts(),
    })

    expect(data.sectors.map((s) => s.code)).toEqual(['PUBLIC', 'SOCIAL'])
    expect(data.sectors[0]!.departments.map((d) => d.code)).toEqual(['CMO', 'CPDSO'])
  })

  it('takes totals from the views and never re-adds them', () => {
    const data = assembleExportData({
      ...base,
      rows: [row({ id: '1', amountMooe: 1000, amountTotal: 1000 })],
      // A total that disagrees with the rows is carried through verbatim: the
      // views are the single source of truth, and a mismatch must be visible.
      departmentTotals: [{ departmentId: 'dep-cmo', ...amounts(0, 999999, 0, 0) }],
      sectorTotals: [{ sectorId: 'sec-public', ...amounts(0, 888888, 0, 0) }],
      grandTotals: amounts(0, 777777, 0, 0),
    })

    expect(data.sectors[0]!.departments[0]!.totals.mooe).toBe(999999)
    expect(data.sectors[0]!.totals.mooe).toBe(888888)
    expect(data.grandTotals.mooe).toBe(777777)
  })

  it('reports a missing total as zero rather than inventing one', () => {
    const data = assembleExportData({
      ...base,
      rows: [row({ id: '1' })],
      departmentTotals: [], sectorTotals: [], grandTotals: amounts(),
    })
    expect(data.sectors[0]!.departments[0]!.totals).toEqual(amounts())
  })

  it('drops the join columns from the exported rows', () => {
    const data = assembleExportData({
      ...base,
      rows: [row({ id: '1', rowKind: 'header', description: 'A CAPTION' })],
      departmentTotals: [], sectorTotals: [], grandTotals: amounts(),
    })
    const exported = data.sectors[0]!.departments[0]!.rows[0]!
    expect(exported.rowKind).toBe('header')
    expect(exported).not.toHaveProperty('sectorId')
    expect(exported).not.toHaveProperty('departmentSort')
  })
})
