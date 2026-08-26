// Client-safe mirrors of the database's authorization rules.
//
// These decide what the UI OFFERS. They are not the enforcement — every rule
// here is enforced again by RLS and by the workflow RPCs, and the database is
// what actually says no. Keeping them in one file means the button and the
// policy can be read side by side.

import type { AipStatus, PeriodStatus, ReviewStatus, UserRole } from '@/types/tracks'

export const PLANNING_ROLES: UserRole[] = ['planning_staff', 'planning_admin']
export const DEPARTMENT_ROLES: UserRole[] = ['dept_encoder', 'dept_head']

export const ROLE_LABELS: Record<UserRole, string> = {
  dept_encoder: 'Department Encoder',
  dept_head: 'Department Head',
  planning_staff: 'City Planning Sector Officer',
  planning_admin: 'City Planning Administrator',
  budget: 'Budget Office',
  accounting: 'Accounting Office',
  viewer: 'Viewer',
}

export function isPlanning(role: UserRole | null, isSuperAdmin = false): boolean {
  return isSuperAdmin || (role !== null && PLANNING_ROLES.includes(role))
}

export function isDepartmentUser(role: UserRole | null): boolean {
  return role !== null && DEPARTMENT_ROLES.includes(role)
}

export interface EditContext {
  role: UserRole | null
  isSuperAdmin: boolean
  /** The viewer's own department, if any. */
  departmentId: string | null
  aipStatus: AipStatus
  aipDepartmentId: string
  periodStatus: PeriodStatus
}

/** Editing is open only while the programme is still in the building. */
const EDITABLE_PERIODS: PeriodStatus[] = ['open', 'consolidating']

/** Which of the two readings applies at this AIP's status. */
export function reviewStage(aipStatus: AipStatus): 'department' | 'planning' {
  return aipStatus === 'draft' ? 'department' : 'planning'
}

/**
 * Mirrors tracks.can_edit_ppa(). The submission lock in one function:
 * a returned item reopens; the two hundred rows beside it do not.
 */
export function canEditPpa(
  ctx: EditContext,
  ppaIsReturned: boolean,
  reviewStatus: ReviewStatus | null = null,
): boolean {
  if (!EDITABLE_PERIODS.includes(ctx.periodStatus)) return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  if (!isDepartmentUser(ctx.role)) return false
  if (ctx.departmentId !== ctx.aipDepartmentId) return false
  // A row the head has passed is frozen: an approval that can be altered
  // underneath is a signature on a blank page.
  if (reviewStatus === 'approved') return false
  if (ctx.aipStatus === 'draft') return true
  return ctx.aipStatus === 'returned' && ppaIsReturned
}

/** Mirrors tracks.can_modify_aip_structure(): adding or removing a row. */
export function canModifyStructure(ctx: EditContext): boolean {
  if (!EDITABLE_PERIODS.includes(ctx.periodStatus)) return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  return (
    isDepartmentUser(ctx.role) &&
    ctx.departmentId === ctx.aipDepartmentId &&
    ctx.aipStatus === 'draft'
  )
}

/**
 * Only the department head submits, and only once they have read every line.
 * The head signs for the rows, not for the folder.
 */
export function canSubmit(
  ctx: EditContext, openReturns: number, unapprovedRows = 0,
): boolean {
  return (
    ctx.role === 'dept_head' &&
    ctx.departmentId === ctx.aipDepartmentId &&
    ['draft', 'returned'].includes(ctx.aipStatus) &&
    openReturns === 0 &&
    unapprovedRows === 0 &&
    EDITABLE_PERIODS.includes(ctx.periodStatus)
  )
}

/**
 * Mirrors tracks.review_ppa(). Who reads a row follows from where the AIP has
 * got to, not from who is asking: the head reads their own office's draft, the
 * City Planning Sector Officer reads it once it has been sent in.
 */
export function canReviewPpa(ctx: EditContext): boolean {
  if (!EDITABLE_PERIODS.includes(ctx.periodStatus)) return false
  if (reviewStage(ctx.aipStatus) === 'department') {
    return ctx.role === 'dept_head' && ctx.departmentId === ctx.aipDepartmentId
  }
  return isPlanning(ctx.role, ctx.isSuperAdmin) && ctx.aipStatus !== 'accepted'
}

export function canAccept(ctx: EditContext, openReturns: number): boolean {
  return isPlanning(ctx.role, ctx.isSuperAdmin) &&
    ctx.aipStatus === 'submitted' && openReturns === 0
}

/**
 * Mirrors tracks.finalize_aip_period(). The administrator's one signature over
 * the whole consolidated programme — and it is refused while anything in it is
 * still being argued about.
 */
export function canFinalizePeriod(
  role: UserRole | null,
  isSuperAdmin: boolean,
  periodStatus: PeriodStatus,
): boolean {
  return (isSuperAdmin || role === 'planning_admin')
    && EDITABLE_PERIODS.includes(periodStatus)
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Not yet checked',
  approved: 'Approved',
  returned: 'For revision',
}

export const AIP_STATUS_LABELS: Record<AipStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  returned: 'Returned for correction',
  accepted: 'Accepted',
}

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  open: 'Open for submissions',
  consolidating: 'Consolidating',
  for_ldc: 'With the LDC',
  for_mayor: "With the Mayor's Office",
  for_council: 'With the City Council',
  approved: 'Approved',
  closed: 'Closed',
}
