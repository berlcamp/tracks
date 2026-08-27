// The client-safe mirrors of the database's rules.
//
// These decide what the UI offers, and they have to agree with 07_review.sql —
// a button that appears and then fails is worse than no button. Every case here
// has a counterpart assertion in the SQL suite.

import { describe, expect, it } from 'vitest'
import {
  canDeleteRow, canEditPpa, canFinalizePeriod, canModifyStructure, canReviewPpa,
  canAccept, canReopen, canSeeReviewColumn, canSetPeriodStatus, canSubmit, ownsRow,
  reviewStage,
  type EditContext, type RowLock,
} from '@/lib/auth/permissions'

/** A row this viewer wrote, unread and not returned, unless said otherwise. */
function row(overrides: Partial<RowLock> = {}): RowLock {
  return { isReturned: false, reviewStatus: 'pending', createdBy: ME, ...overrides }
}

const ME = 'profile-me'
const SOMEONE_ELSE = 'profile-other'

function ctx(overrides: Partial<EditContext> = {}): EditContext {
  return {
    role: 'dept_encoder',
    isSuperAdmin: false,
    profileId: ME,
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
  it('lets an encoder edit their own row in a draft', () => {
    expect(canEditPpa(ctx(), row())).toBe(true)
  })

  it('freezes a row the head has approved', () => {
    expect(canEditPpa(ctx(), row({ reviewStatus: 'approved' }))).toBe(false)
  })

  it('reopens it when the approval is withdrawn', () => {
    expect(canEditPpa(ctx(), row({ reviewStatus: 'returned' }))).toBe(true)
  })

  it('still reopens only the returned item of a submitted AIP', () => {
    const submitted = ctx({ aipStatus: 'returned' })
    expect(canEditPpa(submitted, row({ isReturned: true, reviewStatus: 'returned' })))
      .toBe(true)
    expect(canEditPpa(submitted, row())).toBe(false)
  })

  it('shuts everyone out once the programme has gone to the LDC', () => {
    for (const periodStatus of ['for_ldc', 'for_mayor', 'for_council', 'approved', 'closed'] as const) {
      expect(canEditPpa(ctx({ role: 'planning_admin', periodStatus }), row())).toBe(false)
      expect(canModifyStructure(ctx({ role: 'planning_admin', periodStatus }))).toBe(false)
    }
  })
})

describe('ownsRow', () => {
  it('gives an encoder their own lines and nobody else’s', () => {
    expect(ownsRow(ctx(), ME)).toBe(true)
    expect(ownsRow(ctx(), SOMEONE_ELSE)).toBe(false)
  })

  it('gives the head the whole office — they sign for the submission', () => {
    expect(ownsRow(ctx({ role: 'dept_head' }), SOMEONE_ELSE)).toBe(true)
  })

  it('leaves a row with no author on record open, so nothing is stranded', () => {
    expect(ownsRow(ctx(), null)).toBe(true)
  })
})

describe('canEditPpa and canDeleteRow, between two encoders', () => {
  it('refuses another encoder’s row in the same office', () => {
    const mine = row()
    const theirs = row({ createdBy: SOMEONE_ELSE })
    expect(canEditPpa(ctx(), mine)).toBe(true)
    expect(canEditPpa(ctx(), theirs)).toBe(false)
    expect(canDeleteRow(ctx(), mine)).toBe(true)
    expect(canDeleteRow(ctx(), theirs)).toBe(false)
  })

  it('leaves City Planning able to touch either', () => {
    const planning = ctx({ role: 'planning_staff', departmentId: null })
    expect(canEditPpa(planning, row({ createdBy: SOMEONE_ELSE }))).toBe(true)
    expect(canDeleteRow(planning, row({ createdBy: SOMEONE_ELSE }))).toBe(true)
  })

  it('will not delete a row that has been approved', () => {
    expect(canDeleteRow(ctx(), row({ reviewStatus: 'approved' }))).toBe(false)
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

describe('canSeeReviewColumn', () => {
  it('shows the decision to the encoder it was made about', () => {
    // The head sends a row back for revision; the encoder who wrote it has no
    // other place to read that, or the remarks that came with it.
    expect(canSeeReviewColumn(ctx({ role: 'dept_encoder' }))).toBe(true)
    expect(canSeeReviewColumn(ctx({ role: 'dept_head' }))).toBe(true)
  })

  it('still shows it once the AIP has left the office', () => {
    const submitted = { aipStatus: 'submitted' } as const
    expect(canSeeReviewColumn(ctx({ ...submitted, role: 'dept_encoder' }))).toBe(true)
    expect(canSeeReviewColumn(ctx({ ...submitted, role: 'planning_staff' }))).toBe(true)
  })

  it('keeps it off another office’s programme', () => {
    expect(canSeeReviewColumn(ctx({ role: 'dept_encoder', departmentId: 'dep-cho' })))
      .toBe(false)
    expect(canSeeReviewColumn(ctx({ role: 'budget', departmentId: null }))).toBe(false)
  })
})

describe('canAccept', () => {
  const officer = ctx({ role: 'planning_staff', aipStatus: 'submitted' })

  it('opens only when City Planning has read every line', () => {
    expect(canAccept(officer, 0, 5)).toBe(false)
    expect(canAccept(officer, 0, 0)).toBe(true)
  })

  it('stays shut while an item is out for correction', () => {
    expect(canAccept(officer, 1, 0)).toBe(false)
  })

  it('belongs to City Planning and to a submitted AIP', () => {
    expect(canAccept(ctx({ role: 'dept_head', aipStatus: 'submitted' }), 0, 0)).toBe(false)
    expect(canAccept(ctx({ role: 'planning_staff', aipStatus: 'draft' }), 0, 0)).toBe(false)
    expect(canAccept(ctx({ role: 'planning_staff', aipStatus: 'accepted' }), 0, 0)).toBe(false)
  })
})

describe('canReopen', () => {
  it('is City Planning’s escape hatch, at either desk', () => {
    expect(canReopen(ctx({ role: 'planning_staff', aipStatus: 'submitted' }))).toBe(true)
    expect(canReopen(ctx({ role: 'planning_admin', aipStatus: 'accepted' }))).toBe(true)
    expect(canReopen(ctx({ role: 'dept_head', aipStatus: 'submitted' }))).toBe(false)
    expect(canReopen(ctx({ role: 'budget', aipStatus: 'submitted' }))).toBe(false)
  })

  it('has nothing to undo on a draft', () => {
    expect(canReopen(ctx({ role: 'planning_staff', aipStatus: 'draft' }))).toBe(false)
  })

  it('is not offered once the programme has gone to the LDC', () => {
    // The RPC would allow it; the office would get back a draft that
    // can_edit_ppa refuses every edit to.
    expect(canReopen(ctx({
      role: 'planning_admin', aipStatus: 'accepted', periodStatus: 'for_ldc',
    }))).toBe(false)
  })
})

describe('canSetPeriodStatus', () => {
  it('is the administrator’s, and at any point on the paper trail', () => {
    // Paper comes back from the Mayor's Office as well as going out, so this
    // one is not gated on the period being editable.
    expect(canSetPeriodStatus('planning_admin', false)).toBe(true)
    expect(canSetPeriodStatus(null, true)).toBe(true)
    expect(canSetPeriodStatus('planning_staff', false)).toBe(false)
    expect(canSetPeriodStatus('dept_head', false)).toBe(false)
    expect(canSetPeriodStatus('viewer', false)).toBe(false)
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
