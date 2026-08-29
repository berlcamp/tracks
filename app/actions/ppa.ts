'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { getRowHistory } from '@/lib/data/aip'
import { ppaSchema, insertRowSchema } from '@/lib/validations/ppa'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'
import type { PpaRevision } from '@/types/tracks'

/**
 * A row of the AIP — a line of the programme, or a column-C heading. Both are
 * rows of `tracks.ppas`; a heading is one carrying only a description.
 *
 * Update and delete go through the RLS-bound client on purpose, not a
 * SECURITY DEFINER RPC: the submission lock lives in the policies
 * (tracks.can_edit_ppa / can_modify_aip_structure), and a returned item that is
 * still locked must fail here in exactly the same way it fails in psql.
 *
 * Insert goes through tracks.insert_ppa_row, which is SECURITY **INVOKER** — it
 * bypasses nothing, so the same policies still judge it. What the function buys
 * is one transaction, so shifting the rows below and inserting the new one
 * cannot be observed half-done.
 */
export async function createPpa(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession()
    const parsed = ppaSchema.parse(input)
    const placement = insertRowSchema.parse(input)
    const supabase = await createClient()

    const position = await positionFor(supabase, parsed.aipId, placement)
    const isHeader = parsed.rowKind === 'header'

    const { data, error } = await supabase.rpc('insert_ppa_row', {
      p_aip_id: parsed.aipId,
      p_position: position,
      p_row_kind: parsed.rowKind,
      p_description: parsed.description,
      p_ref_code: isHeader ? null : parsed.refCode,
      p_implementing_office: isHeader ? null : parsed.implementingOffice,
      p_start_date: isHeader ? null : parsed.startDate,
      p_end_date: isHeader ? null : parsed.endDate,
      p_expected_output: isHeader ? null : parsed.expectedOutput,
      p_funding_source: isHeader ? null : parsed.fundingSource,
      p_amount_ps: isHeader ? 0 : parsed.amountPs,
      p_amount_mooe: isHeader ? 0 : parsed.amountMooe,
      p_amount_fe: isHeader ? 0 : parsed.amountFe,
      p_amount_co: isHeader ? 0 : parsed.amountCo,
    }).single<{ id: string }>()

    if (error) throw new Error(friendly(error.message))

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return fail(error)
  }
}

export async function updatePpa(ppaId: string, input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = ppaSchema.parse(input)
    const supabase = await createClient()
    const isHeader = parsed.rowKind === 'header'

    const { data, error } = await supabase
      .from('ppas')
      .update({
        description: parsed.description,
        ref_code: isHeader ? null : parsed.refCode,
        implementing_office: isHeader ? null : parsed.implementingOffice,
        start_date: isHeader ? null : parsed.startDate,
        end_date: isHeader ? null : parsed.endDate,
        expected_output: isHeader ? null : parsed.expectedOutput,
        funding_source: isHeader ? null : parsed.fundingSource,
        amount_ps: isHeader ? 0 : parsed.amountPs,
        amount_mooe: isHeader ? 0 : parsed.amountMooe,
        amount_fe: isHeader ? 0 : parsed.amountFe,
        amount_co: isHeader ? 0 : parsed.amountCo,
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
    // City Planning edits from the consolidated view as well as from the
    // submission screen, and the row it changed is on both.
    revalidatePath(routes.consolidated)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Deleting leaves a gap in sort_order, and that is fine: the document is
 * ordered by the sequence, not by its values, so a hole changes nothing anyone
 * can see. Renumbering here would write to every row below for no gain.
 */
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

/**
 * The sort_order the new row should take. "Above" takes the anchor's own
 * position and pushes it down; "below" takes the one after it.
 */
async function positionFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  aipId: string,
  placement: { relativeToId?: string; placement: 'above' | 'below' | 'end' },
): Promise<number> {
  if (placement.placement !== 'end' && placement.relativeToId) {
    const { data: anchor } = await supabase
      .from('ppas').select('sort_order').eq('id', placement.relativeToId)
      .maybeSingle<{ sort_order: number }>()
    if (anchor) {
      return placement.placement === 'above' ? anchor.sort_order : anchor.sort_order + 1
    }
  }

  const { data: last } = await supabase
    .from('ppas').select('sort_order').eq('aip_id', aipId)
    .order('sort_order', { ascending: false }).limit(1)
    .maybeSingle<{ sort_order: number }>()
  return (last?.sort_order ?? 0) + 1
}

/** Postgres speaks in constraint names; officers do not. */
function friendly(message: string): string {
  if (message.includes('ppas_amount_positive')) {
    return 'Enter an amount in at least one expense class.'
  }
  if (message.includes('ppas_header_is_caption_only')) {
    return 'A column-C heading carries only its text — no dates, office or amounts.'
  }
  if (message.includes('ppas_schedule_order')) {
    return 'The completion date cannot be before the start date.'
  }
  if (message.includes('row-level security')) {
    return 'This AIP is locked. You can only change items City Planning returned to you.'
  }
  return message
}

/**
 * One row's audit trail.
 *
 * `tracks.ppa_revisions` is written by trigger on every insert, update and
 * delete of `tracks.ppas`, so this is not a log the application maintains and
 * could forget to write — it is the database's own record of what happened to
 * the row, and it has no UPDATE or DELETE policy for anybody, planning admin
 * included. Reading it is an action rather than a page load because the panel
 * opens on demand: a grid of two thousand rows does not fetch two thousand
 * histories to show one.
 */
export async function ppaHistory(ppaId: string): Promise<ActionResult<PpaRevision[]>> {
  try {
    await requireSession()
    return { ok: true, data: await getRowHistory(ppaId) }
  } catch (error) {
    return fail(error)
  }
}
