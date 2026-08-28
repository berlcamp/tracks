// The Budget worklist's one derived fact: what is outstanding on a row.
//
// It reads tracks.v_ppa_financials back as an action, so the ordering of the
// cases IS the rule — an unpaid obligation outranks an unspent allotment.

import { describe, expect, it } from 'vitest'
import { budgetStage, countByStage, type StageInput } from '@/lib/execution/worklist'

function row(overrides: Partial<StageInput> = {}): StageInput {
  return {
    allotted: 0, obligated: 0, disbursed: 0,
    unobligated_balance: 0, unpaid_obligations: 0,
    ...overrides,
  }
}

describe('budgetStage', () => {
  it('starts at the allotment, because nothing else can happen first', () => {
    expect(budgetStage(row())).toBe('unallotted')
    // A programmed amount is not money released. Only the allotment is.
    expect(budgetStage(row({ allotted: 0, unobligated_balance: 0 }))).toBe('unallotted')
  })

  it('asks for the obligation once there is an allotment to spend', () => {
    expect(budgetStage(row({ allotted: 500_000, unobligated_balance: 500_000 })))
      .toBe('unobligated')
  })

  it('puts an unpaid obligation ahead of an unspent allotment', () => {
    // The city owes this money to somebody; the balance beside it is only room.
    expect(budgetStage(row({
      allotted: 500_000, obligated: 300_000, disbursed: 0,
      unobligated_balance: 200_000, unpaid_obligations: 300_000,
    }))).toBe('unpaid')
  })

  it('settles only when nothing is outstanding against the allotment', () => {
    expect(budgetStage(row({
      allotted: 500_000, obligated: 500_000, disbursed: 500_000,
    }))).toBe('settled')
  })

  it('reads the numeric strings PostgREST returns for numeric(16,2)', () => {
    expect(budgetStage(row({ allotted: '500000.00', unobligated_balance: '500000.00' })))
      .toBe('unobligated')
  })
})

describe('countByStage', () => {
  it('counts every row exactly once', () => {
    const rows = [
      row(),
      row({ allotted: 100, unobligated_balance: 100 }),
      row({ allotted: 100, obligated: 100, unpaid_obligations: 100 }),
      row({ allotted: 100, obligated: 100, disbursed: 100 }),
    ]
    const counts = countByStage(rows)
    expect(counts).toEqual({ unallotted: 1, unobligated: 1, unpaid: 1, settled: 1 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length)
  })
})
