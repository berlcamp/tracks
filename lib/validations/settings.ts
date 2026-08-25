import { z } from 'zod'

export const sectorSchema = z.object({
  id: z.uuid().optional(),
  code: z.string().trim().min(1).max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  /** The worksheet tab, e.g. "PUBLIC SERVICES Sector". */
  sheetName: z.string().trim().min(1).max(31,
    'Excel worksheet names cannot exceed 31 characters'),
  /** The band row inside the sheet, e.g. "GENERAL PUBLIC SECTOR". */
  heading: z.string().trim().min(1).max(120),
  /** The group row on SUMMARY, e.g. "GOVERNANCE SECTOR". */
  summaryLabel: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: z.boolean().default(true),
})

export const departmentSchema = z.object({
  id: z.uuid().optional(),
  sectorId: z.uuid(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  codeNumber: z.union([z.coerce.number().int().min(0).max(9999), z.literal('')])
    .optional().transform((v) => (v === '' || v === undefined ? null : v)),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: z.boolean().default(true),
})

export const periodSchema = z.object({
  id: z.uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  title: z.string().trim().min(1).max(200),
  draftLabel: z.string().trim().max(60).optional().transform((v) => (v ? v : null)),
  ntaAmount: z.string().trim().optional()
    .transform((v) => (v ? Number(v.replace(/,/g, '')) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Enter a valid amount'),
})

export const inviteSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    fullName: z.string().trim().min(1).max(200),
    role: z.enum([
      'dept_encoder', 'dept_head', 'planning_staff', 'planning_admin',
      'budget', 'accounting', 'viewer',
    ]),
    departmentId: z.union([z.uuid(), z.literal('')]).optional()
      .transform((v) => (v ? v : null)),
  })
  .refine(
    (v) => (['dept_encoder', 'dept_head'].includes(v.role) ? v.departmentId !== null : true),
    { message: 'A department role needs a department', path: ['departmentId'] },
  )
  .refine(
    (v) => (['dept_encoder', 'dept_head'].includes(v.role) ? true : v.departmentId === null),
    { message: 'A city-wide role must not be tied to a department', path: ['departmentId'] },
  )
