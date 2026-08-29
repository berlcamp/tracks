// Server-side reads for the City Planning presentation deck.
//
// There is exactly one read: `tracks.presentation_deck()` returns every slide's
// figures as one document, aggregated in SQL from one snapshot. Nothing in this
// file adds up a column of pesos and nothing below it may either — the deck is
// a second way of reading numbers the AIP workbook already prints, and the only
// way the two can disagree is if somebody re-derives one of them here.
//
// 09_presentation.sql asserts the payload's grand total against
// `v_period_totals`, its sector figures against `v_sector_totals` and its office
// figures against `v_aip_totals`.

import { createClient } from '@/lib/supabase/server'
import type { AipStatus, PeriodStatus } from '@/types/tracks'

/** Which document the deck is reporting on: the same triple as the
 *  consolidated view. A fund is a document of its own, never a slice. */
export interface DeckTarget {
  kind: 'annual' | 'supplemental'
  fundId: string | null
}

/** The drill-downs. Any one of them set makes `filtered` true, and every total
 *  on screen is captioned accordingly. */
export interface DeckFilters {
  sectorId?: string | null
  departmentId?: string | null
  fundingSource?: string | null
  status?: string | null
  barangay?: string | null
}

export type WorkflowStage =
  | 'encoded' | 'dept_returned' | 'dept_approved'
  | 'submitted' | 'planning_returned' | 'planning_approved' | 'accepted'

export type ProgressState = 'completed' | 'ongoing' | 'not_started' | 'unreported'

export type FundingOrigin = 'local' | 'external' | 'unclassified' | 'unstated'

export interface DeckDocument {
  period_id: string
  year: number
  title: string
  draft_label: string | null
  period_status: PeriodStatus
  kind: 'annual' | 'supplemental'
  fund_id: string | null
  fund_label: string | null
  fund_name: string | null
  lgu_name: string | null
}

export interface DeckOverview {
  ppa_count: number
  total_amount: number
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  department_count: number
  sector_count: number
  implementing_office_count: number
  funded_count: number
  funded_amount: number
  unfunded_count: number
  unfunded_amount: number
  continuing_count: number
  continuing_amount: number
  new_count: number
  new_amount: number
  largest_amount: number
  median_amount: number | null
  average_amount: number | null
}

export interface DeckSector {
  sector_id: string
  code: string
  name: string
  heading: string
  ppa_count: number
  department_count: number
  total_amount: number
  allotted: number
  obligated: number
  disbursed: number
  share_pct: number | null
  rank: number
}

export interface DeckOffice {
  department_id: string
  code: string
  name: string
  sector_code: string
  sector_name: string
  ppa_count: number
  total_amount: number
  allotted: number
  obligated: number
  disbursed: number
  share_pct: number | null
  rank: number
}

export interface DeckBarangay {
  name: string
  ppa_count: number
  total_amount: number
  rank: number
}

/**
 * How much of the programme names a place at all.
 *
 * TRACKS RECORDS NO LOCATION. The AIP form's column (3) is the implementing
 * OFFICE, and `ppas` has no barangay. Everything on the barangay slide is read
 * out of the text an encoder happened to type, and these three buckets are what
 * make that legible rather than misleading: money attributed to one barangay,
 * money on rows naming several (attributed to none, because attributing it to
 * each would count it twice), and money on rows naming none.
 */
export interface DeckLocationCoverage {
  single_count: number
  multiple_count: number
  unstated_count: number
  single_amount: number
  multiple_amount: number
  unstated_amount: number
}

export interface DeckFundingSource {
  key: string
  label: string
  origin: FundingOrigin
  ppa_count: number
  total_amount: number
  share_pct: number | null
  rank: number
}

export interface DeckFundingOrigin {
  origin: FundingOrigin
  ppa_count: number
  total_amount: number
}

export interface DeckStage {
  stage: WorkflowStage
  ppa_count: number
  total_amount: number
}

/** A checkpoint, not a funnel stage — see the note in 0017. */
export interface DeckCheckpoint {
  step: number
  key: string
  label: string
  ppa_count: number
  total_amount: number
}

export interface DeckProgress {
  state: ProgressState
  ppa_count: number
  total_amount: number
}

