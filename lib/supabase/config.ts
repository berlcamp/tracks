/**
 * Shared Supabase client configuration.
 *
 * `schema: 'tracks'` — this Postgres project is shared with other apps
 * (pta-collections, construction-saas, sms-demo). Everything TRACKS owns lives
 * in the `tracks` schema; nothing is in `public`.
 *
 * `storageKey: 'tracks-auth'` — apps on this project may be served from the same
 * parent domain. Without a namespaced key, signing out of one app kills the
 * other's session.
 */
export const TRACKS_SCHEMA = 'tracks' as const
export const TRACKS_STORAGE_KEY = 'tracks-auth' as const
export const TRACKS_COOKIE_PREFIX = 'tracks-auth' as const

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`)
  }
  return value
}

export const SUPABASE_URL = () => requireEnv('NEXT_PUBLIC_SUPABASE_URL')
export const SUPABASE_ANON_KEY = () => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
