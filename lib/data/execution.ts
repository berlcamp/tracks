// Reads for the execution side: allotments, obligations, disbursements and
// physical progress. Totals come from tracks.v_ppa_financials, never re-summed.

import { createClient } from '@/lib/supabase/server'
import type { AipPeriod } from '@/types/tracks'

export interface PpaFinancials {
  ppa_id: string
  aip_id: string
  department_id: string
  description: string
  approved_amount: number
  allotted: number
  obligated: number
  disbursed: number
  unobligated_balance: number
  unpaid_obligations: number
  obligation_rate: number | null
  disbursement_rate: number | null
  physical_percent: number | null
  physical_as_of: string | null
}

/** A row of tracks.v_monitoring — the AIP form plus its execution columns. */
export interface MonitoringRow extends PpaFinancials {
  period_id: string
  period_year: number
  aip_kind: 'annual' | 'supplemental'
  /** Null on the annual investment programme; set on a statutory filing. */
  fund_id: string | null
  fund_code: string | null
  fund_label: string | null
  department_code: string
  department_name: string
  sector_id: string
  sector_code: string
  sector_heading: string
  item_no: number
  ref_code: string | null
  implementing_office: string | null
  start_date: string | null
  end_date: string | null
  expected_output: string | null
  funding_source: string | null
  group_sort_path: number[]
  sort_order: number
}

/**
 * Every PPA of a period with its money, for the report and for the worklist.
 *
 * This used to filter `aip_kind = 'annual'`, which quietly hid every
 * supplemental PPA from Budget and Accounting: the rows existed, were reviewed
 * and accepted, and then could never be allotted against because they never
 * reached the worklist. Statutory money is real money and so is a
 * supplemental's, so the filter is gone.
 *
 * `document` narrows the report to one document. The worklist passes nothing —
 * a clerk wants every outstanding OBR in one place, whichever programme it is
 * drawn on, and the fund is a column rather than a separate list.
 */
export async function getMonitoring(
  periodId: string,
  document?: { fundId: string | null },
): Promise<MonitoringRow[]> {
  const supabase = await createClient()
  const query = supabase.from('v_monitoring').select('*').eq('period_id', periodId)
  const { data } = await (document
    ? (document.fundId ? query.eq('fund_id', document.fundId) : query.is('fund_id', null))
    : query)
  return sortMonitoring((data ?? []) as MonitoringRow[])
}

export function sortMonitoring(rows: MonitoringRow[]): MonitoringRow[] {
  return [...rows].sort((a, b) =>
    a.sector_code.localeCompare(b.sector_code) ||
    a.department_code.localeCompare(b.department_code) ||
    // Every document numbers its own rows from 1, so without this key one
    // office's item 1 of the AIP and item 1 of its 20% CDF sort together.
    (a.fund_label ?? '').localeCompare(b.fund_label ?? '') ||
    a.item_no - b.item_no)
}

export interface Obligation {
  id: string
  ppa_id: string
  obr_no: string | null
  obligation_date: string
  payee: string | null
  particulars: string | null
  amount: number
  status: 'active' | 'cancelled'
  cancel_reason: string | null
}

export interface Disbursement {
  id: string
  ppa_id: string
  obligation_id: string | null
  dv_no: string | null
  check_ada_no: string | null
  disbursement_date: string
  payee: string | null
  particulars: string | null
  amount: number
  status: 'active' | 'cancelled'
}

export interface Allotment {
  id: string
  ppa_id: string
  amount: number
  allotment_date: string
  reference_no: string | null
  remarks: string | null
}

export interface PpaLedger {
  financials: PpaFinancials | null
  allotments: Allotment[]
  obligations: Obligation[]
  disbursements: Disbursement[]
  progress: Array<{ id: string; as_of_date: string; percent_complete: number; remarks: string | null }>
}

export async function getPpaLedger(ppaId: string): Promise<PpaLedger> {
  const supabase = await createClient()

  const [financials, allotments, obligations, disbursements, progress] = await Promise.all([
    supabase.from('v_ppa_financials').select('*').eq('ppa_id', ppaId).maybeSingle<PpaFinancials>(),
    supabase.from('allotments').select('*').eq('ppa_id', ppaId).order('allotment_date'),
    supabase.from('obligations').select('*').eq('ppa_id', ppaId).order('obligation_date'),
    supabase.from('disbursements').select('*').eq('ppa_id', ppaId).order('disbursement_date'),
    supabase.from('ppa_progress').select('*').eq('ppa_id', ppaId)
      .order('as_of_date', { ascending: false }),
  ])

  return {
    financials: financials.data ?? null,
    allotments: (allotments.data ?? []) as Allotment[],
    obligations: (obligations.data ?? []) as Obligation[],
    disbursements: (disbursements.data ?? []) as Disbursement[],
    progress: (progress.data ?? []) as PpaLedger['progress'],
  }
}

export interface UtilisationSummary {
  approved: number
  allotted: number
  obligated: number
  disbursed: number
}

/** Programme-level roll-up for the monitoring header. */
export function summarise(rows: MonitoringRow[]): UtilisationSummary {
  return rows.reduce(
    (acc, row) => ({
      approved: acc.approved + Number(row.approved_amount),
      allotted: acc.allotted + Number(row.allotted),
      obligated: acc.obligated + Number(row.obligated),
      disbursed: acc.disbursed + Number(row.disbursed),
    }),
    { approved: 0, allotted: 0, obligated: 0, disbursed: 0 },
  )
}

export type { AipPeriod }
