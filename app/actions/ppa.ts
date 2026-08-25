'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import {
  ppaSchema, groupSchema, renameGroupSchema, moveGroupSchema,
} from '@/lib/validations/ppa'
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

/**
 * Column-C headings.
 *
 * sort_order is scoped to a heading's SIBLINGS, not to the whole AIP:
 * v_ppa_group_paths builds sort_path one slot per level
 * (`sort_path[1:depth-1] || sort_order || ...`), so what orders a heading is its
 * position among the others sharing its parent. Numbering across the whole AIP
 * happens to sort correctly while headings are only ever appended, and stops
 * doing so the first time one is moved.
 */
export async function createGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession()
    const parsed = groupSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppa_groups')
      .insert({
        aip_id: parsed.aipId,
        parent_id: parsed.parentId,
        name: parsed.name,
        sort_order: await nextSiblingOrder(supabase, parsed.aipId, parsed.parentId),
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

export async function renameGroup(input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = renameGroupSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppa_groups')
      .update({ name: parsed.name })
      .eq('id', parsed.groupId)
      .select('id')

    if (error) throw new Error(friendly(error.message))
    if (!data || data.length === 0) throw new Error(LOCKED)

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Reparent a heading. The new position is the end of its new sibling list.
 *
 * Cycles, cross-AIP parents and a move that would push a descendant past the
 * depth cap are all refused by the database, and the messages it returns name
 * constraints rather than headings — `friendly()` translates the ones an officer
 * can actually act on.
 */
export async function moveGroup(input: unknown): Promise<ActionResult> {
  try {
    await requireSession()
    const parsed = moveGroupSchema.parse(input)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppa_groups')
      .update({
        parent_id: parsed.parentId,
        sort_order: await nextSiblingOrder(supabase, parsed.aipId, parsed.parentId),
      })
      .eq('id', parsed.groupId)
      .select('id')

    if (error) throw new Error(friendly(error.message))
    if (!data || data.length === 0) throw new Error(LOCKED)

    revalidatePath(routes.aip(parsed.aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Swap a heading with the sibling above or below it. Only siblings trade
 * places — moving a heading between levels is `moveGroup`.
 */
export async function reorderGroup(
  aipId: string, groupId: string, direction: 'up' | 'down',
): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()

    const { data: self, error: selfError } = await supabase
      .from('ppa_groups').select('id, parent_id, sort_order')
      .eq('id', groupId).single<{ id: string; parent_id: string | null; sort_order: number }>()
    if (selfError) throw new Error(selfError.message)

    let siblings = supabase
      .from('ppa_groups').select('id, sort_order').eq('aip_id', aipId)
    siblings = self.parent_id === null
      ? siblings.is('parent_id', null)
      : siblings.eq('parent_id', self.parent_id)

    const { data: neighbour, error: neighbourError } = await siblings
      .order('sort_order', { ascending: direction === 'down' })
      [direction === 'down' ? 'gt' : 'lt']('sort_order', self.sort_order)
      .limit(1)
      .maybeSingle<{ id: string; sort_order: number }>()
    if (neighbourError) throw new Error(neighbourError.message)
    // Already at the end of its list. Not an error — the button is simply spent.
    if (!neighbour) return { ok: true, data: undefined }

    const swaps = await Promise.all([
      supabase.from('ppa_groups')
        .update({ sort_order: neighbour.sort_order }).eq('id', self.id).select('id'),
      supabase.from('ppa_groups')
        .update({ sort_order: self.sort_order }).eq('id', neighbour.id).select('id'),
    ])
    for (const swap of swaps) {
      if (swap.error) throw new Error(friendly(swap.error.message))
      if (!swap.data || swap.data.length === 0) throw new Error(LOCKED)
    }

    revalidatePath(routes.aip(aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Delete a heading. Its child headings go with it (FK cascade) and every PPA
 * underneath survives, ungrouped — a caption in column C is not a container of
 * money, and losing a heading must never lose a line of the programme.
 */
export async function deleteGroup(aipId: string, groupId: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ppa_groups').delete().eq('id', groupId).select('id')

    if (error) throw new Error(friendly(error.message))
    if (!data || data.length === 0) throw new Error(LOCKED)

    revalidatePath(routes.aip(aipId))
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/** Appends to the end of the sibling list the heading is joining. */
async function nextSiblingOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  aipId: string,
  parentId: string | null,
): Promise<number> {
  let query = supabase
    .from('ppa_groups').select('sort_order').eq('aip_id', aipId)
  query = parentId === null ? query.is('parent_id', null) : query.eq('parent_id', parentId)

  const { data } = await query
    .order('sort_order', { ascending: false }).limit(1)
    .maybeSingle<{ sort_order: number }>()
  return (data?.sort_order ?? 0) + 1
}

const LOCKED =
  'This AIP is locked. Column-C headings can only be changed while it is a draft.'

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
  if (message.includes('cycle')) {
    return 'That would file a heading under one of its own sub-headings.'
  }
  if (message.includes('ppa_groups_depth_check')) {
    return 'Column C nests four levels at most, and that move would make a fifth.'
  }
  if (message.includes('ppa_groups_name_check')) {
    return 'A heading needs a name.'
  }
  return message
}
