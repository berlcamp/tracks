import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Department, Profile, UserRole } from '@/types/tracks'

export interface SessionContext {
  profile: Profile
  isSuperAdmin: boolean
  role: UserRole | null
  /** The user's department, or null for a city-wide role. */
  department: Department | null
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

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role, status, department:departments(*)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle<{ role: UserRole; status: string; department: Department | null }>()

  return {
    profile,
    isSuperAdmin: profile.global_role === 'super_admin',
    role: roleRow?.role ?? null,
    department: roleRow?.department ?? null,
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
