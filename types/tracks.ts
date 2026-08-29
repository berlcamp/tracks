// Domain types for the `tracks` schema.
//
// Hand-written rather than generated: the generated file is regenerated from a
// running database and churns on every migration, and these are the shapes the
// UI actually consumes. Run `npm run types:gen` to refresh the generated
// companion when you need exhaustive column coverage.

export type UserRole =
  | 'dept_encoder'
  | 'dept_head'
  | 'planning_staff'
  | 'planning_admin'
  | 'budget'
  | 'accounting'
  | 'viewer'

export type AipStatus = 'draft' | 'submitted' | 'returned' | 'accepted'

export type PeriodStatus =
  | 'open' | 'consolidating' | 'for_ldc' | 'for_mayor' | 'for_council'
  | 'approved' | 'closed'

export interface Profile {
  id: string
  auth_user_id: string | null
  email: string
  full_name: string
  avatar_url: string | null
  global_role: 'super_admin' | 'user'
  active: boolean
}

export interface Sector {
  id: string
  code: string
  name: string
  sheet_name: string
  heading: string
  summary_label: string
  sort_order: number
  active: boolean
}

export interface Department {
  id: string
  sector_id: string
  code: string
  name: string
  display_name: string
  code_number: number | null
  sort_order: number
  active: boolean
}

export interface AipPeriod {
  id: string
  year: number
  title: string
  draft_label: string | null
  nta_amount: number | null
  status: PeriodStatus
}

export interface Aip {
  id: string
  period_id: string
  department_id: string
  kind: 'annual' | 'supplemental'
  supplemental_no: number | null
  status: AipStatus
  submitted_at: string | null
  accepted_at: string | null
  /** Null on the annual investment programme; set on a statutory filing. */
  fund_id: string | null
}

/** Column C is a caption row, not a container: 'header' rows carry a
 *  description and nothing else. */
export type PpaRowKind = 'ppa' | 'header'

/** Where a row has got to with whoever is reading it now. */
export type ReviewStatus = 'pending' | 'approved' | 'returned'
export type ReviewDecision = 'approved' | 'returned'
export type ReviewStage = 'department' | 'planning'

/** A row of tracks.v_ppa_rows. */
export interface PpaRowView {
  id: string
  aip_id: string
  period_id: string
  period_year: number
  aip_kind: 'annual' | 'supplemental'
  supplemental_no: number | null
  aip_status: AipStatus
  period_status: PeriodStatus
  department_id: string
  department_code: string
  department_name: string
  department_sort: number
  sector_id: string
  sector_code: string
  sector_heading: string
  sector_sheet_name: string
  sector_sort: number
  row_kind: PpaRowKind
  /** null on a header — a caption takes no number and consumes none. */
  item_no: number | null
  ref_code: string | null
  description: string
  implementing_office: string | null
  start_date: string | null
  end_date: string | null
  expected_output: string | null
  funding_source: string | null
  amount_ps: number
  amount_mooe: number
  amount_fe: number
  amount_co: number
  amount_total: number
  cca_amount: number | null
  ccm_amount: number | null
  cc_typology_code: string | null
  continues_ppa_id: string | null
  sort_order: number
  /** The department head's reading, kept beside City Planning's. */
  dept_status: ReviewStatus | null
  dept_remarks: string | null
  planning_status: ReviewStatus | null
  planning_remarks: string | null
  /** Whichever of the two applies at the AIP's current status. */
  review_status: ReviewStatus | null
  review_remarks: string | null
  /** Who wrote this row. Null on anything that predates authorship. */
  created_by: string | null
  author_name: string | null
  open_return_id: string | null
  open_return_reason: string | null
  open_return_at: string | null
  is_returned: boolean
  /** Null on the annual investment programme itself. */
  fund_id: string | null
  fund_code: string | null
  fund_label: string | null
}

/**
 * A row of tracks.v_ppa_revisions — one change to one PPA row.
 *
 * Written by trigger on every insert, update and delete of `tracks.ppas`, so
 * nothing that touches a row of the programme can miss it. `changed_role` is
 * the capacity the change was made in, stamped at the moment of the write:
 * null on anything recorded before 0018, and on anything the service role did.
 */
export interface PpaRevision {
  id: number
  ppa_id: string
  aip_id: string
  action: 'create' | 'update' | 'delete'
  changed_fields: string[]
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_by: string | null
  changed_by_name: string | null
  changed_role: UserRole | null
  changed_at: string
  row_kind: PpaRowKind | null
  department_id: string | null
  department_name: string | null
}

/** A row of tracks.v_aip_totals. */
export interface AipTotals {
  aip_id: string
  period_id: string
  department_id: string
  kind: 'annual' | 'supplemental'
  supplemental_no: number | null
  status: AipStatus
  department_code: string
  department_name: string
  code_number: number | null
  department_sort: number
  sector_id: string
  sector_code: string
  sector_summary_label: string
  sector_sort: number
  ppa_count: number
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  total_amount: number
  /** Null on the annual investment programme itself. */
  fund_id: string | null
  fund_code: string | null
  fund_label: string | null
}

export interface SectorTotals {
  period_id: string
  sector_id: string
  sector_code: string
  sector_summary_label: string
  sector_sort: number
  kind: 'annual' | 'supplemental'
  fund_id: string | null
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  total_amount: number
}

export interface PeriodTotals {
  period_id: string
  kind: 'annual' | 'supplemental'
  fund_id: string | null
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  total_amount: number
}

// ---------------------------------------------------------------------------
// Statutory funds — the 20% CDF, 5% CDRRMF, 5% GAD and 1% LCPC.
//
// Reference data, so a fifth mandated fund is an admin screen rather than a
// migration. A department's filing against one is an ordinary AIP document
// carrying `fund_id`; `kind` still says only whether it is an addition.
// ---------------------------------------------------------------------------

export interface StatutoryFund {
  id: string
  code: string
  name: string
  /** What the buttons and chips say: "20% CDF". */
  short_label: string
  /** The worksheet tab the export writes. */
  sheet_name: string
  /** 20.00, not 0.20 — the way the statute writes it. */
  percentage: number
  sort_order: number
  active: boolean
}

/** A fund with the departments allowed to file it. */
export interface StatutoryFundWithDepartments extends StatutoryFund {
  department_ids: string[]
}

/**
 * A row of tracks.v_statutory_fund_totals — programmed against the ceiling.
 *
 * `base_amount` null means the planning administrator has not stated the year's
 * base yet, so `ceiling_amount` is null too. That is a different answer from a
 * ceiling of zero and the screen shows a dash for it.
 */
export interface StatutoryFundTotals {
  fund_id: string
  fund_code: string
  fund_name: string
  fund_label: string
  sheet_name: string
  percentage: number
  sort_order: number
  active: boolean
  period_id: string
  period_year: number
  base_amount: number | null
  ceiling_amount: number | null
  programmed_amount: number
  remaining_amount: number | null
  document_count: number
}
