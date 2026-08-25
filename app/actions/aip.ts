'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * Workflow transitions all go through SECURITY DEFINER RPCs. Nothing here writes
 * `aips.status` directly — the rules about who may submit, whether every
 * returned item is resolved, and whether an empty AIP can be submitted live in
 * the database where psql and the UI both have to obey them.
 */

export async function submitAip(aipId: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { error } = await supabase.rpc('submit_aip', { p_aip_id: aipId })
    if (error) throw new Error(error.message)
    revalidatePath(routes.aip(aipId))
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

const returnSchema = z.object({
  ppaId: z.uuid(),
  reason: z.string().trim().min(1, 'Say what needs correcting').max(2000),
})

export async function returnPpa(input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = returnSchema.parse(input)
    const supabase = await createClient()

    const { error } = await supabase.rpc('return_ppa', {
      p_ppa_id: parsed.ppaId,
      p_reason: parsed.reason,
    })
    if (error) throw new Error(error.message)

    const { data: ppa } = await supabase
      .from('ppas').select('aip_id').eq('id', parsed.ppaId).maybeSingle<{ aip_id: string }>()
    if (ppa) revalidatePath(routes.aip(ppa.aip_id))
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function resolveReturn(ppaId: string, note?: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { error } = await supabase.rpc('resolve_return', {
      p_ppa_id: ppaId,
      p_note: note?.trim() || null,
    })
    if (error) throw new Error(error.message)

    const { data: ppa } = await supabase
      .from('ppas').select('aip_id').eq('id', ppaId).maybeSingle<{ aip_id: string }>()
    if (ppa) revalidatePath(routes.aip(ppa.aip_id))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function acceptAip(aipId: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { error } = await supabase.rpc('accept_aip', { p_aip_id: aipId })
    if (error) throw new Error(error.message)
    revalidatePath(routes.aip(aipId))
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function reopenAip(aipId: string, reason: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { error } = await supabase.rpc('reopen_aip', {
      p_aip_id: aipId,
      p_reason: reason,
    })
    if (error) throw new Error(error.message)
    revalidatePath(routes.aip(aipId))
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

const createAipSchema = z.object({
  periodId: z.uuid(),
  departmentId: z.uuid(),
  kind: z.enum(['annual', 'supplemental']),
})

/** Opens a department's submission for a period. A supplemental takes the next
 *  free number automatically — SP-1, SP-2 — so two people opening one at the
 *  same time collide on the unique index rather than silently sharing a number. */
export async function createAip(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession()
    const parsed = createAipSchema.parse(input)
    const supabase = await createClient()

    let supplementalNo: number | null = null
    if (parsed.kind === 'supplemental') {
      const { data: last } = await supabase
        .from('aips')
        .select('supplemental_no')
        .eq('period_id', parsed.periodId)
        .eq('department_id', parsed.departmentId)
        .eq('kind', 'supplemental')
        .order('supplemental_no', { ascending: false })
        .limit(1)
        .maybeSingle<{ supplemental_no: number }>()
      supplementalNo = (last?.supplemental_no ?? 0) + 1
    }

    const { data, error } = await supabase
      .from('aips')
      .insert({
        period_id: parsed.periodId,
        department_id: parsed.departmentId,
        kind: parsed.kind,
        supplemental_no: supplementalNo,
        created_by: session.profile.id,
      })
      .select('id')
      .single()

    if (error) {
      if (error.message.includes('aips_one_annual_idx')) {
        throw new Error('This department already has an annual AIP for that year.')
      }
      throw new Error(error.message)
    }

    revalidatePath(routes.aips)
    return { ok: true, data }
  } catch (error) {
    return fail(error)
  }
}
