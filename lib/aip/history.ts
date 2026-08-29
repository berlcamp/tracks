// One PPA row's audit trail, turned into sentences.
//
// `tracks.ppa_revisions` is deliberately mechanical: it stores the column name
// and the raw jsonb on either side, because a trail that summarised at write
// time would be a trail that could be wrong. Reading it back is where the
// column becomes "MOOE (9)" and 800000 becomes "800,000.00" — here, in a pure
// function, so the panel that shows it is tested rather than eyeballed.
//
// This file never decides who may SEE a revision. That is `ppa_revisions_read`,
// and `v_ppa_revisions` is security_invoker so the policy still judges it.

import { moneyTotal, schedule } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/auth/permissions'
import type { PpaRevision } from '@/types/tracks'

/**
 * The AIP form's own column names, so the trail reads in the vocabulary of the
 * printed document rather than of the table. A column with no entry here is
 * shown under its own name — an unknown field is still a change, and hiding it
 * would make the trail quietly incomplete.
 */
export const FIELD_LABELS: Record<string, string> = {
  ref_code: 'AIP Ref. Code (1)',
  description: 'Program / Project / Activity (2)',
  implementing_office: 'Implementing Office (3)',
  start_date: 'Start of implementation (4)',
  end_date: 'Completion (5)',
  expected_output: 'Expected Output (6)',
  funding_source: 'Funding Source (7)',
  amount_ps: 'Personal Services (8)',
  amount_mooe: 'MOOE (9)',
  amount_fe: 'Financial Expenses (10)',
  amount_co: 'Capital Outlay (11)',
  cca_amount: 'Climate Change Adaptation (13)',
  ccm_amount: 'Climate Change Mitigation (14)',
  cc_typology_code: 'CC Typology Code (15)',
  row_kind: 'Kind of row',
  sort_order: 'Position in the document',
  department_id: 'Office',
  aip_id: 'Document',
  created_by: 'Encoded by',
  continues_ppa_id: 'Continued from',
}

const MONEY_FIELDS = new Set([
  'amount_ps', 'amount_mooe', 'amount_fe', 'amount_co', 'cca_amount', 'ccm_amount',
])
const DATE_FIELDS = new Set(['start_date', 'end_date'])

/** Columns whose value is an id nobody can read. Shown as changed, not as a value. */
const OPAQUE_FIELDS = new Set([
  'id', 'aip_id', 'department_id', 'created_by', 'continues_ppa_id',
])

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** One column's before and after, ready to print. */
export interface FieldChange {
  field: string
  label: string
  from: string
  to: string
}

/** An empty column reads as a dash, not as an empty cell nobody notices. */
const BLANK = '—'

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return BLANK
  if (OPAQUE_FIELDS.has(field)) return 'set'
  if (MONEY_FIELDS.has(field)) return moneyTotal(value as number | string)
  if (DATE_FIELDS.has(field)) return schedule(String(value))
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/**
 * What actually changed, in the order the AIP form prints its columns — so a
 * revision touching the description and the MOOE reads down the way the row
 * does, whatever order Postgres happened to collect the keys in.
 */
const FIELD_ORDER = Object.keys(FIELD_LABELS)

export function changesOf(revision: PpaRevision): FieldChange[] {
  if (revision.action !== 'update') return []
  const fields = [...revision.changed_fields].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a)
    const ib = FIELD_ORDER.indexOf(b)
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  })
  return fields.map((field) => ({
    field,
    label: fieldLabel(field),
    from: formatValue(field, revision.old_values?.[field]),
    to: formatValue(field, revision.new_values?.[field]),
  }))
}

/**
 * The one line the entry leads with.
 *
 * A revision whose only changed column is `sort_order` is a row that moved:
 * inserting above an existing row shifts every row beneath it, and reporting
 * fourteen of those as "changed" would bury the one edit that mattered.
 */
export function headlineOf(revision: PpaRevision): string {
  if (revision.action === 'create') return 'Row added'
  if (revision.action === 'delete') return 'Row deleted'
  const fields = revision.changed_fields
  if (fields.length === 1 && fields[0] === 'sort_order') return 'Moved in the document'
  return fields.length === 1 && fields[0]
    ? `Changed ${fieldLabel(fields[0])}`
    : `Changed ${fields.length} fields`
}

/**
 * Who made the change, and in what capacity.
 *
 * The capacity is the half the office reads this for: an overwrite by the City
 * Planning Sector Officer of a figure a department encoded is the thing worth
 * seeing at a glance. Null on anything recorded before the role was stamped,
 * and the name is null if the account has since been removed — both say so
 * rather than guessing.
 */
export function actorOf(revision: PpaRevision): { name: string; capacity: string | null } {
  return {
    name: revision.changed_by_name ?? 'Account no longer on record',
    capacity: revision.changed_role ? ROLE_LABELS[revision.changed_role] ?? null : null,
  }
}

/** The description the row carried at this revision, for a create or a delete. */
export function snapshotDescription(revision: PpaRevision): string | null {
  const values = revision.action === 'delete' ? revision.old_values : revision.new_values
  const description = values?.description
  return typeof description === 'string' && description.length > 0 ? description : null
}
