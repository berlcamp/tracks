'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import {
  allotmentSchema, disbursementSchema, obligationSchema, progressSchema,
} from '@/lib/validations/execution'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * Budget writes allotments and obligations; Accounting writes disbursements.
 * Neither is enforced here — the RLS policies are what separate the two hands.
 * These actions exist to validate input and turn constraint names into English.
 */

export async function recordAllotment(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const parsed = allotmentSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('allotments')
      .insert({
        ppa_id: parsed.ppaId,
        amount: parsed.amount,
        allotment_date: parsed.allotmentDate,
        reference_no: parsed.referenceNo,
        remarks: parsed.remarks,
        recorded_by: session.profile.id,
      })
      .select('id')

    if (error) throw new Error(friendly(error.message, 'allotment'))
    if (!data?.length) throw new Error('Only the Budget Office can record an allotment.')

    revalidatePath(routes.budget)
    revalidatePath(routes.monitoring)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function recordObligation(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const parsed = obligationSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('obligations')
      .insert({
        ppa_id: parsed.ppaId,
        obr_no: parsed.obrNo,
        obligation_date: parsed.obligationDate,
        payee: parsed.payee,
        particulars: parsed.particulars,
        amount: parsed.amount,
        recorded_by: session.profile.id,
      })
      .select('id')

    if (error) throw new Error(friendly(error.message, 'obligation'))
    if (!data?.length) throw new Error('Only the Budget Office can record an obligation.')

    revalidatePath(routes.budget)
    revalidatePath(routes.monitoring)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function recordDisbursement(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const parsed = disbursementSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('disbursements')
      .insert({
        ppa_id: parsed.ppaId,
        obligation_id: parsed.obligationId,
        dv_no: parsed.dvNo,
        check_ada_no: parsed.checkAdaNo,
        disbursement_date: parsed.disbursementDate,
        payee: parsed.payee,
        particulars: parsed.particulars,
        amount: parsed.amount,
        recorded_by: session.profile.id,
      })
      .select('id')

    if (error) throw new Error(friendly(error.message, 'disbursement'))
    if (!data?.length) throw new Error('Only the Accounting Office can record a disbursement.')

    revalidatePath(routes.budget)
    revalidatePath(routes.monitoring)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function recordProgress(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const parsed = progressSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppa_progress')
      .upsert(
        {
          ppa_id: parsed.ppaId,
          as_of_date: parsed.asOfDate,
          percent_complete: parsed.percentComplete,
          remarks: parsed.remarks,
          recorded_by: session.profile.id,
        },
        { onConflict: 'ppa_id,as_of_date' },
      )
      .select('id')

    if (error) throw new Error(friendly(error.message, 'progress report'))
    if (!data?.length) {
      throw new Error('Only the implementing office or City Planning can report progress.')
    }

    revalidatePath(routes.monitoring)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

function friendly(message: string, what: string): string {
  if (message.includes('would exceed the obligated amount')) {
    return 'That payment is more than the obligation still has left on it.'
  }
  if (message.includes('cancelled obligation')) {
    return 'That obligation has been cancelled. Record the payment against a live one.'
  }
  if (message.includes('disbursements_obligation_id_ppa_id_fkey')) {
    return 'That obligation belongs to a different PPA.'
  }
  if (message.includes('row-level security')) {
    return `You are not authorised to record a ${what}.`
  }
  return message
}
