import { z } from 'zod'

/**
 * A PPA as the modal collects it.
 *
 * Amounts arrive as strings from the form and are coerced here — the four
 * expense classes are separate columns on the form and at least one of them must
 * carry money, which is the same rule the database enforces
 * (ppas_amount_positive).
 */
const amount = z
  .string()
  .trim()
  .transform((value) => (value === '' ? 0 : Number(value.replace(/,/g, ''))))
  .pipe(z.number().nonnegative('Amounts cannot be negative').finite())

const optionalText = z.string().trim().max(2000).optional()
  .transform((value) => (value === '' ? null : (value ?? null)))

export const ppaSchema = z
  .object({
    aipId: z.uuid(),
    groupId: z.union([z.uuid(), z.literal('')]).optional()
      .transform((value) => (value ? value : null)),
    refCode: optionalText,
    description: z.string().trim().min(1, 'A description is required').max(2000),
    implementingOffice: optionalText,
    startDate: z.union([z.iso.date(), z.literal('')]).optional()
      .transform((value) => (value ? value : null)),
    endDate: z.union([z.iso.date(), z.literal('')]).optional()
      .transform((value) => (value ? value : null)),
    expectedOutput: optionalText,
    fundingSource: optionalText,
    amountPs: amount,
    amountMooe: amount,
    amountFe: amount,
    amountCo: amount,
  })
  .refine((v) => v.amountPs + v.amountMooe + v.amountFe + v.amountCo > 0, {
    message: 'Enter an amount in at least one expense class',
    path: ['amountMooe'],
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'Completion cannot be before the start',
    path: ['endDate'],
  })

export type PpaInput = z.infer<typeof ppaSchema>

export const groupSchema = z.object({
  aipId: z.uuid(),
  parentId: z.union([z.uuid(), z.literal('')]).optional()
    .transform((value) => (value ? value : null)),
  name: z.string().trim().min(1, 'A name is required').max(300),
})
