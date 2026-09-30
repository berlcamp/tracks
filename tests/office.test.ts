import { describe, expect, it } from 'vitest'
import { officeMismatch, officeSwitchDestination } from '@/lib/auth/office'

const CMO = { id: 'cmo', code: 'CMO', display_name: "City Mayor's Office (CMO)" }
const CHO = { id: 'cho', code: 'CHO', display_name: 'City Health Office (CHO)' }
const CAGRO = { id: 'cagro', code: 'CAgrO', display_name: 'City Agriculture Office (CAgrO)' }

describe('officeSwitchDestination', () => {
  it('leaves a document page for its section list, which belongs to no office', () => {
    expect(officeSwitchDestination('/aip/7f3e')).toBe('/aip')
    expect(officeSwitchDestination('/budget/abc')).toBe('/budget')
  })

  it('stays on a section list', () => {
    expect(officeSwitchDestination('/monitoring')).toBe('/monitoring')
    expect(officeSwitchDestination('/dashboard')).toBe('/dashboard')
  })

  it('goes to the dashboard from the root', () => {
    expect(officeSwitchDestination('/')).toBe('/dashboard')
  })
})

describe('officeMismatch', () => {
  const twoOffices = {
    department: CHO,
    memberships: [{ department: CMO }, { department: CHO }],
  }

  it('explains a refusal on a document of another office this person holds', () => {
    const message = officeMismatch(twoOffices, CMO.id)
    expect(message).toContain('working as CHO')
    expect(message).toContain('Switch back to CMO')
  })

  it('says nothing when they are working as the document\'s own office', () => {
    expect(officeMismatch(twoOffices, CHO.id)).toBeNull()
  })

  it('says nothing about an office they do not hold — that refusal is the ordinary one', () => {
    expect(officeMismatch(twoOffices, CAGRO.id)).toBeNull()
  })

  it('says nothing to a person with one office', () => {
    expect(officeMismatch({ department: CMO, memberships: [{ department: CMO }] }, CHO.id))
      .toBeNull()
  })
})
