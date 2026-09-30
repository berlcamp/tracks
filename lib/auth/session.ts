import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Department, Profile, UserRole } from '@/types/tracks'

/** One office a person holds, and their role in it. */
export interface Membership {
  id: string
  role: UserRole
  department: Department
}

export interface SessionContext {
  profile: Profile
  isSuperAdmin: boolean
  /** The role held in the office being worked as, or the city-wide role. */
  role: UserRole | null
  /** The office being worked as, or null for a city-wide role. */
  department: Department | null
  /**
   * Every office this person holds, the one being worked as included. Empty
   * for a city-wide role. More than one is what shows the office switcher.
   */
  memberships: Membership[]
}

/**
 * Resolve the signed-in user's context.
 *
 * Returns null when there is no session, or when the session has no `tracks`
 * profile — an uninvited Google account. Callers redirect; they never fall
 * through to rendering data. RLS returns zero rows regardless, but a page that
 * renders an empty grid to a stranger is still a page a stranger reached.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle<Profile>()
  if (!profile) return null

  // A person may hold several offices and works as one of them per request.
  // WHICH one is the database's answer, not a choice re-made here: asking
  // `current_membership_id()` means the office this page says you are working
  // as is the office every policy on the page is judging you as.
  const [{ data: roleRows }, { data: currentId }] = await Promise.all([
    supabase
      .from('user_roles')
      .select('id, role, department:departments(*)')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .order('created_at'),
    supabase.rpc('current_membership_id'),
  ])

  const rows = (roleRows ?? []) as unknown as {
    id: string
    role: UserRole
    department: Department | null
  }[]
  const current = rows.find((row) => row.id === currentId) ?? null
  // An office that has been deactivated cannot be worked as, so it is not
  // offered — the database would fall back past it anyway.
  const memberships = rows
    .filter((row): row is Membership => row.department !== null && row.department.active)

  return {
    profile,
    isSuperAdmin: profile.global_role === 'super_admin',
    role: current?.role ?? null,
    department: current?.department ?? null,
    memberships,
  }
}

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext()
  if (!ctx) redirect('/no-access')
  return ctx
}

export async function requireRole(roles: UserRole[]): Promise<SessionContext> {
  const ctx = await requireSession()
  if (!ctx.isSuperAdmin && (!ctx.role || !roles.includes(ctx.role))) redirect('/dashboard')
  return ctx
}

/** A department user always operates inside their own office. */
export async function requireDepartment(): Promise<SessionContext & { department: Department }> {
  const ctx = await requireRole(['dept_encoder', 'dept_head'])
  if (!ctx.department) redirect('/dashboard')
  return ctx as SessionContext & { department: Department }
}
