/** Money and dates, formatted the way the AIP form prints them. */

const PESO = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 86222053 -> "86,222,053.00". A zero renders blank, as the form leaves it. */
export function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return PESO.format(n)
}

/** Always prints a figure, including zero — for subtotal rows. */
export function moneyTotal(value: number | string | null | undefined): string {
  const n = value === null || value === undefined ? 0
    : typeof value === 'number' ? value : Number(value)
  return PESO.format(Number.isFinite(n) ? n : 0)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2027-01-01" -> "January 2027". Parsed from the string: `new Date()` would
 *  shift the month for anyone east of UTC. */
export function schedule(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`.trim()
}
