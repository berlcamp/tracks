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
  /** The viewer's own profile, for deciding what they authored. */
  profileId: string | null
  /** The viewer's own department, if any. */
  departmentId: string | null
  aipStatus: AipStatus
  aipDepartmentId: string
  periodStatus: PeriodStatus
}

/**
 * Who is looking, independent of any one document.
 *
 * The consolidated view spans every office's submission at once, so the lock
 * cannot be asked once per screen there: each row carries its own AIP status
 * and its own office. `contextForRow` pairs the viewer with the row's document
 * so `canEditPpa` answers the same question it answers on a submission screen.
 */
export interface Viewer {
  role: UserRole | null
  isSuperAdmin: boolean
  profileId: string | null
  departmentId: string | null
}

/** The document facts the lock turns on, as a row of v_ppa_rows carries them. */
export interface RowDocument {
  aip_status: AipStatus
  /** The AIP's office. On `ppas` it is the same column, denormalised. */
  department_id: string
  period_status: PeriodStatus
}

export function contextForRow(viewer: Viewer, row: RowDocument): EditContext {
  return {
    role: viewer.role,
    isSuperAdmin: viewer.isSuperAdmin,
    profileId: viewer.profileId,
    departmentId: viewer.departmentId,
    aipStatus: row.aip_status,
    aipDepartmentId: row.department_id,
    periodStatus: row.period_status,
  }
}

/** Editing is open only while the programme is still in the building. */
const EDITABLE_PERIODS: PeriodStatus[] = ['open', 'consolidating']

/** Which of the two readings applies at this AIP's status. */
export function reviewStage(aipStatus: AipStatus): 'department' | 'planning' {
  return aipStatus === 'draft' ? 'department' : 'planning'
}

/** What the lock needs to know about one row. */
export interface RowLock {
  isReturned: boolean
  reviewStatus: ReviewStatus | null
  /** Author, or null on a row that predates authorship being recorded. */
  createdBy: string | null
}

/** The three things the lock turns on, read off a row of v_ppa_rows. */
export function lockOf(row: {
  is_returned: boolean
  review_status: ReviewStatus | null
  created_by: string | null
}): RowLock {
  return {
    isReturned: row.is_returned,
    reviewStatus: row.review_status,
    createdBy: row.created_by,
  }
}

/**
 * Mirrors tracks.owns_row(). An encoder answers for their own lines; the head
 * answers for the office's whole submission, so nothing in it is closed to
 * them. A row with no author on record belongs to no one and stays open, which
 * is what keeps everything written before this rule reachable.
 */
export function ownsRow(ctx: EditContext, createdBy: string | null): boolean {
  if (ctx.role === 'dept_head') return true
  if (createdBy === null) return true
  return createdBy === ctx.profileId
}

/**
 * Mirrors tracks.can_edit_ppa(). The submission lock in one function:
 * a returned item reopens; the two hundred rows beside it do not.
 */
export function canEditPpa(ctx: EditContext, row: RowLock): boolean {
  if (!EDITABLE_PERIODS.includes(ctx.periodStatus)) return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  if (!isDepartmentUser(ctx.role)) return false
  if (ctx.departmentId !== ctx.aipDepartmentId) return false
  if (!ownsRow(ctx, row.createdBy)) return false
  // A row the head has passed is frozen: an approval that can be altered
  // underneath is a signature on a blank page.
  if (row.reviewStatus === 'approved') return false
  if (ctx.aipStatus === 'draft') return true
  return ctx.aipStatus === 'returned' && row.isReturned
}

/** Mirrors the ppas_delete policy, which also turns on who wrote the row. */
export function canDeleteRow(ctx: EditContext, row: RowLock): boolean {
  if (!canModifyStructure(ctx)) return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  if (!ownsRow(ctx, row.createdBy)) return false
  return row.reviewStatus !== 'approved'
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

/**
 * Deciding is one thing; being told is another. Whoever the decision lands on
 * has to be able to read it — an encoder whose row the head sent back learns
 * that from this column and nowhere else, and the remarks come with it. So the
 * column is shown to everyone in the AIP's own office whatever their role, and
 * to whoever is doing the reading. It is on screen only and never printed.
 */
export function canSeeReviewColumn(ctx: EditContext): boolean {
  return canReviewPpa(ctx) || ctx.departmentId === ctx.aipDepartmentId
}

/**
 * Mirrors tracks.accept_aip(). Accepting is City Planning's signature on the
 * lines, the way submitting is the head's — so it is refused while a row is
 * unread, and refused for the same reason at both ends: after acceptance the
 * rows are frozen and no further decision can be recorded on them.
 */
export function canAccept(
  ctx: EditContext, openReturns: number, unapprovedRows = 0,
): boolean {
  return isPlanning(ctx.role, ctx.isSuperAdmin) &&
    ctx.aipStatus === 'submitted' && openReturns === 0 && unapprovedRows === 0
}

/**
 * Mirrors tracks.reopen_aip(). City Planning's escape hatch — "they sent in the
 * wrong file", or a submission accepted before anyone read it. It puts the AIP
 * back to `draft`, so the office owns it again and has to submit it a second
 * time; the reviews already recorded stay recorded, and the reason is written
 * to the audit log.
 *
 * Narrower than the RPC in one way, on purpose: the RPC has no period check, but
 * once the programme has gone to the LDC `can_edit_ppa` refuses every edit, so
 * reopening there would hand the office a draft it cannot touch.
 */
export function canReopen(ctx: EditContext): boolean {
  return isPlanning(ctx.role, ctx.isSuperAdmin) &&
    ctx.aipStatus !== 'draft' &&
    EDITABLE_PERIODS.includes(ctx.periodStatus)
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

/**
 * Mirrors tracks.set_period_status(). Moving the programme along the paper
 * trail — to the LDC, the Mayor, the Council — is the administrator's, at any
 * status: it records where the printed folder actually is, and paper comes back
 * as well as goes out.
 */
export function canSetPeriodStatus(
  role: UserRole | null, isSuperAdmin: boolean,
): boolean {
  return isSuperAdmin || role === 'planning_admin'
}

/** The paper trail in order, for the control that moves the period along it. */
export const PERIOD_STATUS_ORDER: PeriodStatus[] = [
  'open', 'consolidating', 'for_ldc', 'for_mayor', 'for_council', 'approved', 'closed',
]

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  open: 'Open for submissions',
  consolidating: 'Consolidating',
  for_ldc: 'With the LDC',
  for_mayor: "With the Mayor's Office",
  for_council: 'With the City Council',
  approved: 'Approved',
  closed: 'Closed',
}
