'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { fundBaseSchema, statutoryFundSchema } from '@/lib/validations/settings'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * The statutory funds and who may file them. Reference data, so this is the
 * City Planning administrator's — `requireRole` keeps the screen out of other
 * hands and the RLS policies refuse the write regardless.
 */
export async function upsertStatutoryFund(input: unknown): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const parsed = statutoryFundSchema.parse(input)
    const supabase = await createClient()

    const payload = {
      code: parsed.code,
      name: parsed.name,
      short_label: parsed.shortLabel,
      sheet_name: parsed.sheetName,
      percentage: parsed.percentage,
      sort_order: parsed.sortOrder,
      active: parsed.active,
    }

    const { data: fund, error } = parsed.id
      ? await supabase.from('statutory_funds').update(payload).eq('id', parsed.id)
          .select('id').single()
      : await supabase.from('statutory_funds').insert(payload).select('id').single()

    if (error) throw new Error(friendly(error.message))

    // Eligibility is replaced wholesale rather than diffed: the form sends the
    // complete list, and a delete-then-insert says exactly what the screen
    // showed. Removing a department stops it STARTING a new document and does
    // not touch one it has already filed — nothing here reads `aips`.
    const fundId = (fund as { id: string }).id
    const { error: clearError } = await supabase
      .from('statutory_fund_departments').delete().eq('fund_id', fundId)
    if (clearError) throw new Error(friendly(clearError.message))

    if (parsed.departmentIds.length > 0) {
      const { error: linkError } = await supabase
        .from('statutory_fund_departments')
        .insert(parsed.departmentIds.map((id) => ({
          fund_id: fundId, department_id: id,
        })))
      if (linkError) throw new Error(friendly(linkError.message))
    }

    revalidatePath(routes.settings)
    revalidatePath(routes.settingsStatutoryFunds)
    revalidatePath(routes.aips)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * The year's base for one fund — the NTA share the 20% is 20% of.
 *
 * Entered on the consolidated statutory view rather than in Settings: the fund
 * and its percentage are durable facts about the programme, but the base is a
 * fact about CY2027, and it belongs where its consequence is read.
 */
export async function setFundBase(input: unknown): Promise<ActionResult> {
  try {
    await requireRole(['planning_admin'])
    const parsed = fundBaseSchema.parse(input)
    const supabase = await createClient()

    const { error } = await supabase
      .from('statutory_fund_periods')
      .upsert({
        fund_id: parsed.fundId,
        period_id: parsed.periodId,
        base_amount: parsed.baseAmount,
      }, { onConflict: 'fund_id,period_id' })

    if (error) throw new Error(friendly(error.message))

    revalidatePath(routes.consolidated)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

function friendly(message: string): string {
  if (message.includes('statutory_funds_code_key')) {
    return 'That fund code is already in use.'
  }
  if (message.includes('statutory_funds_sheet_name_key')) {
    return 'Another fund already prints to that worksheet name.'
  }
  if (message.includes('row-level security')) {
    return 'Only the City Planning administrator can change this.'
  }
  return message
}
