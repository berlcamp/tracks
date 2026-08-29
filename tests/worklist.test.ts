// The Budget worklist's one derived fact: what is outstanding on a row.
//
// It reads tracks.v_ppa_financials back as an action, so the ordering of the
// cases IS the rule — an unpaid obligation outranks an unspent allotment.

import { describe, expect, it } from 'vitest'
import {
  budgetStage, countByStage, groupByDepartment,
  type DepartmentFields, type MoneyFields, type StageInput,
} from '@/lib/execution/worklist'

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

describe('groupByDepartment', () => {
  function ppa(
    department: string,
    overrides: Partial<MoneyFields> = {},
  ): DepartmentFields & MoneyFields {
    return {
      department_id: department,
      department_code: department.toUpperCase(),
      department_name: `Office of ${department}`,
      sector_heading: 'SOCIAL SECTOR',
      approved_amount: 0,
      ...row(overrides),
      ...overrides,
    }
  }

  it('bands the list by office, in the order the offices first appear', () => {
    const groups = groupByDepartment([ppa('cho'), ppa('cho'), ppa('ceo')])
    expect(groups.map((g) => g.department_id)).toEqual(['cho', 'ceo'])
    expect(groups[0]!.rows).toHaveLength(2)
    expect(groups[1]!.rows).toHaveLength(1)
  })

  it('keeps an office split across the input as ONE band', () => {
    // The rows arrive sorted, but a band per contiguous run would print the
    // same office twice the day that stops being true.
    const groups = groupByDepartment([ppa('cho'), ppa('ceo'), ppa('cho')])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.rows).toHaveLength(2)
  })

  it('counts what is still owed in the office, not what is settled', () => {
    const [group] = groupByDepartment([
      ppa('cho'),
      ppa('cho', { allotted: 100, obligated: 100, unpaid_obligations: 100 }),
      ppa('cho', { allotted: 100, obligated: 100, disbursed: 100 }),
    ])
    expect(group!.rows).toHaveLength(3)
    expect(group!.outstanding).toBe(2)
  })

  it('subtotals the office over the rows it is handed, and reads the strings', () => {
    // PostgREST hands numeric(16,2) back as a string; a subtotal that added
    // those would concatenate them.
    const [group] = groupByDepartment([
      ppa('cho', { approved_amount: '1000.00', allotted: '600.00', obligated: '250.00',
                   unpaid_obligations: '100.00' }),
      ppa('cho', { approved_amount: 500, allotted: 400, obligated: 400,
                   unpaid_obligations: 50 }),
    ])
    expect(group!.totals).toEqual({
      approved: 1500, allotted: 1000, obligated: 650, unpaid: 150,
    })
  })

  it('groups only the rows it is handed, so a filter empties a band away', () => {
    expect(groupByDepartment([])).toEqual([])
  })
})
