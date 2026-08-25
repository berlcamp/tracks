// Client-safe mirrors of the database's authorization rules.
//
// These decide what the UI OFFERS. They are not the enforcement — every rule
// here is enforced again by RLS and by the workflow RPCs, and the database is
// what actually says no. Keeping them in one file means the button and the
// policy can be read side by side.

import type { AipStatus, PeriodStatus, UserRole } from '@/types/tracks'

export const PLANNING_ROLES: UserRole[] = ['planning_staff', 'planning_admin']
export const DEPARTMENT_ROLES: UserRole[] = ['dept_encoder', 'dept_head']

export const ROLE_LABELS: Record<UserRole, string> = {
  dept_encoder: 'Department Encoder',
  dept_head: 'Department Head',
  planning_staff: 'City Planning Staff',
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

/**
 * Mirrors tracks.can_edit_ppa(). The submission lock in one function:
 * a returned item reopens; the two hundred rows beside it do not.
 */
export function canEditPpa(ctx: EditContext, ppaIsReturned: boolean): boolean {
  if (ctx.periodStatus === 'closed') return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  if (!isDepartmentUser(ctx.role)) return false
  if (ctx.departmentId !== ctx.aipDepartmentId) return false
  if (ctx.aipStatus === 'draft') return true
  return ctx.aipStatus === 'returned' && ppaIsReturned
}

/** Mirrors tracks.can_modify_aip_structure(): adding or removing a row. */
export function canModifyStructure(ctx: EditContext): boolean {
  if (ctx.periodStatus === 'closed') return false
  if (isPlanning(ctx.role, ctx.isSuperAdmin)) return true
  return (
    isDepartmentUser(ctx.role) &&
    ctx.departmentId === ctx.aipDepartmentId &&
    ctx.aipStatus === 'draft'
  )
}

/** Only the department head submits, and only from draft or returned. */
export function canSubmit(ctx: EditContext, openReturns: number): boolean {
  return (
    ctx.role === 'dept_head' &&
    ctx.departmentId === ctx.aipDepartmentId &&
    ['draft', 'returned'].includes(ctx.aipStatus) &&
    openReturns === 0 &&
    !['approved', 'closed'].includes(ctx.periodStatus)
  )
}

export function canReturnItems(ctx: EditContext): boolean {
  return isPlanning(ctx.role, ctx.isSuperAdmin) &&
    ['submitted', 'returned'].includes(ctx.aipStatus)
}

export function canAccept(ctx: EditContext, openReturns: number): boolean {
  return isPlanning(ctx.role, ctx.isSuperAdmin) &&
    ctx.aipStatus === 'submitted' && openReturns === 0
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
