'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'
import { reviewSchema } from '@/lib/validations/review'

/**
 * Reading a row, and signing off the programme.
 *
 * Both go through SECURITY DEFINER RPCs, like every other workflow transition:
 * who may decide what follows from where the AIP has got to, and that is a rule
 * the database owns. Nothing here decides it — this only carries the answer.
 */
export async function reviewPpa(input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = reviewSchema.parse(input)
    const supabase = await createClient()

    const { error } = await supabase.rpc('review_ppa', {
      p_ppa_id: parsed.ppaId,
      p_decision: parsed.decision,
      p_remarks: parsed.remarks,
    })
    if (error) throw new Error(error.message)

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * The administrator's one signature over the whole consolidated AIP: accepts
 * every submitted department and closes the programme for editing, so what goes
 * to the LDC, the Mayor and the Sangguniang Panlungsod cannot move afterwards.
 */
export async function finalizePeriod(periodId: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()

    const { error } = await supabase.rpc('finalize_aip_period', {
      p_period_id: periodId,
    })
    if (error) throw new Error(error.message)

    revalidatePath(routes.consolidated)
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}
