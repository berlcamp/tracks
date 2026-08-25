'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { ppaSchema, groupSchema } from '@/lib/validations/ppa'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * Create and update go through the RLS-bound client on purpose, not a
 * SECURITY DEFINER RPC: the submission lock lives in the policies
 * (tracks.can_edit_ppa / can_modify_aip_structure), and a returned item that is
 * still locked must fail here in exactly the same way it fails in psql.
 */
export async function createPpa(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession()
    const parsed = ppaSchema.parse(input)
    const supabase = await createClient()

    const { data: aip, error: aipError } = await supabase
      .from('aips').select('department_id').eq('id', parsed.aipId).single()
    if (aipError) throw aipError

    // Append to the end of its group. The item number is derived by the view,
    // so nothing has to be renumbered.
    const { data: last } = await supabase
      .from('ppas').select('sort_order').eq('aip_id', parsed.aipId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle<{ sort_order: number }>()

    const { data, error } = await supabase
      .from('ppas')
      .insert({
        aip_id: parsed.aipId,
        department_id: aip.department_id,
        group_id: parsed.groupId,
        ref_code: parsed.refCode,
        description: parsed.description,
        implementing_office: parsed.implementingOffice,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        expected_output: parsed.expectedOutput,
        funding_source: parsed.fundingSource,
        amount_ps: parsed.amountPs,
        amount_mooe: parsed.amountMooe,
        amount_fe: parsed.amountFe,
        amount_co: parsed.amountCo,
        sort_order: (last?.sort_order ?? 0) + 1,
        created_by: session.profile.id,
      })
      .select('id')
      .single()

    if (error) throw new Error(friendly(error.message))

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data }
  } catch (error) {
    return fail(error)
  }
}

export async function updatePpa(ppaId: string, input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = ppaSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppas')
      .update({
        group_id: parsed.groupId,
        ref_code: parsed.refCode,
        description: parsed.description,
        implementing_office: parsed.implementingOffice,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        expected_output: parsed.expectedOutput,
        funding_source: parsed.fundingSource,
        amount_ps: parsed.amountPs,
        amount_mooe: parsed.amountMooe,
        amount_fe: parsed.amountFe,
        amount_co: parsed.amountCo,
      })
      .eq('id', ppaId)
      .select('id')

    if (error) throw new Error(friendly(error.message))
    // RLS filters rather than raises: zero rows means the lock said no.
    if (!data || data.length === 0) {
      throw new Error(
        'This item is locked. A submitted AIP can only be changed on the items City '
        + 'Planning returned.')
    }

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function deletePpa(ppaId: string, aipId: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()

    const { data, error } = await supabase.from('ppas').delete().eq('id', ppaId).select('id')
    if (error) throw new Error(friendly(error.message))
    if (!data || data.length === 0) {
      throw new Error('This AIP is locked. Rows can only be removed while it is a draft.')
    }

    revalidatePath(routes.aip(aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function createGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession()
    const parsed = groupSchema.parse(input)
    const supabase = await createClient()

    const { data: siblings } = await supabase
      .from('ppa_groups').select('sort_order').eq('aip_id', parsed.aipId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle<{ sort_order: number }>()

    const { data, error } = await supabase
      .from('ppa_groups')
      .insert({
        aip_id: parsed.aipId,
        parent_id: parsed.parentId,
        name: parsed.name,
        sort_order: (siblings?.sort_order ?? 0) + 1,
        created_by: session.profile.id,
      })
      .select('id')
      .single()

    if (error) throw new Error(friendly(error.message))

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data }
  } catch (error) {
    return fail(error)
  }
}

/** Postgres speaks in constraint names; officers do not. */
function friendly(message: string): string {
  if (message.includes('ppas_amount_positive')) {
    return 'Enter an amount in at least one expense class.'
  }
  if (message.includes('ppas_schedule_order')) {
    return 'The completion date cannot be before the start date.'
  }
  if (message.includes('row-level security')) {
    return 'This AIP is locked. You can only change items City Planning returned to you.'
  }
  return message
}
