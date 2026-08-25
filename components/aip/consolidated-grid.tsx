'use client'

import { AipGrid } from './aip-grid'
import type { PpaRowView } from '@/types/tracks'

/**
 * The whole programme, every sector and department, read-only.
 *
 * City Planning edits through the individual submission screens, where the
 * department and its status are in view — an overwrite made here, with two
 * thousand rows on screen and no submission context, is the kind that gets
 * noticed a month later.
 */
export function ConsolidatedGrid({ rows }: { rows: PpaRowView[] }) {
  return (
    <AipGrid
      rows={rows}
      canEdit={() => false}
      canAddRow={false}
      canReturnItems={false}
      showDepartmentBands
    />
  )
}
