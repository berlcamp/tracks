// Server-side reads for the statutory funds.
//
// The ceiling comes from tracks.v_statutory_fund_totals and is never computed
// here — programmed-against-ceiling is exactly the kind of figure that must not
// exist in two places, because the two would eventually disagree and only one
// of them would be on the paper that went to the LDC.

import { createClient } from '@/lib/supabase/server'
import type {
  StatutoryFund, StatutoryFundTotals, StatutoryFundWithDepartments,
} from '@/types/tracks'

export async function listFunds(): Promise<StatutoryFund[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('statutory_funds').select('*').order('sort_order')
  return (data ?? []) as StatutoryFund[]
}

/** Every fund with its eligibility list, for the Settings screen. */
export async function listFundsWithDepartments(): Promise<StatutoryFundWithDepartments[]> {
  const supabase = await createClient()
  const [{ data: funds }, { data: links }] = await Promise.all([
    supabase.from('statutory_funds').select('*').order('sort_order'),
    supabase.from('statutory_fund_departments').select('fund_id, department_id'),
  ])

  const byFund = new Map<string, string[]>()
  for (const link of (links ?? []) as { fund_id: string; department_id: string }[]) {
    const list = byFund.get(link.fund_id)
    if (list) list.push(link.department_id)
    else byFund.set(link.fund_id, [link.department_id])
  }

  return ((funds ?? []) as StatutoryFund[]).map((fund) => ({
    ...fund,
    department_ids: byFund.get(fund.id) ?? [],
  }))
}

/**
 * The funds this department may file, minus the ones it already has open for
 * the period. A fund a department has filed is not offered again — one per
 * department per fund per year is a unique index, and offering a button that
 * can only fail is worse than offering nothing.
 */
export async function listStartableFunds(
  departmentId: string, periodId: string,
): Promise<StatutoryFund[]> {
  const supabase = await createClient()

  const [{ data: links }, { data: filed }] = await Promise.all([
    supabase.from('statutory_fund_departments')
      .select('fund_id').eq('department_id', departmentId),
    supabase.from('aips').select('fund_id')
      .eq('department_id', departmentId).eq('period_id', periodId)
      .eq('kind', 'annual').not('fund_id', 'is', null),
  ])

  const eligible = new Set(
    ((links ?? []) as { fund_id: string }[]).map((l) => l.fund_id))
  for (const row of (filed ?? []) as { fund_id: string | null }[]) {
    if (row.fund_id) eligible.delete(row.fund_id)
  }
  if (eligible.size === 0) return []

  const { data } = await supabase
    .from('statutory_funds').select('*')
    .in('id', [...eligible]).eq('active', true).order('sort_order')
  return (data ?? []) as StatutoryFund[]
}

/** Programmed against the ceiling, for one period. Active funds only. */
export async function getFundTotals(periodId: string): Promise<StatutoryFundTotals[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_statutory_fund_totals').select('*')
    .eq('period_id', periodId).eq('active', true).order('sort_order')
  return (data ?? []) as StatutoryFundTotals[]
}

export async function getFundTotal(
  periodId: string, fundId: string,
): Promise<StatutoryFundTotals | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_statutory_fund_totals').select('*')
    .eq('period_id', periodId).eq('fund_id', fundId)
    .maybeSingle<StatutoryFundTotals>()
  return data
}

/**
 * The funds with a document actually filed, for the tabs on a report.
 *
 * `departmentId` scopes it to one office: a department has no use for a
 * 5% CDRRMF tab it never files, and following it would open a report on
 * nothing. City-wide, it is every fund somebody has filed.
 *
 * NOT the eligibility list. Being listed against a fund means the office may
 * START one — a report is about what exists, so a fund it has not filed yet has
 * nothing to report and no tab. The tab appears the day the document does.
 */
export async function listFiledFunds(
  periodId: string,
  departmentId?: string | null,
): Promise<StatutoryFundTotals[]> {
  const supabase = await createClient()

  const query = supabase
    .from('aips').select('fund_id')
    .eq('period_id', periodId).not('fund_id', 'is', null)
  const { data } = await (departmentId ? query.eq('department_id', departmentId) : query)

  const filed = new Set(
    ((data ?? []) as { fund_id: string | null }[])
      .map((row) => row.fund_id)
      .filter((id): id is string => id !== null))
  if (filed.size === 0) return []

  return (await getFundTotals(periodId)).filter((f) => filed.has(f.fund_id))
}

export async function getFund(fundId: string): Promise<StatutoryFund | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('statutory_funds').select('*').eq('id', fundId)
    .maybeSingle<StatutoryFund>()
  return data
}
