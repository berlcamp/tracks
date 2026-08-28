// The presentation deck's pure layer: which slides there are, what order they
// run in, and how a figure is rendered at four metres.
//
// Nothing here computes a total. `compactPeso` changes the UNIT of a figure the
// database already computed so a nine-digit number fits on a projector, and
// every slide that uses it prints the exact figure underneath — the compact
// form is a caption, never the record.

/** One slide of the deck. */
export interface SlideDef {
  id: SlideId
  /** What the slide is called, on the slide and in the rail. */
  title: string
  /** The one line under the title. Kept short — this is read from the back. */
  subtitle: string
  /** Grouping in the contents rail. */
  group: 'The programme' | 'How it is funded' | 'Where it stands' | 'For the decision'
}

export type SlideId =
  | 'summary' | 'sectors' | 'offices' | 'barangays' | 'funding'
  | 'pipeline' | 'priority' | 'resources' | 'trends' | 'execution'
  | 'portfolio' | 'decisions'

export const SLIDES: SlideDef[] = [
  { id: 'summary', group: 'The programme',
    title: 'Executive Summary',
    subtitle: 'The Annual Investment Program at a glance' },
  { id: 'sectors', group: 'The programme',
    title: 'Investment by Sector',
    subtitle: 'What each sector of the programme carries' },
  { id: 'offices', group: 'The programme',
    title: 'Investment by Office',
    subtitle: 'What each department has programmed' },
  { id: 'barangays', group: 'The programme',
    title: 'Investment by Barangay',
    subtitle: 'Read from the wording of each PPA — the AIP form records no location' },
  { id: 'funding', group: 'How it is funded',
    title: 'Funding Sources',
    subtitle: 'Column (7) of the form, as the offices wrote it' },
  { id: 'resources', group: 'How it is funded',
    title: 'Programme against Recorded Resources',
    subtitle: 'Measured against the figures TRACKS holds, and nothing else' },
  { id: 'pipeline', group: 'Where it stands',
    title: 'Status and Review Pipeline',
    subtitle: 'Where every line of the programme has got to' },
  { id: 'execution', group: 'Where it stands',
    title: 'Execution and Monitoring',
    subtitle: 'Allotment, obligation, disbursement and physical progress' },
  { id: 'trends', group: 'Where it stands',
    title: 'Multi-Year Trends',
    subtitle: 'Every programme year on record' },
  { id: 'priority', group: 'For the decision',
    title: 'Investment Portfolio',
    subtitle: 'Where the money is concentrated' },
  { id: 'portfolio', group: 'For the decision',
    title: "Mayor's Project Portfolio",
    subtitle: 'The major projects, largest first' },
  { id: 'decisions', group: 'For the decision',
    title: 'Decision Summary',
    subtitle: 'What the figures say, counted from the database' },
]

const INDEX = new Map(SLIDES.map((slide, i) => [slide.id, i]))

/** Named rather than read off SLIDES[0], so the deck still has a landing slide
 *  if somebody reorders the array. */
export const FIRST_SLIDE: SlideId = 'summary'

/** A slide id from the URL, or the first slide. An id nobody recognises falls
 *  back rather than erroring — the same rule a stale `?period=` follows. */
export function resolveSlide(id: string | undefined | null): SlideId {
  return id && INDEX.has(id as SlideId) ? (id as SlideId) : FIRST_SLIDE
}

export function slideIndex(id: SlideId): number {
  return INDEX.get(id) ?? 0
}

/** The next slide, or null at the end. Presentation mode stops rather than
 *  wrapping: looping back to slide one mid-sentence reads as a bug. */
export function nextSlide(id: SlideId): SlideId | null {
  return SLIDES[slideIndex(id) + 1]?.id ?? null
}

export function prevSlide(id: SlideId): SlideId | null {
  const i = slideIndex(id)
  return i > 0 ? SLIDES[i - 1]?.id ?? null : null
}

