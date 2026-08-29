'use client'

import { useCallback, useState } from 'react'
import { AipGrid } from './aip-grid'
import { PpaDialog } from './ppa-dialog'
import { RowHistoryDialog } from './row-history'
import { canEditPpa, contextForRow, lockOf, type Viewer } from '@/lib/auth/permissions'
import type { PpaRowView } from '@/types/tracks'

/**
 * The whole programme, every sector and department, on one screen.
 *
 * It used to be flatly read-only, on the reasoning that an overwrite made here
 * — two thousand rows on screen, no submission context — is the kind that gets
 * noticed a month later. The office asked for the opposite: City Planning
 * consolidates from this screen and correcting a line means leaving it, finding
 * the office's submission and coming back.
 *
 * So editing is open here to exactly whoever `tracks.can_edit_ppa` already
 * allows — which is City Planning, per row, until the period leaves
 * `consolidating`. Two things make that safe rather than merely convenient:
 *
 *   * the lock is asked PER ROW, not per screen. Each row carries its own AIP's
 *     status and its own office, so `contextForRow` gives `canEditPpa` the same
 *     three facts it gets on a submission screen and the answer is the same one.
 *     A department user reading this page (Budget, Accounting, a viewer) gets
 *     no menu, because the same function says no.
 *
 *   * every change is on the record. `ppa_revisions` is written by trigger with
 *     the original value and the capacity the change was made in, and the
 *     History item in each row's menu is where the office reads it back. An
 *     overwrite of a department's figure is visible to that department.
 *
 * Adding and deleting rows stay on the submission screen. A row's existence is
 * the office's submission; its figures are what City Planning consolidates.
 */
export function ConsolidatedGrid({ rows, viewer }: {
  rows: PpaRowView[]
  viewer: Viewer
}) {
  const [editing, setEditing] = useState<PpaRowView | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [history, setHistory] = useState<PpaRowView | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const canEdit = useCallback(
    (row: PpaRowView) => canEditPpa(contextForRow(viewer, row), lockOf(row)),
    [viewer],
  )

  return (
    <>
      <AipGrid
        rows={rows}
        canEdit={canEdit}
        canAddRow={false}
        showDepartmentBands
        onEdit={(row) => { setEditing(row); setDialogOpen(true) }}
        onHistory={(row) => { setHistory(row); setHistoryOpen(true) }}
      />

      {/* The document a row belongs to is the row's own, not the screen's: this
          grid spans every office's submission, so the dialog is handed the AIP
          the row is actually in and the fund it is drawn on. */}
      {editing ? (
        <PpaDialog
          aipId={editing.aip_id}
          row={editing}
          fundLabel={editing.fund_label}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}

      <RowHistoryDialog row={history} open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  )
}