export interface DeckPpa {
  ppa_id: string
  rank: number
  item_no: number | null
  ref_code: string | null
  description: string
  sector_name: string
  sector_code: string
  department_name: string
  department_code: string
  implementing_office: string | null
  location_label: string | null
  location_bucket: 'single' | 'multiple' | 'unstated'
  funding_source: string | null
  funding_origin: FundingOrigin
  start_date: string | null
  end_date: string | null
  amount_total: number
  is_continuing: boolean
  workflow_stage: WorkflowStage
  aip_status: AipStatus
  allotted: number
  obligated: number
  disbursed: number
  obligation_rate: number | null
  physical_percent: number | null
  physical_as_of: string | null
  progress_state: ProgressState
}

/**
 * Resources, every figure of it RECORDED rather than projected.
 *
 * `nta_amount` is what the planning administrator entered on the period and the
 * statutory bases are what they entered per fund. TRACKS holds no revenue
 * estimate and this slide invents none — the gap is stated against the one
 * resource figure the database has, and the slide says so in as many words.
 */
export interface DeckResources {
  nta_amount: number | null
  annual_programmed: number
  supplemental_programmed: number
  statutory_programmed: number
  statutory_base: number
  statutory_ceiling: number | null
  funds_without_base: number
  gap: number | null
  covered_pct: number | null
}

export interface DeckStatutoryFund {
  fund_id: string
  code: string
  label: string
  name: string
  percentage: number
  base_amount: number | null
  ceiling_amount: number | null
  programmed_amount: number
  remaining_amount: number | null
  document_count: number
}

export interface DeckTrendYear {
  period_id: string
  year: number
  title: string
  status: PeriodStatus
  total_amount: number
  ppa_count: number
  allotted: number
  disbursed: number
}

export interface DeckTrendSector {
  year: number
  sector_id: string
  code: string
  name: string
  total_amount: number
}

/**
 * One month of the programme year.
 *
 * `obligated`/`disbursed` are what happened IN the month; the cumulative pair
 * is the position as at the end of it, and includes anything dated before the
 * year opened — a CY2027 PPA obligated in December 2026 is money already
 * committed when January starts, and a curve beginning at zero would draw a
 * January jump that never happened.
 */
export interface DeckMonth {
  month: number
  label: string
  obligated: number
  disbursed: number
  obligated_cumulative: number
  disbursed_cumulative: number
}

export interface DeckExecution {
  programmed: number
  allotted: number
  obligated: number
  disbursed: number
  unobligated: number
  unpaid: number
  allotment_rate: number | null
  obligation_rate: number | null
  disbursement_rate: number | null
  ppa_count: number
  physical_reported_count: number
  physical_coverage_pct: number | null
  physical_weighted_pct: number | null
  variance_financial_pct: number | null
  /** Percentage points by which money is ahead of delivery, over the rows that
   *  reported physical progress. Negative means delivery is ahead. */
  variance_points: number | null
}

export interface DeckExecutionSector {
  sector_id: string
  code: string
  name: string
  programmed: number
  allotted: number
  obligated: number
  disbursed: number
  obligation_rate: number | null
  physical_weighted_pct: number | null
}

/** Counted facts, not advice. The deck states what the largest and the most
 *  overdue things are; the room decides what to do about them. */
export interface DeckDecisions {
  top_sector: { name: string; total_amount: number; share_pct: number | null; ppa_count: number } | null
  top_office: { name: string; total_amount: number; share_pct: number | null; ppa_count: number } | null
  top_ppa: { name: string; total_amount: number; department_name: string; sector_name: string } | null
  top_three_sector_share: number | null
  top_ten_ppa_amount: number
  top_ten_ppa_share: number | null
  unfunded_count: number
  unfunded_amount: number
  accepted_unallotted: number
  accepted_unallotted_amount: number
  allotted_unreported: number
  lagging_physical: number
  unpaid_obligations: number
  offices_with_no_obligation: number
  funds_over_ceiling: Array<{
    fund_id: string; label: string
    ceiling_amount: number; programmed_amount: number; over_by: number
  }>
}

export interface DeckOption { id: string; label: string }

