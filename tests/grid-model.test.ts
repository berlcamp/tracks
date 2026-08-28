// The grid's layout must agree with the exported workbook's layout — same band
// rows, same heading rows, same subtotal placement. These are the assertions
// that keep the screen and the printout from drifting apart.

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
    sector_sort: 1, period_status: 'open',
    row_kind: 'ppa',
    item_no: 1, ref_code: null, description: 'A PPA', implementing_office: null,
    start_date: null, end_date: null, expected_output: null, funding_source: 'GF',
    amount_ps: 0, amount_mooe: 1000, amount_fe: 0, amount_co: 0, amount_total: 1000,
    cca_amount: null, ccm_amount: null, cc_typology_code: null,
    continues_ppa_id: null, sort_order: 1,
    created_by: null, author_name: null,
    dept_status: 'pending', dept_remarks: null,
    planning_status: 'pending', planning_remarks: null,
    review_status: 'pending', review_remarks: null,
    open_return_id: null, open_return_reason: null, open_return_at: null,
    is_returned: false,
    fund_id: null, fund_code: null, fund_label: null,
    ...overrides,
  }
}

const kinds = (grid: GridRow[]) => grid.map((r) => r.kind)

/** A column-C caption row. */
function header(id: string, description: string, overrides: Partial<PpaRowView> = {}) {
  return row({ id, description, row_kind: 'header', item_no: null,
               amount_mooe: 0, amount_total: 0, ...overrides })
}

describe('buildGrid', () => {
  it('opens with the sector band, then the department band, then data', () => {
    const grid = buildGrid([row({ id: '1' })])
    expect(kinds(grid)).toEqual(['sector', 'department', 'ppa', 'departmentTotal', 'sectorTotal'])
  })

  it('prints headings where they sit in the document, in order', () => {
    const grid = buildGrid([
      header('h1', 'GAO', { sort_order: 1 }),
      row({ id: '1', sort_order: 2 }),
      row({ id: '2', sort_order: 3 }),
      header('h2', 'NATIONAL AGENCIES', { sort_order: 4 }),
      header('h3', 'DILG', { sort_order: 5 }),
      row({ id: '3', sort_order: 6 }),
    ])
    expect(grid.filter((r) => r.kind === 'group').map((g) => g.name))
      .toEqual(['GAO', 'NATIONAL AGENCIES', 'DILG'])
    expect(kinds(grid)).toEqual([
      'sector', 'department',
      'group', 'ppa', 'ppa', 'group', 'group', 'ppa',
      'departmentTotal', 'sectorTotal',
    ])
  })

  it('leaves a heading out of the subtotals — a caption carries no money', () => {
    const grid = buildGrid([
      header('h1', 'GAO', { sort_order: 1 }),
      row({ id: '1', sort_order: 2, amount_mooe: 1000, amount_total: 1000 }),
    ])
    const total = grid.find((r) => r.kind === 'departmentTotal')
    expect(total).toMatchObject({ totals: { mooe: 1000, total: 1000 } })
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
    row({ id: '2', description: 'Construction of Road', funding_source: '20% CDF' }),
    row({ id: '3', ref_code: '8000-000-2-1-10-001-001-003', description: 'Drainage' }),
  ]

  it('returns everything for an empty query', () => {
    expect(filterRows(rows, '   ')).toHaveLength(3)
  })

  it('matches the description, case-insensitively', () => {
    expect(filterRows(rows, 'road').map((r) => r.id)).toEqual(['2'])
  })

  it('matches the funding source', () => {
    expect(filterRows(rows, '20% cdf').map((r) => r.id)).toEqual(['2'])
  })

  it('drops a heading the filter has emptied, and keeps one it has not', () => {
    const withHeadings = [
      header('h1', 'ROADS', { sort_order: 1 }),
      row({ id: '1', description: 'Construction of Road', sort_order: 2 }),
      header('h2', 'SUPPLIES', { sort_order: 3 }),
      row({ id: '2', description: 'Acquisition of Office Supplies', sort_order: 4 }),
    ]
    // "road" keeps the ROADS heading (its row survives) and drops SUPPLIES,
    // which would otherwise stand over nothing.
    expect(filterRows(withHeadings, 'road').map((r) => r.id)).toEqual(['h1', '1'])
  })

  it('keeps a heading that matches the search even with nothing under it', () => {
    const withHeadings = [
      header('h1', 'TECH4ED', { sort_order: 1 }),
      row({ id: '1', description: 'Acquisition of Office Supplies', sort_order: 2 }),
    ]
    expect(filterRows(withHeadings, 'tech4ed').map((r) => r.id)).toEqual(['h1'])
  })

  it('matches the AIP reference code', () => {
    expect(filterRows(rows, '10-001-001-003').map((r) => r.id)).toEqual(['3'])
  })
})
