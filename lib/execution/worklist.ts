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
