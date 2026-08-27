/** Every internal path in one place, so a rename is one edit. */
export const routes = {
  landing: '/',
  login: '/login',
  noAccess: '/no-access',
  dashboard: '/dashboard',
  aips: '/aip',
  aip: (id: string) => `/aip/${id}` as const,
  aipExport: (id: string) => `/api/aip/${id}/export` as const,
  consolidated: '/consolidated',
  consolidatedFor: (periodId: string, kind: 'annual' | 'supplemental' = 'annual') =>
    kind === 'supplemental'
      ? (`/consolidated?period=${periodId}&kind=supplemental` as const)
      : (`/consolidated?period=${periodId}` as const),
  consolidatedExport: (periodId: string, kind: 'annual' | 'supplemental' = 'annual') =>
    kind === 'supplemental'
      ? (`/api/periods/${periodId}/export?kind=supplemental` as const)
      : (`/api/periods/${periodId}/export` as const),
  monitoring: '/monitoring',
  monitoringPpa: (ppaId: string) => `/monitoring/${ppaId}` as const,
  budget: '/budget',
  settings: '/settings',
  settingsSectors: '/settings/sectors',
  settingsDepartments: '/settings/departments',
  settingsPeriods: '/settings/periods',
  settingsUsers: '/settings/users',
} as const