export function slideGroups(): Array<{ group: SlideDef['group']; slides: SlideDef[] }> {
  const out: Array<{ group: SlideDef['group']; slides: SlideDef[] }> = []
  for (const slide of SLIDES) {
    const last = out.at(-1)
    if (last && last.group === slide.group) last.slides.push(slide)
    else out.push({ group: slide.group, slides: [slide] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading a figure from the back of a session hall
// ---------------------------------------------------------------------------

const COMPACT = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

/**
 * "₱2.19 B". A unit change for legibility, never a substitute for the figure:
 * every headline that uses this prints the exact peso amount beneath it.
 *
 * Thresholds, not significant figures — ₱986,000,000 must read as ₱986.00 M and
 * not tip into billions, because the two look alike at a distance and a Mayor
 * reading the wrong one off a screen is the whole failure mode this guards.
 */
export function compactPeso(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}₱${COMPACT.format(abs / 1_000_000_000)} B`
  if (abs >= 1_000_000) return `${sign}₱${COMPACT.format(abs / 1_000_000)} M`
  if (abs >= 1_000) return `${sign}₱${COMPACT.format(abs / 1_000)} K`
  return `${sign}₱${COMPACT.format(abs)}`
}

/** "12.34%", or an em dash. Never "0%" for something nobody reported. */
export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

/** A whole number with separators: 1,268. */
const COUNT = new Intl.NumberFormat('en-PH')
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return COUNT.format(Math.round(Number(value)))
}

/** "23 PPAs", "1 PPA". Said often enough on this deck to be worth getting
 *  right — "1 PPAs" on a slide behind the Mayor is a small thing that makes
 *  everything beside it look unchecked. */
export function ppas(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  return `${count(n)} PPA${n === 1 ? '' : 's'}`
}

/** A share of the whole, clamped for the bar geometry only — the printed
 *  percentage is whatever the database said. */
export function barWidth(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return '0%'
  return `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(3)}%`
}

export const STAGE_LABELS: Record<string, string> = {
  encoded: 'Encoded, not yet read',
  dept_returned: 'Sent back by the head',
  dept_approved: 'Approved by the head',
  submitted: 'Submitted, awaiting City Planning',
  planning_returned: 'Sent back by City Planning',
  planning_approved: 'Approved by City Planning',
  accepted: 'Accepted into the consolidation',
}

/**
 * The checkpoint names, short enough to sit under a column.
 *
 * The long forms are what the database returns and what the tooltip shows;
 * these are for the axis, where "Approved by the department head" under a bar
 * one inch wide is a label nobody reads.
 */
export const CHECKPOINT_SHORT: Record<string, string> = {
  encoded: 'Encoded',
  dept_approved: 'Head',
  submitted: 'Submitted',
  planning_approved: 'Planning',
  accepted: 'Accepted',
  allotted: 'Allotted',
  obligated: 'Obligated',
  disbursed: 'Disbursed',
}

/** The same stages, short enough for a bar chart's category axis. */
export const STAGE_SHORT: Record<string, string> = {
  encoded: 'Not yet read',
  dept_returned: 'Back from the head',
  dept_approved: 'Head approved',
  submitted: 'With City Planning',
  planning_returned: 'Back from Planning',
  planning_approved: 'Planning approved',
  accepted: 'Accepted',
}

export const PROGRESS_LABELS: Record<string, string> = {
  completed: 'Completed',
  ongoing: 'Ongoing',
  not_started: 'Reported at 0%',
  unreported: 'No progress reported',
}

export const ORIGIN_LABELS: Record<string, string> = {
  local: 'Local — the city’s own funds',
  external: 'External — national agency, grant or loan',
  unclassified: 'Not classifiable from the wording',
  unstated: 'No funding source stated',
}

/** The rule the funding-origin chart is drawn by, printed beside it so nobody
 *  has to take the classification on trust. Mirrors tracks.funding_origin(). */
export const ORIGIN_RULE =
  'Classified from the wording of column (7): a national agency, grant or loan ' +
  'reads as external; the general fund, the NTA share and the statutory funds ' +
  'read as local. Anything else is left unclassified rather than guessed.'
