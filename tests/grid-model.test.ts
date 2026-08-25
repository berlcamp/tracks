// The grid's layout must agree with the exported workbook's layout — same band
// rows, same group rows, same subtotal placement. These are the assertions that
// keep the screen and the printout from drifting apart.

import { describe, expect, it } from 'vitest'
import { buildGrid, filterRows, type GridRow } from '@/lib/aip/grid-model'
import type { PpaRowView } from '@/types/tracks'

function row(overrides: Partial<PpaRowView> & { id: string }): PpaRowView {
  return {
    aip_id: 'aip-1', period_id: 'per-1', period_year: 2027, aip_kind: 'annual',
    supplemental_no: null, aip_status: 'draft',
    department_id: 'dep-cmo', department_code: 'CMO',
    department_name: "City Mayor's Office (CMO)", department_sort: 1,
    sector_id: 'sec-public', sector_code: 'PUBLIC',
    sector_heading: 'GENERAL PUBLIC SECTOR', sector_sheet_name: 'PUBLIC SERVICES Sector',
    sector_sort: 1,
    group_id: null, group_path: [], group_path_label: null,
    item_no: 1, ref_code: null, description: 'A PPA', implementing_office: null,
    start_date: null, end_date: null, expected_output: null, funding_source: 'GF',
    amount_ps: 0, amount_mooe: 1000, amount_fe: 0, amount_co: 0, amount_total: 1000,
    cca_amount: null, ccm_amount: null, cc_typology_code: null,
    continues_ppa_id: null, sort_order: 1, group_sort_path: [0, 0, 0, 0],
    open_return_id: null, open_return_reason: null, open_return_at: null,
    is_returned: false,
    ...overrides,
  }
}

const kinds = (grid: GridRow[]) => grid.map((r) => r.kind)

describe('buildGrid', () => {
  it('opens with the sector band, then the department band, then data', () => {
    const grid = buildGrid([row({ id: '1' })])
    expect(kinds(grid)).toEqual(['sector', 'department', 'ppa', 'departmentTotal', 'sectorTotal'])
  })

  it('emits a group row only when the column-C ancestry changes', () => {
    const grid = buildGrid([
      row({ id: '1', group_path: ['GAO'] }),
      row({ id: '2', group_path: ['GAO'] }),
      row({ id: '3', group_path: ['NATIONAL AGENCIES', 'DILG', 'GAO'] }),
      row({ id: '4', group_path: ['NATIONAL AGENCIES', 'COMELEC', 'GAO'] }),
    ])
    const groups = grid.filter((r) => r.kind === 'group')
    expect(groups.map((g) => `${g.depth}:${g.name}`)).toEqual([
      '1:GAO',
      '1:NATIONAL AGENCIES',
      '2:DILG',
      '3:GAO',
      '2:COMELEC',
      '3:GAO',
    ])
  })

  it('closes each department before the next one starts', () => {
    const grid = buildGrid([
      row({ id: '1' }),
      row({ id: '2', department_id: 'dep-cpdso', department_name: 'CPDSO', department_sort: 7 }),
    ])
    expect(kinds(grid)).toEqual([
      'sector', 'department', 'ppa', 'departmentTotal',
      'department', 'ppa', 'departmentTotal', 'sectorTotal',
    ])
  })

  it('closes the sector after its last department, not after its first', () => {
    const grid = buildGrid([
      row({ id: '1' }),
      row({ id: '2', department_id: 'dep-cpdso', department_name: 'CPDSO', department_sort: 7 }),
      row({ id: '3', sector_id: 'sec-social', sector_heading: 'SOCIAL DEVELOPMENT SECTOR',
            sector_sort: 3, department_id: 'dep-cho', department_name: 'CHO' }),
    ])
    const sectorTotals = grid
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.kind === 'sectorTotal')
    expect(sectorTotals).toHaveLength(2)
    // The first sector total lands after the second department's total.
    expect(grid[sectorTotals[0]!.i - 1]!.kind).toBe('departmentTotal')
  })

  it('adds up the subtotals it renders', () => {
    const grid = buildGrid([
      row({ id: '1', amount_ps: 100, amount_mooe: 0, amount_total: 100 }),
      row({ id: '2', amount_ps: 0, amount_mooe: 50, amount_co: 25, amount_total: 75 }),
    ])
    const total = grid.find((r) => r.kind === 'departmentTotal')
    expect(total).toMatchObject({ totals: { ps: 100, mooe: 50, fe: 0, co: 25, total: 175 } })
  })

  it('can hide the department band for a single-department grid', () => {
    const grid = buildGrid([row({ id: '1' })], { showDepartmentBands: false })
    expect(kinds(grid)).toEqual(['sector', 'ppa', 'departmentTotal', 'sectorTotal'])
  })

  it('renders nothing for an empty row set', () => {
    expect(buildGrid([])).toEqual([])
  })

  it('marks subtotals as filtered so the UI can say the total is partial', () => {
    const grid = buildGrid([row({ id: '1' })], { filtered: true })
    const total = grid.find((r) => r.kind === 'departmentTotal')
    expect(total).toMatchObject({ filtered: true })
  })
})

describe('filterRows', () => {
  const rows = [
    row({ id: '1', description: 'Acquisition of Office Supplies', funding_source: 'GF' }),
    row({ id: '2', description: 'Construction of Road', funding_source: '20% CDF',
          group_path: ['Infrastructure Development Program'] }),
    row({ id: '3', ref_code: '8000-000-2-1-10-001-001-003', description: 'Drainage' }),
  ]

  it('returns everything for an empty query', () => {
    expect(filterRows(rows, '   ')).toHaveLength(3)
  })

  it('matches the description, case-insensitively', () => {
    expect(filterRows(rows, 'road').map((r) => r.id)).toEqual(['2'])
  })

  it('matches the funding source and the column-C group name', () => {
    expect(filterRows(rows, '20% cdf').map((r) => r.id)).toEqual(['2'])
    expect(filterRows(rows, 'infrastructure').map((r) => r.id)).toEqual(['2'])
  })

  it('matches the AIP reference code', () => {
    expect(filterRows(rows, '10-001-001-003').map((r) => r.id)).toEqual(['3'])
  })
})
