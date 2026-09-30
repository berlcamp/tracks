'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { OFFICE_COOKIE, OFFICE_COOKIE_MAX_AGE } from '@/lib/auth/office'
import { fail, type ActionResult } from './types'

/**
 * Work as another office this person holds.
 *
 * The membership check here is for the message, not for safety: the database
 * ignores a cookie naming an office the person does not hold, so a refused
 * switch would only have been a switch that silently did nothing.
 */
export async function switchOffice(departmentId: string): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const membership = session.memberships.find((m) => m.department.id === departmentId)
    if (!membership) throw new Error('You do not hold a role in that office.')

    const store = await cookies()
    store.set(OFFICE_COOKIE, departmentId, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: OFFICE_COOKIE_MAX_AGE,
    })

    // Every page in the shell reads who you are working as.
    revalidatePath('/', 'layout')
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}
