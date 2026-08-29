/** Every internal path in one place, so a rename is one edit. */
export const routes = {
  landing: '/',
  login: '/login',
  noAccess: '/no-access',
  dashboard: '/dashboard',
  aips: '/aip',
  aipsFor: (periodId: string) => `/aip?period=${periodId}` as const,
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
  /**
   * The City Planning presentation deck. `slide` is the report on screen and
   * the document triple is the same one the consolidated view takes, so a link
   * to "the 20% CDF's execution slide for CY 2026" is a link somebody can send.
   */
  planningReports: '/planning/reports',
  /** The same deck with the application taken off the screen. */
  planningReportsPresent: '/planning/reports/present',
  planningReportsFor: (
    periodId?: string,
    options: {
      slide?: string
      kind?: 'annual' | 'supplemental'
      fundId?: string | null
    } = {},
  ) => {
    const params = new URLSearchParams()
    if (periodId) params.set('period', periodId)
    if (options.slide) params.set('slide', options.slide)
    if (options.kind === 'supplemental') params.set('kind', 'supplemental')
    if (options.fundId) params.set('fund', options.fundId)
    const query = params.toString()
    return query ? `/planning/reports?${query}` : '/planning/reports'
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
