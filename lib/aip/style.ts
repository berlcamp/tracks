// Geometry and styling lifted from CY 2027 Annual Investment Program_Consolidated
// v3.xlsx. Every value here was read out of that file rather than guessed —
// see tests/aip-template.test.ts, which asserts the generated workbook against
// the real one.

import type { Borders, Fill, Font } from 'exceljs'

/** Accounting format used by every money cell in the source workbook. */
export const MONEY_FORMAT = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@'

export const FONT_NAME = 'Arial Narrow'

/** Sector band row, and the sector TOTAL row. */
export const SECTOR_FILL = 'FF76923C'
/** Department TOTAL row. */
export const DEPARTMENT_TOTAL_FILL = 'FFD6E3BC'
/** Sector group row on SUMMARY. */
export const SUMMARY_SECTOR_FILL = 'FFEAF1DD'

/** A..Q. The form is 17 columns wide; P is hidden in the source. */
export const COLUMN_COUNT = 17

// K, M and N carry no explicit width in the source — they inherit the sheet
// default. Setting them would visibly narrow the Total column.
export const COLUMN_WIDTHS: Record<string, number> = {
  A: 12.71, B: 5.29, C: 37.43, D: 21.29, E: 11.29, F: 12.14, G: 47.71,
  H: 13.86, I: 17.57, J: 20.14, L: 17.57, O: 16.57, P: 15.86, Q: 14.43,
}

export const DEFAULT_COL_WIDTH = 14.43

export function thinBorder(): Partial<Borders> {
  const s = { style: 'thin' as const }
  return { top: s, left: s, bottom: s, right: s }
}

export function solidFill(argb: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

export function font(opts: Partial<Font> = {}): Partial<Font> {
  return { name: FONT_NAME, size: 12, ...opts }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The source workbook writes schedules as "January 2027" — text, not a date, so
 * it prints identically on every machine regardless of locale or Excel version.
 * Parsed from the ISO string directly; `new Date()` would shift the month for
 * anyone east of UTC.
 */
export function formatSchedule(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${m[1]}` : iso
}
