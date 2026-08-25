// Server-side reads for the AIP screens.
//
// Every query goes through the RLS-bound client, so what comes back is already
// what the caller is allowed to see. Totals are read from the views and never
// re-summed here.

import { createClient } from '@/lib/supabase/server'
import type {
  Aip, AipPeriod, AipTotals, Department, PeriodTotals, PpaGroup, PpaRowView,
  SectorTotals,
} from '@/types/tracks'

export async function getCurrentPeriod(): Promise<AipPeriod | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aip_periods').select('*').order('year', { ascending: false }).limit(1)
    .maybeSingle<AipPeriod>()
  return data
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
  period: AipPeriod
  department: Department
  rows: PpaRowView[]
  groups: PpaGroup[]
  totals: AipTotals | null
  /**
   * The department's other submissions for this period: the annual one and any
   * supplementals. A supplemental only ever ADDS PPAs — it never amends the
   * annual AIP's rows — so the two are read side by side rather than merged.
   */
  siblings: AipTotals[]
}

export async function getAipDetail(aipId: string): Promise<AipDetail | null> {
  const supabase = await createClient()

  const { data: aip } = await supabase
    .from('aips').select('*').eq('id', aipId).maybeSingle<Aip>()
  if (!aip) return null

  const [
    { data: period }, { data: department }, { data: rows }, { data: groups },
    { data: totals }, { data: siblings },
  ] = await Promise.all([
    supabase.from('aip_periods').select('*').eq('id', aip.period_id).maybeSingle<AipPeriod>(),
    supabase.from('departments').select('*').eq('id', aip.department_id).maybeSingle<Department>(),
    supabase.from('v_ppa_rows').select('*').eq('aip_id', aipId),
    supabase.from('ppa_groups').select('*').eq('aip_id', aipId).order('sort_order'),
    supabase.from('v_aip_totals').select('*').eq('aip_id', aipId).maybeSingle<AipTotals>(),
    supabase.from('v_aip_totals').select('*')
      .eq('period_id', aip.period_id).eq('department_id', aip.department_id),
  ])

  if (!period || !department) return null

  return {
    aip,
    period,
    department,
    rows: sortWorksheet((rows ?? []) as PpaRowView[]),
    groups: (groups ?? []) as PpaGroup[],
    totals: totals ?? null,
    siblings: sortSubmissions((siblings ?? []) as AipTotals[]),
  }
}

/** Annual first, then supplementals in the order they were filed. */
export function sortSubmissions(rows: AipTotals[]): AipTotals[] {
  return [...rows].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'annual' ? -1 : 1) ||
    (a.supplemental_no ?? 0) - (b.supplemental_no ?? 0))
}

/** "Annual Investment Program" / "Supplemental AIP No. 2". */
export function submissionLabel(
  submission: Pick<AipTotals, 'kind' | 'supplemental_no'>,
): string {
  return submission.kind === 'supplemental'
    ? `Supplemental AIP No. ${submission.supplemental_no}`
    : 'Annual Investment Program'
}

/** Worksheet order: sector, department, then the column-C tree, then the row. */
export function sortWorksheet(rows: PpaRowView[]): PpaRowView[] {
  return [...rows].sort((a, b) =>
    a.sector_sort - b.sector_sort ||
    a.department_sort - b.department_sort ||
    comparePath(a.group_sort_path, b.group_sort_path) ||
    a.sort_order - b.sort_order)
}

function comparePath(a: number[] | null, b: number[] | null): number {
  const left = a ?? []
  const right = b ?? []
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface ConsolidatedView {
  period: AipPeriod
  rows: PpaRowView[]
  departmentTotals: AipTotals[]
  sectorTotals: SectorTotals[]
  periodTotals: PeriodTotals | null
}

export async function getConsolidated(
  periodId: string,
  kind: 'annual' | 'supplemental' = 'annual',
): Promise<ConsolidatedView | null> {
  const supabase = await createClient()

  const { data: period } = await supabase
    .from('aip_periods').select('*').eq('id', periodId).maybeSingle<AipPeriod>()
  if (!period) return null

  const [{ data: rows }, { data: departmentTotals }, { data: sectorTotals }, { data: periodTotals }] =
    await Promise.all([
      supabase.from('v_ppa_rows').select('*').eq('period_id', periodId).eq('aip_kind', kind),
      supabase.from('v_aip_totals').select('*').eq('period_id', periodId).eq('kind', kind),
      supabase.from('v_sector_totals').select('*').eq('period_id', periodId).eq('kind', kind),
      supabase.from('v_period_totals').select('*').eq('period_id', periodId).eq('kind', kind)
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
