// The exported workbook must come out in the order the grid shows.
//
// It did not: sortForExport ordered by item_no, a heading has none, and
// Number(null) is 0 — so every caption sorted ahead of every row and a
// department printed as all of its headings stacked together, then all of its
// programme. The grid was right the whole time, which is the drift these
// assertions exist to catch.

import { describe, expect, it } from 'vitest'
import { __test } from '@/lib/aip/export-data'
import { buildGrid } from '@/lib/aip/grid-model'
import type { PpaRowView } from '@/types/tracks'

const { sortForExport } = __test

/** The CHO submission from the screenshot: two captions mid-document. */
const DOCUMENT = [
  { id: 'h1', kind: 'header', sortOrder: 1, itemNo: null, text: 'General and Administrative Section' },
  { id: 'p1', kind: 'ppa', sortOrder: 2, itemNo: 1, text: '01asdfasdf' },
  { id: 'p2', kind: 'ppa', sortOrder: 3, itemNo: 2, text: 'kjasdkf' },
  { id: 'h2', kind: 'header', sortOrder: 4, itemNo: null, text: 'Support to Tech4Ed' },
  { id: 'h3', kind: 'header', sortOrder: 5, itemNo: null, text: 'General and Administrative Section' },
  { id: 'p3', kind: 'ppa', sortOrder: 6, itemNo: 3, text: 'adsfasdf' },
] as const

const EXPECTED = ['h1', 'p1', 'p2', 'h2', 'h3', 'p3']

function exportRow(entry: (typeof DOCUMENT)[number]) {
  return {
    id: entry.id,
    row_kind: entry.kind,
    sort_order: entry.sortOrder,
    item_no: entry.itemNo,
    description: entry.text,
    sector_sort: 1, department_sort: 1,
    sector_id: 'sec-social', department_id: 'dep-cho',
  }
}

function gridRow(entry: (typeof DOCUMENT)[number]): PpaRowView {
  return {
    id: entry.id, aip_id: 'aip-1', period_id: 'per-1', period_year: 2027,
    aip_kind: 'annual', supplemental_no: null, aip_status: 'draft',
    department_id: 'dep-cho', department_code: 'CHO',
    department_name: 'City Health Office (CHO)', department_sort: 1,
    sector_id: 'sec-social', sector_code: 'SOCIAL',
    sector_heading: 'SOCIAL DEVELOPMENT SECTOR',
    sector_sheet_name: 'SOCIAL SERVICES Sector', sector_sort: 1,
    period_status: 'open',
    row_kind: entry.kind, item_no: entry.itemNo, ref_code: null,
    description: entry.text, implementing_office: null,
    start_date: null, end_date: null, expected_output: null, funding_source: null,
    amount_ps: 0, amount_mooe: entry.kind === 'ppa' ? 1000 : 0, amount_fe: 0,
    amount_co: 0, amount_total: entry.kind === 'ppa' ? 1000 : 0,
    cca_amount: null, ccm_amount: null, cc_typology_code: null,
    continues_ppa_id: null, sort_order: entry.sortOrder,
    dept_status: 'pending', dept_remarks: null,
    planning_status: 'pending', planning_remarks: null,
    review_status: 'pending', review_remarks: null,
    open_return_id: null, open_return_reason: null, open_return_at: null,
    is_returned: false,
  }
}

/** Shuffled, because a query returns rows in no order worth relying on. */
const SCRAMBLED = [DOCUMENT[3], DOCUMENT[0], DOCUMENT[5], DOCUMENT[2], DOCUMENT[4], DOCUMENT[1]]

describe('sortForExport', () => {
  it('interleaves headings with the rows they caption', () => {
    expect(sortForExport(SCRAMBLED.map(exportRow) as never).map((r) => r.id))
      .toEqual(EXPECTED)
  })

  it('does not stack every heading ahead of the programme', () => {
    const ids = sortForExport(SCRAMBLED.map(exportRow) as never).map((r) => r.id)
    expect(ids.slice(0, 3)).not.toEqual(['h1', 'h2', 'h3'])
  })

  it('agrees with the grid, row for row', () => {
    const printed = sortForExport(SCRAMBLED.map(exportRow) as never).map((r) => r.id)
    const onScreen = buildGrid(SCRAMBLED.map(gridRow).sort((a, b) => a.sort_order - b.sort_order))
      .flatMap((entry) =>
        entry.kind === 'ppa' || entry.kind === 'group' ? [entry.row.id] : [])
    expect(printed).toEqual(onScreen)
  })
})
