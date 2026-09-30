/**
 * Which office a person with several is working as.
 *
 * The choice is a cookie, forwarded to Postgres on every request as the
 * `x-tracks-department` header (see `lib/supabase/server.ts`), where
 * `tracks.current_membership_id()` reads it. The header is a REQUEST, not a
 * grant: the database honours it only for an office the person holds an
 * active membership in, and falls back to their first office otherwise. So
 * the cookie is not secret and is not httpOnly — editing it by hand reaches
 * nothing the person could not already switch to.
 *
 * It is per browser, not per tab. A page left open on one office after
 * switching in another tab is refused by RLS when it saves; `officeMismatch()`
 * turns that refusal into a sentence.
 */
export const OFFICE_COOKIE = 'tracks-department' as const
export const OFFICE_HEADER = 'x-tracks-department' as const

/** A year: the choice outlives the session so the next sign-in opens on it. */
export const OFFICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Where to land after switching office. A page about one document — an AIP,
 * a PPA's ledger — belongs to the office being left, so the switch goes back
 * to that section's list. The query string goes too: a `?fund=` or `?period=`
 * chosen for one office may not exist for the next.
 */
export function officeSwitchDestination(pathname: string): string {
  const section = pathname.split('/').filter(Boolean)[0]
  return section ? `/${section}` : '/dashboard'
}

interface OfficeHolder {
  department: { id: string; code: string } | null
  memberships: { department: { id: string; code: string; display_name: string } }[]
}

/**
 * Why a save was refused, when the reason is that this person is working as a
 * different office from the one the document belongs to — most often because
 * they switched in another tab and this page still shows the old office. Null
 * when that is not the reason, so the caller's own message stands.
 */
export function officeMismatch(holder: OfficeHolder, documentDepartmentId: string): string | null {
  if (holder.memberships.length < 2) return null
  if (holder.department?.id === documentDepartmentId) return null
  const owner = holder.memberships.find((m) => m.department.id === documentDepartmentId)
  if (!owner) return null
  const current = holder.department ? holder.department.code : 'another office'
  return `You are working as ${current} now — the office was switched, perhaps in another `
    + `tab. Switch back to ${owner.department.code} from the top of the sidebar to change `
    + `${owner.department.display_name}'s document.`
}
