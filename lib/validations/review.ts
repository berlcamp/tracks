import { z } from 'zod'

/**
 * A decision on one row. Remarks are optional when passing a row and required
 * when sending one back — a department cannot act on "returned" with no reason
 * attached, which is the same rule ppa_reviews_return_needs_remarks enforces.
 */
export const reviewSchema = z
  .object({
    aipId: z.uuid(),
    ppaId: z.uuid(),
    decision: z.enum(['approved', 'returned']),
    remarks: z.string().trim().max(2000).optional()
      .transform((value) => (value ? value : null)),
  })
  .refine((v) => v.decision !== 'returned' || (v.remarks?.length ?? 0) > 0, {
    message: 'Say what needs correcting before sending a row back',
    path: ['remarks'],
  })

export type ReviewInput = z.infer<typeof reviewSchema>
