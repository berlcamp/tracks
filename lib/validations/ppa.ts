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
    rowKind: z.enum(['ppa', 'header']).default('ppa'),
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
  // A heading is a caption: it carries a description and nothing else, which is
  // the same rule ppas_header_is_caption_only enforces in the database.
  .refine(
    (v) => v.rowKind === 'header'
      || v.amountPs + v.amountMooe + v.amountFe + v.amountCo > 0,
    { message: 'Enter an amount in at least one expense class', path: ['amountMooe'] })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'Completion cannot be before the start',
    path: ['endDate'],
  })

/** Where a new row goes: beside an existing one, or at the end. */
export const insertRowSchema = z.object({
  relativeToId: z.uuid().optional(),
  placement: z.enum(['above', 'below', 'end']),
})

export type PpaInput = z.infer<typeof ppaSchema>
