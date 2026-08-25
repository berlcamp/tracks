/**
 * The local email+password panel on /login.
 *
 * Gated on NEXT_PUBLIC_ENABLE_DEV_LOGIN **and** a localhost Supabase URL, so it
 * cannot appear against the cloud project even if the flag is set by accident.
 * Production has no passwords at all — Google only.
 */
export function devLoginEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== 'true') return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.includes('127.0.0.1') || url.includes('localhost')
}

export const DEV_LOGIN_PASSWORD = 'localdev12345'

export interface DevAccount {
  email: string
  name: string
  role: string
  scope: string
}

/**
 * Mirrors the accounts created by `npm run db:users`. Listing them here is a
 * convenience for switching roles while testing — the accounts themselves do
 * not exist until that script has been run, and signing in as one that has not
 * been created simply fails.
 */
export const DEV_ACCOUNTS: DevAccount[] = [
  { email: 'planning@tracks.local',    name: 'Perla Planning',      role: 'City Planning Administrator', scope: 'City-wide' },
  { email: 'planstaff@tracks.local',   name: 'Sonia Staff',         role: 'City Planning Staff',         scope: 'City-wide' },
  { email: 'budget@tracks.local',      name: 'Benito Budget',       role: 'Budget Office',               scope: 'City-wide' },
  { email: 'accounting@tracks.local',  name: 'Aurora Accounting',   role: 'Accounting Office',           scope: 'City-wide' },
  { email: 'viewer@tracks.local',      name: 'Victor Viewer',       role: 'Viewer',                      scope: 'City-wide' },
  { email: 'cmo.head@tracks.local',    name: 'Hector Head',         role: 'Department Head',             scope: 'CMO' },
  { email: 'cmo.encoder@tracks.local', name: 'Elena Encoder',       role: 'Department Encoder',          scope: 'CMO' },
  { email: 'cho.head@tracks.local',    name: 'Helena Head',         role: 'Department Head',             scope: 'CHO' },
]

export const DEV_LOGIN_EMAIL = DEV_ACCOUNTS[0]!.email
