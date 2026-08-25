import { z } from 'zod'

const money = z
  .string()
  .trim()
  .transform((value) => Number(value.replace(/,/g, '')))
  .pipe(z.number().positive('Enter an amount greater than zero').finite())

export const allotmentSchema = z.object({
  ppaId: z.uuid(),
  amount: money,
  allotmentDate: z.iso.date(),
  referenceNo: z.string().trim().max(120).optional()
    .transform((v) => (v ? v : null)),
  remarks: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
})

export const obligationSchema = z.object({
  ppaId: z.uuid(),
  obrNo: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  obligationDate: z.iso.date(),
  payee: z.string().trim().max(300).optional().transform((v) => (v ? v : null)),
  particulars: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  amount: money,
})

export const disbursementSchema = z.object({
  ppaId: z.uuid(),
  obligationId: z.union([z.uuid(), z.literal('')]).optional()
    .transform((v) => (v ? v : null)),
  dvNo: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  checkAdaNo: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  disbursementDate: z.iso.date(),
  payee: z.string().trim().max(300).optional().transform((v) => (v ? v : null)),
  particulars: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  amount: money,
})

export const progressSchema = z.object({
  ppaId: z.uuid(),
  asOfDate: z.iso.date(),
  percentComplete: z
    .string().trim()
    .transform((value) => Number(value))
    .pipe(z.number().min(0, 'Between 0 and 100').max(100, 'Between 0 and 100')),
  remarks: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
})
