import { describe, expect, it } from 'vitest'
import { groupSubmissions, submissionLabel } from '@/lib/aip/submissions'
import type { AipTotals } from '@/types/tracks'

function submission(overrides: Partial<AipTotals> & { aip_id: string }): AipTotals {
  return {
    period_id: 'per-1',
    department_id: 'dep-cmo',
    kind: 'annual',
    supplemental_no: null,
    status: 'draft',
    department_code: 'CMO',
    department_name: "City Mayor's Office (CMO)",
    code_number: 1,
    department_sort: 1,
    sector_id: 'sec-public',
    sector_code: 'PUBLIC',
    sector_summary_label: 'GOVERNANCE SECTOR',
    sector_sort: 1,
    fund_id: null,
    fund_code: null,
    fund_label: null,
    ppa_count: 1,
    total_ps: 0, total_mooe: 1000, total_fe: 0, total_co: 0, total_amount: 1000,
    ...overrides,
  }
}

describe('groupSubmissions', () => {
  it('nests a department’s supplementals under it, annual first', () => {
    const grouped = groupSubmissions([
      submission({ aip_id: 'sp2', kind: 'supplemental', supplemental_no: 2 }),
      submission({ aip_id: 'annual' }),
      submission({ aip_id: 'sp1', kind: 'supplemental', supplemental_no: 1 }),
    ])

    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.submissions.map((s) => s.aip_id)).toEqual(['annual', 'sp1', 'sp2'])
    expect(grouped[0]!.hasSupplementals).toBe(true)
  })

  it('adds the combined figure across every submission', () => {
    const grouped = groupSubmissions([
      submission({ aip_id: 'annual', total_amount: 95722053 }),
      submission({ aip_id: 'sp1', kind: 'supplemental', supplemental_no: 1, total_amount: 5000000 }),
    ])
    expect(grouped[0]!.combinedTotal).toBe(100722053)
  })

  it('reports no supplementals for a department that filed only its annual', () => {
    const grouped = groupSubmissions([submission({ aip_id: 'annual', total_amount: 42 })])
    expect(grouped[0]!.hasSupplementals).toBe(false)
    expect(grouped[0]!.combinedTotal).toBe(42)
  })

  it('keeps departments in the order the database returned them', () => {
    const grouped = groupSubmissions([
      submission({ aip_id: 'a', department_id: 'dep-cmo', department_name: 'CMO' }),
      submission({ aip_id: 'b', department_id: 'dep-cho', department_name: 'CHO' }),
      submission({ aip_id: 'c', department_id: 'dep-cmo', department_name: 'CMO',
                   kind: 'supplemental', supplemental_no: 1 }),
    ])
    expect(grouped.map((g) => g.departmentId)).toEqual(['dep-cmo', 'dep-cho'])
  })

  it('handles an empty period', () => {
    expect(groupSubmissions([])).toEqual([])
  })
})

describe('submissionLabel', () => {
  it('names the annual and each supplemental', () => {
    expect(submissionLabel({ kind: 'annual', supplemental_no: null, fund_label: null }))
      .toBe('Annual')
    expect(submissionLabel({ kind: 'supplemental', supplemental_no: 3, fund_label: null }))
      .toBe('Supplemental No. 3')
  })

  // A statutory document is named by its fund. "Annual" is true of the 20% CDF
  // and tells the reader nothing, which is the whole reason these are two
  // tables and not one.
  it('names a statutory document by its fund', () => {
    expect(submissionLabel({ kind: 'annual', supplemental_no: null, fund_label: '20% CDF' }))
      .toBe('20% CDF')
    expect(submissionLabel({ kind: 'supplemental', supplemental_no: 1, fund_label: '5% GAD' }))
      .toBe('5% GAD — Supplemental No. 1')
  })
})
