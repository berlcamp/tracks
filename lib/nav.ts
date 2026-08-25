import type { UserRole } from '@/types/tracks'
import { routes } from './routes'

export interface NavItem {
  label: string
  href: string
  icon: 'layout-dashboard' | 'table' | 'layers' | 'wallet' | 'activity' | 'settings'
  /** Roles that see this item. Empty means everyone provisioned. */
  roles?: UserRole[]
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: routes.dashboard, icon: 'layout-dashboard' },
    ],
  },
  {
    label: 'Investment Program',
    items: [
      { label: 'Our AIP', href: routes.aips, icon: 'table',
        roles: ['dept_encoder', 'dept_head'] },
      { label: 'Submissions', href: routes.aips, icon: 'table',
        roles: ['planning_staff', 'planning_admin', 'viewer'] },
      { label: 'Consolidated AIP', href: routes.consolidated, icon: 'layers',
        roles: ['planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer'] },
    ],
  },
  {
    label: 'Execution',
    items: [
      { label: 'Budget & Obligations', href: routes.budget, icon: 'wallet',
        roles: ['budget', 'accounting', 'planning_staff', 'planning_admin'] },
      { label: 'Monitoring', href: routes.monitoring, icon: 'activity' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Settings', href: routes.settings, icon: 'settings',
        roles: ['planning_admin'] },
    ],
  },
]

const DEPARTMENT_ONLY: UserRole[] = ['dept_encoder', 'dept_head']

/**
 * A super admin sees everything EXCEPT items that only make sense inside a
 * department. "Our AIP" has no meaning for someone with no office, and showing
 * it next to "Submissions" — the same route under a different name — reads as a
 * bug rather than a privilege.
 */
export function visibleNav(
  role: UserRole | null,
  isSuperAdmin: boolean,
  hasDepartment = false,
): NavSection[] {
  return NAV
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.roles) return true
        const departmentOnly = item.roles.every((r) => DEPARTMENT_ONLY.includes(r))
        if (departmentOnly && !hasDepartment) return false
        if (isSuperAdmin) return true
        return role !== null && item.roles.includes(role)
      }),
    }))
    .filter((section) => section.items.length > 0)
}
