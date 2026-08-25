'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireSession } from '@/lib/auth/session'
import { aipActionSchema } from '@/lib/validations/aip-action'
import { routes } from '@/lib/routes'
import { fail, type ActionResult } from './types'

/**
 * The paper leg. The folder leaves the building and the system learns nothing
 * until it comes back; City Planning records what the returned paper says.
 *
 * The scan is uploaded from the browser straight to Storage under the caller's
 * own session, so RLS decides whether they may write to the bucket. Only the
 * resulting object path reaches this action.
 */
export async function recordAipAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(['planning_staff', 'planning_admin'])
    const parsed = aipActionSchema.parse(input)
    const supabase = await createClient()

    const { error } = await supabase.from('aip_actions').insert({
      period_id: parsed.periodId,
      stage: parsed.stage,
      action: parsed.action,
      action_date: parsed.actionDate,
      reference_no: parsed.referenceNo,
      remarks: parsed.remarks,
      document_path: parsed.documentPath,
      recorded_by: session.profile.id,
    })

    if (error) {
      throw new Error(
        error.message.includes('row-level security')
          ? 'Only the City Planning Office can record what came back.'
          : error.message,
      )
    }

    revalidatePath(routes.consolidated)
    revalidatePath(routes.dashboard)
    return { ok: true, data: undefined }
  } catch (error) {
    return fail(error)
  }
}

/**
 * A short-lived link to a scan. The bucket is private, so this is the only way
 * a document reaches a browser — there is no permanent URL to leak.
 */
export async function signDocument(path: string): Promise<ActionResult<{ url: string }>> {
  try {
    await requireSession()
    const supabase = await createClient()
    const { data, error } = await supabase.storage
      .from('tracks-documents')
      .createSignedUrl(path, 60 * 5)

    if (error || !data) throw new Error(error?.message ?? 'That document is no longer available.')
    return { ok: true, data: { url: data.signedUrl } }
  } catch (error) {
    return fail(error)
  }
}
