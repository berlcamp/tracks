// Assembles the exporter's input from the database, through the RLS-bound
// client — a department exporting the consolidated programme gets exactly what
// it is allowed to read, and nothing is filtered in application code.

import { createClient } from '@/lib/supabase/server'
import { assembleExportData } from './assemble'
import { toAmountSet, toDepartmentTotal, toPpaRowSource, toSectorTotal, type VPpaRow } from './query'
import type { AipExportData } from './types'
import type { AipPeriod } from '@/types/tracks'

interface SectorRow { id: string; summary_label: string }
interface DepartmentRow { id: string; code_number: number | null }
interface LguRow { lgu_name: string; lgu_type: string }

async function reference(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: sectors }, { data: departments }, { data: lgu }] = await Promise.all([
    supabase.from('sectors').select('id, summary_label'),
    supabase.from('departments').select('id, code_number'),
    supabase.from('lgu_settings').select('lgu_name, lgu_type').maybeSingle<LguRow>(),
  ])

  return {
    summaryLabels: new Map(
      ((sectors ?? []) as SectorRow[]).map((s) => [s.id, s.summary_label])),
    codeNumbers: new Map(
      ((departments ?? []) as DepartmentRow[]).map((d) => [d.id, d.code_number])),
    lguName: lgu?.lgu_name ?? 'Bayugan',
    lguType: lgu?.lgu_type ?? 'City',
  }
}

/**
 * The consolidated workbook: SUMMARY plus one sheet per sector.
 *
 * With a fund id it is that statutory fund instead — every sector on one sheet
 * named after the fund, and no SUMMARY. The two are never mixed: a statutory
 * document is `kind = 'annual'` as well, so filtering on kind alone would fold
 * the 20% CDF into the AIP's grand total.
 */
export async function buildConsolidatedExportData(
  periodId: string,
  kind: 'annual' | 'supplemental' = 'annual',
  fundId: string | null = null,
): Promise<{ data: AipExportData; period: AipPeriod; fundLabel: string | null } | null> {
  const supabase = await createClient()

  const { data: period } = await supabase
    .from('aip_periods').select('*').eq('id', periodId).maybeSingle<AipPeriod>()
  if (!period) return null

  const ref = await reference(supabase)

  const fund = fundId
    ? (await supabase.from('statutory_funds')
        .select('name, short_label, sheet_name').eq('id', fundId)
        .maybeSingle<{ name: string; short_label: string; sheet_name: string }>()).data
    : null
  if (fundId && !fund) return null

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
        .maybeSingle(),
    ])

  const data = assembleExportData({
    year: period.year,
    lguName: ref.lguName,
    lguType: ref.lguType,
    draftLabel: period.draft_label,
    // SUMMARY's loose NTA figure belongs to the annual programme's own sheet.
    ntaAmount: fund ? null : period.nta_amount === null ? null : Number(period.nta_amount),
    scope: fund ? 'fund' : 'consolidated',
    fund: fund
      ? { sheetName: fund.sheet_name, title: fund.name.toUpperCase() }
      : null,
    rows: sortForExport((rows ?? []) as VPpaRow[]).map((row) =>
      toPpaRowSource(row, {
        summaryLabel: ref.summaryLabels.get(row.sector_id) ?? row.sector_heading,
        codeNumber: ref.codeNumbers.get(row.department_id) ?? null,
      })),
    departmentTotals: (departmentTotals ?? []).map(toDepartmentTotal),
    sectorTotals: (sectorTotals ?? []).map(toSectorTotal),
    grandTotals: periodTotals
      ? toAmountSet(periodTotals)
      : { ps: 0, mooe: 0, fe: 0, co: 0, total: 0 },
  })

  return { data, period, fundLabel: fund?.short_label ?? null }
}

/** One department's own workbook: its sector sheet only, no SUMMARY. */
export async function buildDepartmentExportData(
  aipId: string,
): Promise<{ data: AipExportData; filename: string } | null> {
  const supabase = await createClient()

  const { data: aip } = await supabase
    .from('aips')
    .select('id, period_id, department_id, kind, supplemental_no, fund_id, '
            + 'fund:statutory_funds(name, short_label, sheet_name)')
    .eq('id', aipId).maybeSingle<{
      id: string; period_id: string; department_id: string
      kind: 'annual' | 'supplemental'; supplemental_no: number | null
      fund_id: string | null
      fund: { name: string; short_label: string; sheet_name: string } | null
    }>()
  if (!aip) return null

  const { data: period } = await supabase
    .from('aip_periods').select('*').eq('id', aip.period_id).maybeSingle<AipPeriod>()
  if (!period) return null

  const ref = await reference(supabase)

  const [{ data: rows }, { data: departmentTotals }, { data: department }] = await Promise.all([
    supabase.from('v_ppa_rows').select('*').eq('aip_id', aipId),
    supabase.from('v_aip_totals').select('*').eq('aip_id', aipId),
    supabase.from('departments').select('code').eq('id', aip.department_id)
      .maybeSingle<{ code: string }>(),
  ])

  const totals = (departmentTotals ?? [])[0]
  const amountSet = totals ? toAmountSet(totals) : { ps: 0, mooe: 0, fe: 0, co: 0, total: 0 }

  const data = assembleExportData({
    year: period.year,
    lguName: ref.lguName,
    lguType: ref.lguType,
    draftLabel: period.draft_label,
    ntaAmount: null,
    scope: aip.fund ? 'fund' : 'department',
    fund: aip.fund
      ? { sheetName: aip.fund.sheet_name, title: aip.fund.name.toUpperCase() }
      : null,
    supplementalNo: aip.supplemental_no,
    rows: sortForExport((rows ?? []) as VPpaRow[]).map((row) =>
      toPpaRowSource(row, {
        summaryLabel: ref.summaryLabels.get(row.sector_id) ?? row.sector_heading,
        codeNumber: ref.codeNumbers.get(row.department_id) ?? null,
      })),
    departmentTotals: (departmentTotals ?? []).map(toDepartmentTotal),
    // A department worksheet still closes with its sector band total, and for a
    // single-department export that total is the department's own.
    sectorTotals: rows && rows.length > 0
      ? [{ sectorId: (rows[0] as VPpaRow).sector_id, ...amountSet }]
      : [],
    grandTotals: amountSet,
  })

  const suffix = aip.kind === 'supplemental' ? `-SP${aip.supplemental_no}` : ''
  const form = aip.fund ? slug(aip.fund.short_label) : 'AIP'
  return {
    data,
    filename: `CY${period.year}-${form}-${department?.code ?? 'Department'}${suffix}.xlsx`,
  }
}

/**
 * Worksheet order — the same three keys as sortWorksheet() in lib/data/aip.ts,
 * because the screen and the printout are the same document.
 *
 * NOT item_no. A heading has none, and Number(null) is 0, which sorted every
 * caption ahead of every row: the workbook opened with all of a department's
 * headings stacked together and the programme underneath. sort_order is the one
 * line both kinds of row share, and it is what the grid orders by.
 */
function sortForExport(rows: VPpaRow[]): VPpaRow[] {
  return [...rows].sort((a, b) =>
    Number(a.sector_sort) - Number(b.sector_sort) ||
    Number(a.department_sort) - Number(b.department_sort) ||
    Number(a.sort_order) - Number(b.sort_order))
}

/** A label safe in a filename: "20% CDF" becomes "20-CDF". */
export function slug(label: string): string {
  return label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Fund'
}

export const __test = { sortForExport, slug }
