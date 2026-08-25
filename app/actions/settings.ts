'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireSession } from '@/lib/auth/session'
import {
  departmentSchema, inviteSchema, periodSchema, sectorSchema,
} from '@/lib/validations/settings'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * Reference data and users. All of it belongs to the City Planning Office —
 * `requireRole` keeps the page out of other hands and the RLS policies
 * (tracks.is_planning_admin) refuse the write regardless.
 */

export async function upsertSector(input: unknown): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const parsed = sectorSchema.parse(input)
    const supabase = await createClient()

    const payload = {
      code: parsed.code,
      name: parsed.name,
      sheet_name: parsed.sheetName,
      heading: parsed.heading,
      summary_label: parsed.summaryLabel,
      sort_order: parsed.sortOrder,
      active: parsed.active,
    }

    const { error } = parsed.id
      ? await supabase.from('sectors').update(payload).eq('id', parsed.id)
      : await supabase.from('sectors').insert(payload)

    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsSectors)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function upsertDepartment(input: unknown): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const parsed = departmentSchema.parse(input)
    const supabase = await createClient()

    const payload = {
      sector_id: parsed.sectorId,
      code: parsed.code,
      name: parsed.name,
      // The band row prints "City Mayor's Office (CMO)" — derived, so the two
      // can never drift apart the way they do in a spreadsheet.
      display_name: `${parsed.name} (${parsed.code})`,
      code_number: parsed.codeNumber,
      sort_order: parsed.sortOrder,
      active: parsed.active,
    }

    const { error } = parsed.id
      ? await supabase.from('departments').update(payload).eq('id', parsed.id)
      : await supabase.from('departments').insert(payload)

    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsDepartments)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function upsertPeriod(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(['planning_admin'])
    const parsed = periodSchema.parse(input)
    const supabase = await createClient()

    const payload = {
      year: parsed.year,
      title: parsed.title,
      draft_label: parsed.draftLabel,
      nta_amount: parsed.ntaAmount,
    }

    const { error } = parsed.id
      ? await supabase.from('aip_periods').update(payload).eq('id', parsed.id)
      : await supabase.from('aip_periods')
          .insert({ ...payload, created_by: session.profile.id })

    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsPeriods)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function setPeriodStatus(periodId: string, status: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { error } = await supabase.rpc('set_period_status', {
      p_period_id: periodId,
      p_status: status,
    })
    if (error) throw new Error(error.message)
    revalidatePath(routes.settingsPeriods)
    revalidatePath(routes.consolidated)
    revalidatePath(routes.dashboard)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function inviteUser(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(['planning_admin'])
    const parsed = inviteSchema.parse(input)
    const supabase = await createClient()

    const { error } = await supabase.from('invites').insert({
      email: parsed.email,
      full_name: parsed.fullName,
      role: parsed.role,
      department_id: parsed.departmentId,
      invited_by: session.profile.id,
    })

    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsUsers)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const supabase = await createClient()
    const { error } = await supabase
      .from('invites').update({ status: 'revoked' }).eq('id', inviteId)
    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsUsers)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

export async function setUserStatus(
  roleId: string,
  status: 'active' | 'inactive',
): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const supabase = await createClient()
    const { error } = await supabase.from('user_roles').update({ status }).eq('id', roleId)
    if (error) throw new Error(friendly(error.message))
    revalidatePath(routes.settingsUsers)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

function friendly(message: string): string {
  if (message.includes('sectors_code_key')) return 'That sector code is already in use.'
  if (message.includes('sectors_sheet_name_key')) {
    return 'Another sector already prints to that worksheet name.'
  }
  if (message.includes('departments_code_key')) return 'That department code is already in use.'
  if (message.includes('aip_periods_year_key')) return 'That year already has an AIP period.'
  if (message.includes('invites_pending_idx')) {
    return 'That address already has a pending invitation.'
  }
  if (message.includes('user_roles_department_matches_role')) {
    return 'A department role needs a department; a city-wide role must not have one.'
  }
  if (message.includes('row-level security')) {
    return 'Only the City Planning administrator can change this.'
  }
  return message
}
