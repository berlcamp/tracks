import { createClient } from '@/lib/supabase/server'
import { getSessionContext } from './session'
import { officeMismatch } from './office'

/**
 * The refused-save message for a person working as the wrong one of their
 * offices, or null. Only called once a write has already failed, so the extra
 * reads cost nothing on the path that succeeds.
 */
export async function staleOfficeMessage(
  ref: { aipId: string } | { departmentId: string },
): Promise<string | null> {
  const session = await getSessionContext()
  if (!session || session.memberships.length < 2) return null

  let departmentId = 'departmentId' in ref ? ref.departmentId : null
  if ('aipId' in ref) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('aips').select('department_id').eq('id', ref.aipId)
      .maybeSingle<{ department_id: string }>()
    departmentId = data?.department_id ?? null
  }
  return departmentId ? officeMismatch(session, departmentId) : null
}
