import { z } from 'zod'

export const aipActionSchema = z.object({
  periodId: z.uuid(),
  stage: z.enum(['ldc', 'mayor', 'council']),
  action: z.enum(['endorsed', 'approved', 'approved_with_changes', 'returned']),
  actionDate: z.union([z.iso.date(), z.literal('')]).optional()
    .transform((v) => (v ? v : null)),
  referenceNo: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  remarks: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  /** Storage object path inside the private tracks-documents bucket. */
  documentPath: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
})

export const STAGE_LABELS: Record<'ldc' | 'mayor' | 'council', string> = {
  ldc: 'Local Development Council',
  mayor: "Mayor's Office",
  council: 'City Council',
}

export const ACTION_LABELS: Record<
  'endorsed' | 'approved' | 'approved_with_changes' | 'returned', string
> = {
  endorsed: 'Endorsed',
  approved: 'Approved',
  approved_with_changes: 'Approved with changes',
  returned: 'Returned',
}
