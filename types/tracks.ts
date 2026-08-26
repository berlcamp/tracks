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
  open_return_id: string | null
  open_return_reason: string | null
  open_return_at: string | null
  is_returned: boolean
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
}

export interface SectorTotals {
  period_id: string
  sector_id: string
  sector_code: string
  sector_summary_label: string
  sector_sort: number
  kind: 'annual' | 'supplemental'
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  total_amount: number
}

export interface PeriodTotals {
  period_id: string
  kind: 'annual' | 'supplemental'
  total_ps: number
  total_mooe: number
  total_fe: number
  total_co: number
  total_amount: number
}