export interface PresentationDeck {
  document: DeckDocument
  filters: {
    sector_id: string | null
    department_id: string | null
    funding_source: string | null
    status: string | null
    barangay: string | null
  }
  /** A drill-down is active, so every total was recomputed over the visible
   *  rows. The slides caption it, exactly as the grid captions a subtotal. */
  filtered: boolean
  document_ppa_count: number
  overview: DeckOverview
  sectors: DeckSector[]
  offices: DeckOffice[]
  barangays: DeckBarangay[]
  location_coverage: DeckLocationCoverage
  funding_sources: DeckFundingSource[]
  funding_origins: DeckFundingOrigin[]
  stages: DeckStage[]
  checkpoints: DeckCheckpoint[]
  progress: DeckProgress[]
  top_ppas: DeckPpa[]
  resources: DeckResources
  statutory_funds: DeckStatutoryFund[]
  trend: DeckTrendYear[]
  trend_sectors: DeckTrendSector[]
  execution: DeckExecution
  monthly: DeckMonth[]
  execution_sectors: DeckExecutionSector[]
  decisions: DeckDecisions
  options: {
    sectors: DeckOption[]
    departments: DeckOption[]
    funding_sources: DeckOption[]
    barangays: DeckOption[]
    stages: DeckOption[]
  }
  /**
   * The office the reader is confined to, or null for the city's programme.
   *
   * Set here rather than in SQL because the database has no notion of it:
   * `presentation_deck()` is handed a department id and cannot tell a
   * planning officer drilling into one office from a department account that
   * has only ever had one. `loadDeckRequest` knows which it is, so it states
   * the scope and leaves `filtered` meaning what it always meant.
   */
  scope?: DeckScope | null
}

/**
 * The whole deck, in one round trip.
 *
 * One call rather than nine, on purpose: every slide is then aggregated from
 * the same snapshot of the same query, so the Executive Summary's grand total
 * and the Sector slide's bars cannot drift apart between two round trips while
 * somebody is standing in front of a projector.
 */
export async function getPresentationDeck(
  periodId: string,
  target: DeckTarget = { kind: 'annual', fundId: null },
  filters: DeckFilters = {},
  topLimit = 25,
): Promise<PresentationDeck | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('presentation_deck', {
    p_period_id: periodId,
    p_kind: target.kind,
    p_fund_id: target.fundId,
    p_sector_id: filters.sectorId ?? null,
    p_department_id: filters.departmentId ?? null,
    p_funding_source: filters.fundingSource ?? null,
    p_status: filters.status ?? null,
    p_barangay: filters.barangay ?? null,
    p_top_limit: topLimit,
  })

  if (error || !data) return null
  return data as PresentationDeck
}

/** A row of tracks.v_presentation_ppa — read directly for the portfolio table,
 *  which lists rows rather than totalling them. */
export interface PresentationPpaRow extends Omit<DeckPpa, 'rank'> {
  period_id: string
  period_year: number
  aip_id: string
  aip_kind: 'annual' | 'supplemental'
  fund_id: string | null
  fund_label: string | null
  sector_id: string
  department_id: string
  expected_output: string | null
  amount_ps: number
  amount_mooe: number
  amount_fe: number
  amount_co: number
}

/**
 * The Mayor's project portfolio, largest first.
 *
 * Rows, not totals: the footer figure on that slide comes from the deck, so
 * this list never has to be added up. Capped, because a portfolio slide is a
 * shortlist — the whole programme is the workbook.
 */
export async function getPortfolio(
  periodId: string,
  target: DeckTarget = { kind: 'annual', fundId: null },
  filters: DeckFilters = {},
  limit = 60,
): Promise<PresentationPpaRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('v_presentation_ppa').select('*')
    .eq('period_id', periodId)
    .eq('aip_kind', target.kind)
    .order('amount_total', { ascending: false })
    .limit(limit)

  query = target.fundId ? query.eq('fund_id', target.fundId) : query.is('fund_id', null)
  if (filters.sectorId) query = query.eq('sector_id', filters.sectorId)
  if (filters.departmentId) query = query.eq('department_id', filters.departmentId)
  if (filters.status) query = query.eq('workflow_stage', filters.status)
  if (filters.fundingSource) {
    query = filters.fundingSource === '—'
      ? query.is('funding_source_key', null)
      : query.eq('funding_source_key', filters.fundingSource)
  }
  if (filters.barangay && filters.barangay !== '—') {
    query = query.eq('location_label', filters.barangay)
  }

  const { data } = await query
  return (data ?? []) as PresentationPpaRow[]
}

