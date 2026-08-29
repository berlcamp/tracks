// Server-side reads for the AIP screens.
//
// Every query goes through the RLS-bound client, so what comes back is already
// what the caller is allowed to see. Totals are read from the views and never
// re-summed here.

import { createClient } from '@/lib/supabase/server'
import type {
  Aip, AipPeriod, AipTotals, Department, PeriodTotals, PpaRowView,
  PpaRevision, SectorTotals, StatutoryFund, StatutoryFundTotals,
} from '@/types/tracks'

export async function getCurrentPeriod(): Promise<AipPeriod | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aip_periods').select('*').order('year', { ascending: false }).limit(1)
    .maybeSingle<AipPeriod>()
  return data
}

/**
 * The period a screen is showing: the one asked for, or the latest.
 *
 * A year in the URL that does not exist falls back to the current programme
 * rather than an error page — a stale bookmark from a period somebody deleted
 * should land on this year's work, not on a dead end.
 */
export async function resolvePeriod(periodId?: string): Promise<AipPeriod | null> {
  if (!periodId) return getCurrentPeriod()
  const supabase = await createClient()
  const { data } = await supabase
    .from('aip_periods').select('*').eq('id', periodId).maybeSingle<AipPeriod>()
  return data ?? getCurrentPeriod()
}

export async function getPeriods(): Promise<AipPeriod[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aip_periods').select('*').order('year', { ascending: false })
  return (data ?? []) as AipPeriod[]
}

export interface AipListRow extends AipTotals {
  period_year: number
  open_returns: number
}

/** The submissions table: one row per department AIP, with its rollup. */
export async function listAips(periodId: string): Promise<AipListRow[]> {
  const supabase = await createClient()

  const [{ data: totals }, { data: period }, { data: returns }] = await Promise.all([
    supabase.from('v_aip_totals').select('*').eq('period_id', periodId),
    supabase.from('aip_periods').select('year').eq('id', periodId).maybeSingle<{ year: number }>(),
    supabase.from('v_ppa_rows').select('aip_id').eq('period_id', periodId).eq('is_returned', true),
  ])

  const openReturns = new Map<string, number>()
  for (const row of (returns ?? []) as { aip_id: string }[]) {
    openReturns.set(row.aip_id, (openReturns.get(row.aip_id) ?? 0) + 1)
  }

  return ((totals ?? []) as AipTotals[])
    .map((t) => ({
      ...t,
      period_year: period?.year ?? 0,
      open_returns: openReturns.get(t.aip_id) ?? 0,
    }))
    .sort((a, b) =>
      a.sector_sort - b.sector_sort ||
      a.department_sort - b.department_sort ||
      (a.supplemental_no ?? 0) - (b.supplemental_no ?? 0))
}

export interface AipDetail {
  aip: Aip
  /** "20% CDF" when this document is a statutory filing, else null. */
  fundLabel: string | null
  period: AipPeriod
  department: Department
  rows: PpaRowView[]
  totals: AipTotals | null
  /**
   * The department's other submissions OF THIS DOCUMENT for the period: the
   * annual one and any supplementals. A supplemental only ever ADDS PPAs — it
   * never amends the annual AIP's rows — so the two are read side by side
   * rather than merged.
   *
   * Scoped to the same fund. The switcher states a combined figure, and a
   * combined figure spanning the annual programme and the 20% CDF would be a
   * total no office ever approved — the two are separate documents precisely
   * so that they are never added together.
   */
  siblings: AipTotals[]
}

export async function getAipDetail(aipId: string): Promise<AipDetail | null> {
  const supabase = await createClient()

  const { data: aip } = await supabase
    .from('aips').select('*').eq('id', aipId).maybeSingle<Aip>()
  if (!aip) return null

  const [
    { data: period }, { data: department }, { data: rows },
    { data: totals }, { data: siblings },
  ] = await Promise.all([
    supabase.from('aip_periods').select('*').eq('id', aip.period_id).maybeSingle<AipPeriod>(),
    supabase.from('departments').select('*').eq('id', aip.department_id).maybeSingle<Department>(),
    supabase.from('v_ppa_rows').select('*').eq('aip_id', aipId),
    supabase.from('v_aip_totals').select('*').eq('aip_id', aipId).maybeSingle<AipTotals>(),
    supabase.from('v_aip_totals').select('*')
      .eq('period_id', aip.period_id).eq('department_id', aip.department_id),
  ])

  if (!period || !department) return null

  return {
    aip,
    // Read from the aips row rather than the first PPA, so a statutory document
    // with nothing in it yet still knows which fund it is — which is exactly
    // when the first row needs its column (7) filled in.
    fundLabel: (totals as AipTotals | null)?.fund_label ?? null,
    period,
    department,
    rows: sortWorksheet((rows ?? []) as PpaRowView[]),
    totals: totals ?? null,
    siblings: sortSubmissions(
      ((siblings ?? []) as AipTotals[])
        .filter((s) => (s.fund_id ?? null) === (aip.fund_id ?? null))),
  }
}

