// A miniature consolidated AIP with the shapes that actually appear in the real
// workbook: a department whose rows sit under one heading, a department with a
// three-level column-C tree, and a second sector.

import type { AipExportData, AmountSet, PpaRow } from '@/lib/aip/types'

export function ppa(overrides: Partial<PpaRow> & { itemNo: number; description: string }): PpaRow {
  return {
    id: `ppa-${overrides.itemNo}`,
    refCode: null,
    implementingOffice: "City Mayor's Office",
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    expectedOutput: null,
    fundingSource: 'GF',
    amountPs: 0,
    amountMooe: 0,
    amountFe: 0,
    amountCo: 0,
    amountTotal: 0,
    ccaAmount: null,
    ccmAmount: null,
    ccTypologyCode: null,
    groupPath: [],
    ...overrides,
  }
}

export function amounts(ps = 0, mooe = 0, fe = 0, co = 0): AmountSet {
  return { ps, mooe, fe, co, total: ps + mooe + fe + co }
}

export function sampleExportData(): AipExportData {
  const cmoRows: PpaRow[] = [
    ppa({
      itemNo: 1,
      refCode: '1000-000-2-1-01-001-001-001',
      description: 'Administrative Cost for Salaries, Wages, and Benefits',
      expectedOutput: 'Provided Salaries and Wages',
      amountPs: 86222053,
      amountTotal: 86222053,
      groupPath: ['General and Administrative Operation'],
    }),
    ppa({
      itemNo: 2,
      refCode: '1000-000-2-1-01-001-001-002',
      description: 'Administrative Cost for Travelling (Local)',
      amountMooe: 7000000,
      amountTotal: 7000000,
      groupPath: ['General and Administrative Operation'],
    }),
    // The three-level shape from PUBLIC SERVICES rows 135-137.
    ppa({
      itemNo: 3,
      refCode: '1000-000-2-1-01-001-001-003',
      description: 'Support to DILG Programs',
      amountMooe: 500000,
      amountCo: 2000000,
      amountTotal: 2500000,
      groupPath: [
        'SUPPORT TO NATIONAL AGENCIES',
        'Department of Interior and Local Government',
        'General and Administrative Operation',
      ],
    }),
    ppa({
      itemNo: 4,
      refCode: '1000-000-2-1-01-001-001-004',
      description: 'Support to COMELEC',
      amountMooe: 300000,
      amountTotal: 300000,
      groupPath: [
        'SUPPORT TO NATIONAL AGENCIES',
        'Commission on Election',
        'General and Administrative Operation',
      ],
    }),
  ]

  return {
    year: 2027,
    lguName: 'Bayugan',
    lguType: 'City',
    draftLabel: '1st DRAFT',
    ntaAmount: 2194073955,
    scope: 'consolidated',
    supplementalNo: null,
    sectors: [
      {
        sectorId: 'sector-public',
        code: 'PUBLIC',
        heading: 'GENERAL PUBLIC SECTOR',
        sheetName: 'PUBLIC SERVICES Sector',
        summaryLabel: 'GOVERNANCE SECTOR',
        departments: [
          {
            departmentId: 'dept-cmo',
            code: 'CMO',
            displayName: "City Mayor's Office (CMO)",
            codeNumber: 1,
            rows: cmoRows,
            totals: amounts(86222053, 7800000, 0, 2000000),
          },
          {
            departmentId: 'dept-cpdso',
            code: 'CPDSO',
            displayName: 'City Planning and Development Services Office (CPDSO)',
            codeNumber: 9,
            rows: [
              ppa({
                itemNo: 1,
                refCode: '1000-000-2-1-09-001-001-001',
                description: 'Preparation of the Comprehensive Land Use Plan',
                implementingOffice: 'City Planning and Development Services Office',
                amountMooe: 13233665,
                amountTotal: 13233665,
                groupPath: ['General and Administrative Operation'],
              }),
            ],
            totals: amounts(0, 13233665, 0, 0),
          },
        ],
        totals: amounts(86222053, 21033665, 0, 2000000),
      },
      {
        sectorId: 'sector-social',
        code: 'SOCIAL',
        heading: 'SOCIAL DEVELOPMENT SECTOR',
        sheetName: 'SOCIAL SERVICES Sector',
        summaryLabel: 'SOCIAL DEVELOPMENT SECTOR',
        departments: [
          {
            departmentId: 'dept-cho',
            code: 'CHO',
            displayName: 'City Health Office (CHO)',
            codeNumber: 11,
            rows: [
              ppa({
                itemNo: 1,
                refCode: '1000-000-2-3-11-001-001-001',
                description: 'Acquisition of Medical Supplies',
                implementingOffice: 'City Health Office',
                amountMooe: 44259528,
                amountCo: 16300000,
                amountTotal: 60559528,
                groupPath: [],
              }),
            ],
            totals: amounts(0, 44259528, 0, 16300000),
          },
        ],
        totals: amounts(0, 44259528, 0, 16300000),
      },
    ],
    grandTotals: amounts(86222053, 65293193, 0, 18300000),
  }
}
