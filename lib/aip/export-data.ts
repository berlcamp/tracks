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

/** The consolidated workbook: SUMMARY plus one sheet per sector. */
export async function buildConsolidatedExportData(
  periodId: string,
  kind: 'annual' | 'supplemental' = 'annual',
): Promise<{ data: AipExportData; period: AipPeriod } | null> {
  const supabase = await createClient()

  const { data: period } = await supabase
    .from('aip_periods').select('*').eq('id', periodId).maybeSingle<AipPeriod>()
  if (!period) return null

  const ref = await reference(supabase)

  const [{ data: rows }, { data: departmentTotals }, { data: sectorTotals }, { data: periodTotals }] =
    await Promise.all([
      supabase.from('v_ppa_rows').select('*').eq('period_id', periodId).eq('aip_kind', kind),
      supabase.from('v_aip_totals').select('*').eq('period_id', periodId).eq('kind', kind),
      supabase.from('v_sector_totals').select('*').eq('period_id', periodId).eq('kind', kind),
      supabase.from('v_period_totals').select('*').eq('period_id', periodId).eq('kind', kind)
        .maybeSingle(),
    ])

  const data = assembleExportData({
    year: period.year,
    lguName: ref.lguName,
    lguType: ref.lguType,
    draftLabel: period.draft_label,
    ntaAmount: period.nta_amount === null ? null : Number(period.nta_amount),
    scope: 'consolidated',
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

  return { data, period }
}

/** One department's own workbook: its sector sheet only, no SUMMARY. */
export async function buildDepartmentExportData(
  aipId: string,
): Promise<{ data: AipExportData; filename: string } | null> {
  const supabase = await createClient()

  const { data: aip } = await supabase
    .from('aips').select('id, period_id, department_id, kind, supplemental_no')
    .eq('id', aipId).maybeSingle<{
      id: string; period_id: string; department_id: string
      kind: 'annual' | 'supplemental'; supplemental_no: number | null
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
    scope: 'department',
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
  return { data, filename: `CY${period.year}-AIP-${department?.code ?? 'Department'}${suffix}.xlsx` }
}

/** Worksheet order, matching tracks.v_ppa_rows' own ordering columns. */
function sortForExport(rows: VPpaRow[]): VPpaRow[] {
  return [...rows].sort((a, b) =>
    Number(a.sector_sort) - Number(b.sector_sort) ||
    Number(a.department_sort) - Number(b.department_sort) ||
    Number(a.item_no) - Number(b.item_no))
}
