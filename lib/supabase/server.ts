import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  SUPABASE_ANON_KEY, SUPABASE_URL,
  TRACKS_COOKIE_PREFIX, TRACKS_SCHEMA, TRACKS_STORAGE_KEY,
} from './config'
import { OFFICE_COOKIE, OFFICE_HEADER } from '@/lib/auth/office'

/**
 * The RLS-bound server client. Every read in the app goes through this, so
 * Postgres — not application code — decides what the user may see.
 *
 * There is deliberately no service-role client anywhere in the request path.
 * Workflow transitions go through SECURITY DEFINER RPCs instead.
 */
export async function createClient() {
  const cookieStore = await cookies()

  // The office a person with several is working as. The database decides
  // whether to honour it — see lib/auth/office.ts.
  const office = cookieStore.get(OFFICE_COOKIE)?.value

  return createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    db: { schema: TRACKS_SCHEMA },
    global: office ? { headers: { [OFFICE_HEADER]: office } } : undefined,
    auth: { storageKey: TRACKS_STORAGE_KEY },
    cookieOptions: { name: TRACKS_COOKIE_PREFIX },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  })
}
