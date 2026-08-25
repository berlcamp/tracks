// Grouping a period's submissions for the list screen.
//
// A department files one annual AIP and any number of supplementals. They are
// separate documents — a supplemental only ADDS PPAs, it never amends the annual
// one — so the list nests them under their department rather than merging them,
// and shows the combined figure only where it is genuinely the sum of several
// documents.

import type { AipTotals } from '@/types/tracks'

export interface DepartmentSubmissions<T extends AipTotals = AipTotals> {
  departmentId: string
  departmentName: string
  sectorCode: string
  /** Annual first, then supplementals in filing order. */
  submissions: T[]
  /** Sum across every submission. Equals the annual's own total when there are none. */
  combinedTotal: number
  hasSupplementals: boolean
}

export function groupSubmissions<T extends AipTotals>(rows: T[]): DepartmentSubmissions<T>[] {
  const byDepartment = new Map<string, DepartmentSubmissions<T>>()
  const order: string[] = []

  for (const row of rows) {
    let entry = byDepartment.get(row.department_id)
    if (!entry) {
      entry = {
        departmentId: row.department_id,
        departmentName: row.department_name,
        sectorCode: row.sector_code,
        submissions: [],
        combinedTotal: 0,
        hasSupplementals: false,
      }
      byDepartment.set(row.department_id, entry)
      order.push(row.department_id)
    }
    entry.submissions.push(row)
    entry.combinedTotal += Number(row.total_amount)
    if (row.kind === 'supplemental') entry.hasSupplementals = true
  }

  for (const entry of byDepartment.values()) {
    entry.submissions.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'annual' ? -1 : 1) ||
      (a.supplemental_no ?? 0) - (b.supplemental_no ?? 0))
  }

  return order.map((id) => byDepartment.get(id)!)
}

export function submissionLabel(
  submission: Pick<AipTotals, 'kind' | 'supplemental_no'>,
): string {
  return submission.kind === 'supplemental'
    ? `Supplemental No. ${submission.supplemental_no}`
    : 'Annual'
}
