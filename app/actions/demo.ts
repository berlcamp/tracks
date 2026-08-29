'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { fail, type ActionResult } from './types'

/**
 * Demo mode: a whole worked programme year that can be shown to people and
 * handed back to its starting state afterwards.
 *
 * Both of these are SECURITY DEFINER RPCs rather than writes through the
 * RLS-bound client, for the reason every definer function in this codebase
 * exists: they touch tables that belong to other offices. Seeding an
 * obligation is the Budget Office's write, and a planning administrator
 * cannot make it — nor should they be able to, outside this one function,
 * which checks the role in its first statement and can only reach rows inside
 * a period marked `is_demo`.
 */

export async function setDemoMode(on: boolean): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const supabase = await createClient()

    const { error } = await supabase.rpc('set_demo_mode', { p_on: on })
    if (error) throw new Error(error.message)

    // The demo year appears in or disappears from every screen at once, so
    // there is no single path to revalidate.
    revalidatePath('/', 'layout')
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Put the demo year back exactly as it was seeded — every edit, review,
 * allotment and obligation made during a demonstration discarded.
 *
 * It cannot touch a real programme: every statement in rebuild_demo_data()
 * filters on `aip_periods.is_demo`, so the worst a bug in it could do is
 * damage the demo.
 */
export async function rebuildDemoData(): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const supabase = await createClient()

    const { error } = await supabase.rpc('rebuild_demo_data')
    if (error) throw new Error(error.message)

    revalidatePath('/', 'layout')
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}