// ---------------------------------------------------------------------------
// One request, read once
//
// The deck is served on two routes — inside the application shell, and on its
// own at /planning/reports/present with the navigation gone. They show the same
// document under the same filters, so resolving the request lives here rather
// than in either page: two copies of "which period, which fund, which filters"
// is two chances for the projector to disagree with the screen it was set up on.
// ---------------------------------------------------------------------------

import type { AipPeriod, StatutoryFundTotals } from '@/types/tracks'
import { getPeriods, resolvePeriod } from '@/lib/data/aip'
import { getFundTotals } from '@/lib/data/statutory'
import { isDrilledDown, resolveSlide, type DeckScope, type SlideId } from '@/lib/reports/deck'

export interface DeckQuery {
  period?: string
  kind?: string
  fund?: string
  slide?: string
  sector?: string
  office?: string
  source?: string
  barangay?: string
  status?: string
  print?: string
}

export interface DeckRequest {
  period: AipPeriod
  periods: AipPeriod[]
  funds: StatutoryFundTotals[]
  deck: PresentationDeck
  portfolio: PresentationPpaRow[]
  slideId: SlideId
  hasSupplementals: boolean
  /** The office the reader was confined to, or null for the city's programme. */
  scope: DeckScope | null
}

export interface DeckRequestOptions {
  /**
   * Confine the whole read to one office.
   *
   * This is NOT a filter the reader picked, and the URL cannot reach it: `?office=`
   * is ignored while a scope is set. `ppas_read` is `is_provisioned()` — the
   * database lets any provisioned account read every office's rows, because the
   * consolidated view and the execution ledger need exactly that — so a
   * department account is held to its own programme HERE, on the server, before
   * the RPC is called. Nothing scoped is ever fetched and then filtered on the
   * client.
   */
  scope?: DeckScope | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A filter from the URL is sanitised, not trusted. `?sector=` with nothing
 * after it, or an id somebody hand-edited, would otherwise reach a uuid
 * parameter as an empty string and take the whole deck down with a cast error.
 * Every other screen here falls back rather than erroring, and a report the
 * Mayor is waiting for is the worst place to be the exception.
 */
function uuidOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return UUID.test(trimmed) ? trimmed : null
}

function textOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Everything every deck surface needs, or null when there is no programme year. */
export async function loadDeckRequest(
  q: DeckQuery,
  options: DeckRequestOptions = {},
): Promise<DeckRequest | null> {
  const scope = options.scope ?? null
  const [period, periods] = await Promise.all([resolvePeriod(q.period), getPeriods()])
  if (!period) return null

  // A fund id that no longer exists falls back to the annual programme rather
  // than erroring — the same rule a stale `?period=` follows.
  const funds = await getFundTotals(period.id)
  const requestedFund = uuidOrNull(q.fund)
  const fundId = funds.some((f) => f.fund_id === requestedFund) ? requestedFund : null
  const kind = q.kind === 'supplemental' ? 'supplemental' as const : 'annual' as const

  const filters: DeckFilters = {
    sectorId: uuidOrNull(q.sector),
    // The scope wins outright. A department account hand-editing `?office=` to
    // another department's id gets its own office back, not that one's figures.
    departmentId: scope ? scope.department_id : uuidOrNull(q.office),
    fundingSource: textOrNull(q.source),
    barangay: textOrNull(q.barangay),
    status: textOrNull(q.status),
  }

  const supabase = await createClient()
  const [deck, portfolio, { data: supplementals }] = await Promise.all([
    getPresentationDeck(period.id, { kind, fundId }, filters),
    getPortfolio(period.id, { kind, fundId }, filters),
    supabase.from('v_aip_totals').select('kind')
      .eq('period_id', period.id).eq('kind', 'supplemental').is('fund_id', null).limit(1),
  ])
  if (!deck) return null

  // The scope is stated, and `filtered` is corrected to mean what it means
  // everywhere else in this application: the reader narrowed the document
  // themselves. `presentation_deck()` set it true the moment a department id
  // was passed, which is right for a drill-down and wrong for the only
  // programme an office has. A boolean, not a figure — no total is touched.
  deck.scope = scope
  if (scope) deck.filtered = isDrilledDown(deck.filters, scope)

  return {
    period,
    periods,
    funds,
    deck,
    portfolio,
    slideId: resolveSlide(q.slide),
    hasSupplementals: (supplementals ?? []).length > 0,
    scope,
  }
}
