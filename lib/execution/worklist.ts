// What the Budget Office does next with a PPA.
//
// The worklist is not a second opinion about the money — every figure still
// comes from tracks.v_ppa_financials. It only reads those figures back as the
// one action outstanding on the row, so a clerk can work a list rather than
// open two hundred ledgers to find the eleven that need an OBR.

export type BudgetStage = 'unallotted' | 'unpaid' | 'unobligated' | 'settled'

export interface StageInput {
  allotted: number | string
  obligated: number | string
  disbursed: number | string
  unobligated_balance: number | string
  unpaid_obligations: number | string
}

/**
 * The next thing owed on this row, most pressing first.
 *
 * An obligation that has not been paid outranks an allotment that has not been
 * obligated: the city owes that money to somebody, where an unobligated balance
 * is only unspent room. A row with neither is settled — which does NOT mean the
 * whole programmed amount was spent, only that nothing is outstanding against
 * what has been released.
 */
export function budgetStage(row: StageInput): BudgetStage {
  if (Number(row.allotted) <= 0) return 'unallotted'
  if (Number(row.unpaid_obligations) > 0) return 'unpaid'
  if (Number(row.unobligated_balance) > 0) return 'unobligated'
  return 'settled'
}

export const STAGE_LABELS: Record<BudgetStage, string> = {
  unallotted: 'No allotment',
  unpaid: 'Awaiting payment',
  unobligated: 'Unobligated balance',
  settled: 'Settled',
}

/** The filter chips: what a clerk is looking for when they open the page. */
export const STAGE_FILTERS: Array<{ value: BudgetStage; label: string }> = [
  { value: 'unallotted', label: 'Needs allotment' },
  { value: 'unobligated', label: 'Needs obligation' },
  { value: 'unpaid', label: 'Needs disbursement' },
  { value: 'settled', label: 'Settled' },
]

export function countByStage<T extends StageInput>(rows: T[]): Record<BudgetStage, number> {
  const counts: Record<BudgetStage, number> = {
    unallotted: 0, unpaid: 0, unobligated: 0, settled: 0,
  }
  for (const row of rows) counts[budgetStage(row)] += 1
  return counts
}

/** The band fields the worklist groups on. */
export interface DepartmentFields {
  department_id: string
  department_code: string
  department_name: string
  sector_heading: string
}

/** The money a subtotal adds up — the three columns on screen, and the programme. */
export interface MoneyFields extends StageInput {
  approved_amount: number | string
}

export interface DepartmentTotals {
  approved: number
  allotted: number
  obligated: number
  unpaid: number
}

export interface DepartmentGroup<T> {
  department_id: string
  department_code: string
  department_name: string
  sector_heading: string
  rows: T[]
  /** Rows in this group with something still owed on them, over the rows given. */
  outstanding: number
  /** The office's figures, over the rows given. */
  totals: DepartmentTotals
}

/**
 * The worklist, banded by office, with what that office has moved.
 *
 * A clerk works one department's OBRs at a time and rings that office about
 * them, so the list is read office by office rather than as one run of two
 * hundred rows. The rows arrive sorted by sector then department, so the groups
 * come out in the order the programme is printed in; keying by department id
 * rather than trusting that contiguity means an office split across the input
 * is still ONE band, not two saying the same name.
 *
 * It groups whatever it is handed — the visible rows, after the search and the
 * stage chips — so `outstanding` and `totals` are what is on the screen, and
 * the worklist marks a subtotal "(filtered rows only)" exactly as the AIP grid
 * does.
 *
 * Adding these up here does not cross "no total is re-added in TypeScript":
 * that rule guards the AIP form's own columns, where the workbook and the grid
 * have to agree to the peso. These are the execution columns, no view holds an
 * allotment total per OFFICE (v_aip_totals is per document, and this list spans
 * the annual AIP, its supplementals and every fund at once), and none of it is
 * ever printed. Each row's figures still come from v_ppa_financials unchanged.
 */
export function groupByDepartment<T extends DepartmentFields & MoneyFields>(
  rows: T[],
): Array<DepartmentGroup<T>> {
  const groups = new Map<string, DepartmentGroup<T>>()
  for (const row of rows) {
    let group = groups.get(row.department_id)
    if (!group) {
      group = {
        department_id: row.department_id,
        department_code: row.department_code,
        department_name: row.department_name,
        sector_heading: row.sector_heading,
        rows: [],
        outstanding: 0,
        totals: { approved: 0, allotted: 0, obligated: 0, unpaid: 0 },
      }
      groups.set(row.department_id, group)
    }
    group.rows.push(row)
    if (budgetStage(row) !== 'settled') group.outstanding += 1
    group.totals.approved += Number(row.approved_amount)
    group.totals.allotted += Number(row.allotted)
    group.totals.obligated += Number(row.obligated)
    group.totals.unpaid += Number(row.unpaid_obligations)
  }
  return [...groups.values()]
}