/** Annual first, then supplementals in the order they were filed. */
export function sortSubmissions(rows: AipTotals[]): AipTotals[] {
  return [...rows].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'annual' ? -1 : 1) ||
    (a.supplemental_no ?? 0) - (b.supplemental_no ?? 0))
}

/**
 * Worksheet order: sector, department, then one sort_order line per AIP that
 * headings and rows share. There is no third key — that shared line is what
 * makes "insert below this row" mean the same thing wherever it is clicked.
 */
export function sortWorksheet(rows: PpaRowView[]): PpaRowView[] {
  return [...rows].sort((a, b) =>
    a.sector_sort - b.sector_sort ||
    a.department_sort - b.department_sort ||
    a.sort_order - b.sort_order)
}

export interface ConsolidatedView {
  period: AipPeriod
  rows: PpaRowView[]
  departmentTotals: AipTotals[]
  sectorTotals: SectorTotals[]
  periodTotals: PeriodTotals | null
}

/**
 * Which document is being consolidated.
 *
 * `fundId: null` is the annual investment programme itself — the thing the AIP
 * form prints. A fund id selects that statutory programme instead, and the two
 * are never mixed: a statutory document is `kind = 'annual'` as well, so
 * filtering on kind alone would fold the 20% CDF into the GRAND TOTAL.
 */
export interface ConsolidatedTarget {
  kind: 'annual' | 'supplemental'
  fundId: string | null
}

export async function getConsolidated(
  periodId: string,
  target: ConsolidatedTarget = { kind: 'annual', fundId: null },
): Promise<ConsolidatedView | null> {
  const supabase = await createClient()

  const { data: period } = await supabase
    .from('aip_periods').select('*').eq('id', periodId).maybeSingle<AipPeriod>()
  if (!period) return null

  const { kind, fundId } = target

  const rowQuery = supabase.from('v_ppa_rows').select('*')
    .eq('period_id', periodId).eq('aip_kind', kind)
  const deptQuery = supabase.from('v_aip_totals').select('*')
    .eq('period_id', periodId).eq('kind', kind)
  const sectorQuery = supabase.from('v_sector_totals').select('*')
    .eq('period_id', periodId).eq('kind', kind)
  const periodQuery = supabase.from('v_period_totals').select('*')
    .eq('period_id', periodId).eq('kind', kind)

  const [{ data: rows }, { data: departmentTotals }, { data: sectorTotals }, { data: periodTotals }] =
    await Promise.all([
      fundId ? rowQuery.eq('fund_id', fundId) : rowQuery.is('fund_id', null),
      fundId ? deptQuery.eq('fund_id', fundId) : deptQuery.is('fund_id', null),
      fundId ? sectorQuery.eq('fund_id', fundId) : sectorQuery.is('fund_id', null),
      (fundId ? periodQuery.eq('fund_id', fundId) : periodQuery.is('fund_id', null))
        .maybeSingle<PeriodTotals>(),
    ])

  return {
    period,
    rows: sortWorksheet((rows ?? []) as PpaRowView[]),
    departmentTotals: (departmentTotals ?? []) as AipTotals[],
    sectorTotals: (sectorTotals ?? []) as SectorTotals[],
    periodTotals: periodTotals ?? null,
  }
}

/**
 * Every change ever made to one row of the programme, newest first.
 *
 * Read through the RLS-bound client like everything else here: `v_ppa_revisions`
 * is security_invoker, so `ppa_revisions_read` still judges it and this
 * function grants nobody anything. The trail is append-only in the database —
 * there is no UPDATE policy and no DELETE policy on `ppa_revisions`, for
 * anyone — so what comes back is what happened.
 */
export async function getRowHistory(ppaId: string): Promise<PpaRevision[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_ppa_revisions').select('*')
    .eq('ppa_id', ppaId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
  return (data ?? []) as PpaRevision[]
}
