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
  /**
   * `fundId` selects a statutory programme instead of the annual one. It is a
   * separate document, never a slice of the AIP — the two are not mixed and
   * the fund's rows are not in the GRAND TOTAL the AIP form prints.
   */
  consolidatedFor: (
    periodId: string,
    kind: 'annual' | 'supplemental' = 'annual',
    fundId?: string | null,
  ) => {
    const params = new URLSearchParams({ period: periodId })
    if (kind === 'supplemental') params.set('kind', 'supplemental')
    if (fundId) params.set('fund', fundId)
    return `/consolidated?${params.toString()}`
  },
  consolidatedExport: (
    periodId: string,
    kind: 'annual' | 'supplemental' = 'annual',
    fundId?: string | null,
  ) => {
    const params = new URLSearchParams()
    if (kind === 'supplemental') params.set('kind', 'supplemental')
    if (fundId) params.set('fund', fundId)
    const query = params.toString()
    return query
      ? `/api/periods/${periodId}/export?${query}`
      : `/api/periods/${periodId}/export`
  },
  monitoring: '/monitoring',
  monitoringPpa: (ppaId: string) => `/monitoring/${ppaId}` as const,
  budget: '/budget',
  budgetPpa: (ppaId: string) => `/budget/${ppaId}` as const,
  settings: '/settings',
  settingsSectors: '/settings/sectors',
  settingsDepartments: '/settings/departments',
  settingsPeriods: '/settings/periods',
  settingsStatutoryFunds: '/settings/statutory-funds',
  settingsUsers: '/settings/users',
} as const
