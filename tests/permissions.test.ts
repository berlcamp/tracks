// The client-safe mirrors of the database's rules.
//
// These decide what the UI offers, and they have to agree with 07_review.sql —
// a button that appears and then fails is worse than no button. Every case here
// has a counterpart assertion in the SQL suite.

import { describe, expect, it } from 'vitest'
import {
  canEditPpa, canFinalizePeriod, canModifyStructure, canReviewPpa, canSubmit,
  reviewStage, type EditContext,
} from '@/lib/auth/permissions'

function ctx(overrides: Partial<EditContext> = {}): EditContext {
  return {
    role: 'dept_encoder',
    isSuperAdmin: false,
    departmentId: 'dep-cmo',
    aipStatus: 'draft',
    aipDepartmentId: 'dep-cmo',
    periodStatus: 'open',
    ...overrides,
  }
}

describe('reviewStage', () => {
  it('reads a draft as the department head, everything else as Planning', () => {
    expect(reviewStage('draft')).toBe('department')
    expect(reviewStage('submitted')).toBe('planning')
    expect(reviewStage('returned')).toBe('planning')
    expect(reviewStage('accepted')).toBe('planning')
  })
})

describe('canEditPpa', () => {
  it('lets the office edit its own draft', () => {
    expect(canEditPpa(ctx(), false, 'pending')).toBe(true)
  })

  it('freezes a row the head has approved', () => {
    expect(canEditPpa(ctx(), false, 'approved')).toBe(false)
  })

  it('reopens it when the approval is withdrawn', () => {
    expect(canEditPpa(ctx(), false, 'returned')).toBe(true)
  })

  it('still reopens only the returned item of a submitted AIP', () => {
    const submitted = ctx({ aipStatus: 'returned' })
    expect(canEditPpa(submitted, true, 'returned')).toBe(true)
    expect(canEditPpa(submitted, false, 'pending')).toBe(false)
  })

  it('shuts everyone out once the programme has gone to the LDC', () => {
    for (const periodStatus of ['for_ldc', 'for_mayor', 'for_council', 'approved', 'closed'] as const) {
      expect(canEditPpa(ctx({ role: 'planning_admin', periodStatus }), false, 'pending'))
        .toBe(false)
      expect(canModifyStructure(ctx({ role: 'planning_admin', periodStatus }))).toBe(false)
    }
  })
})

describe('canSubmit', () => {
  const head = ctx({ role: 'dept_head' })

  it('opens only when the head has read every line', () => {
    expect(canSubmit(head, 0, 3)).toBe(false)
    expect(canSubmit(head, 0, 0)).toBe(true)
  })

  it('stays shut while an item is out for correction', () => {
    expect(canSubmit(ctx({ role: 'dept_head', aipStatus: 'returned' }), 1, 0)).toBe(false)
  })

  it('is the head’s alone', () => {
    expect(canSubmit(ctx({ role: 'dept_encoder' }), 0, 0)).toBe(false)
  })
})

describe('canReviewPpa', () => {
  it('gives a draft to its own head and nobody else', () => {
    expect(canReviewPpa(ctx({ role: 'dept_head' }))).toBe(true)
    expect(canReviewPpa(ctx({ role: 'dept_encoder' }))).toBe(false)
    expect(canReviewPpa(ctx({ role: 'planning_staff' }))).toBe(false)
    expect(canReviewPpa(ctx({ role: 'dept_head', departmentId: 'dep-cho' }))).toBe(false)
  })

  it('hands a submitted AIP to City Planning, and takes it from the head', () => {
    const submitted = { aipStatus: 'submitted' } as const
    expect(canReviewPpa(ctx({ ...submitted, role: 'planning_staff' }))).toBe(true)
    expect(canReviewPpa(ctx({ ...submitted, role: 'planning_admin' }))).toBe(true)
    expect(canReviewPpa(ctx({ ...submitted, role: 'dept_head' }))).toBe(false)
    expect(canReviewPpa(ctx({ ...submitted, role: 'budget' }))).toBe(false)
  })

  it('closes once the AIP is accepted or the period has moved on', () => {
    expect(canReviewPpa(ctx({ role: 'planning_staff', aipStatus: 'accepted' }))).toBe(false)
    expect(canReviewPpa(ctx({
      role: 'planning_staff', aipStatus: 'submitted', periodStatus: 'for_ldc',
    }))).toBe(false)
  })
})

describe('canFinalizePeriod', () => {
  it('is the administrator’s signature, not the officer’s', () => {
    expect(canFinalizePeriod('planning_admin', false, 'open')).toBe(true)
    expect(canFinalizePeriod('planning_staff', false, 'open')).toBe(false)
    expect(canFinalizePeriod('dept_head', false, 'open')).toBe(false)
  })

  it('cannot be given twice', () => {
    expect(canFinalizePeriod('planning_admin', false, 'for_ldc')).toBe(false)
    expect(canFinalizePeriod('planning_admin', false, 'closed')).toBe(false)
  })
})
