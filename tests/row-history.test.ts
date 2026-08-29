// The audit trail, read back.
//
// `tracks.ppa_revisions` stores column names and raw jsonb because a trail that
// summarised at write time could be wrong about what happened. Everything that
// turns that into a sentence lives in lib/aip/history.ts, so it is asserted
// here rather than eyeballed in a dialog.

import { describe, expect, it } from 'vitest'
import {
  actorOf, changesOf, fieldLabel, formatValue, headlineOf, snapshotDescription,
} from '@/lib/aip/history'
import type { PpaRevision } from '@/types/tracks'

function revision(overrides: Partial<PpaRevision> = {}): PpaRevision {
  return {
    id: 1,
    ppa_id: 'ppa-1',
    aip_id: 'aip-1',
    action: 'update',
    changed_fields: [],
    old_values: null,
    new_values: null,
    changed_by: 'profile-plan',
    changed_by_name: 'Maria Santos',
    changed_role: 'planning_staff',
    changed_at: '2026-09-03T06:41:00Z',
    row_kind: 'ppa',
    department_id: 'dep-cho',
    department_name: 'City Health Office',
    ...overrides,
  }
}

describe('formatValue', () => {
  it('prints money the way the AIP form prints it, zero included', () => {
    expect(formatValue('amount_mooe', 800000)).toBe('800,000.00')
    expect(formatValue('amount_mooe', 0)).toBe('0.00')
    expect(formatValue('amount_co', '1250000.50')).toBe('1,250,000.50')
  })

  it('prints a schedule as the month and year, as column (4) does', () => {
    expect(formatValue('start_date', '2027-01-01')).toBe('January 2027')
  })

  it('shows a cleared column as a dash rather than as nothing at all', () => {
    expect(formatValue('ref_code', null)).toBe('—')
    expect(formatValue('description', '')).toBe('—')
  })

  it('does not print an id nobody can read', () => {
    expect(formatValue('created_by', 'e3f1…')).toBe('set')
    expect(formatValue('created_by', null)).toBe('—')
  })
})

describe('fieldLabel', () => {
  it('names columns as the printed form names them', () => {
    expect(fieldLabel('amount_mooe')).toBe('MOOE (9)')
    expect(fieldLabel('funding_source')).toBe('Funding Source (7)')
  })

  it('falls back to the column name, so an unknown change is still shown', () => {
    expect(fieldLabel('some_new_column')).toBe('some_new_column')
  })
})

describe('changesOf', () => {
  it('gives before and after for every changed column', () => {
    const changes = changesOf(revision({
      changed_fields: ['amount_mooe', 'description'],
      old_values: { amount_mooe: 1200000, description: 'Barangay road' },
      new_values: { amount_mooe: 800000, description: 'Barangay road, Phase 1' },
    }))
    expect(changes).toEqual([
      {
        field: 'description',
        label: 'Program / Project / Activity (2)',
        from: 'Barangay road',
        to: 'Barangay road, Phase 1',
      },
      {
        field: 'amount_mooe',
        label: 'MOOE (9)',
        from: '1,200,000.00',
        to: '800,000.00',
      },
    ])
  })

  it('reads down in the order the form prints its columns', () => {
    const changes = changesOf(revision({
      changed_fields: ['amount_co', 'ref_code', 'amount_ps'],
      old_values: {}, new_values: {},
    }))
    expect(changes.map((c) => c.field)).toEqual(['ref_code', 'amount_ps', 'amount_co'])
  })

  it('has nothing to diff on a create or a delete', () => {
    expect(changesOf(revision({ action: 'create' }))).toEqual([])
    expect(changesOf(revision({ action: 'delete' }))).toEqual([])
  })
})

describe('headlineOf', () => {
  it('names the one column when only one moved', () => {
    expect(headlineOf(revision({ changed_fields: ['amount_mooe'] })))
      .toBe('Changed MOOE (9)')
  })

  it('counts them when several did', () => {
    expect(headlineOf(revision({ changed_fields: ['amount_mooe', 'description'] })))
      .toBe('Changed 2 fields')
  })

  // Inserting a row above another shifts every row beneath it, and each shift
  // is an honest revision. Reporting fourteen of them as "changed" would bury
  // the one edit that mattered.
  it('calls a bare sort_order shift what it is — a row that moved', () => {
    expect(headlineOf(revision({ changed_fields: ['sort_order'] })))
      .toBe('Moved in the document')
  })

  it('does not call it a move when the position changed alongside something else', () => {
    expect(headlineOf(revision({ changed_fields: ['sort_order', 'amount_ps'] })))
      .toBe('Changed 2 fields')
  })

  it('says plainly when the row was added or removed', () => {
    expect(headlineOf(revision({ action: 'create' }))).toBe('Row added')
    expect(headlineOf(revision({ action: 'delete' }))).toBe('Row deleted')
  })
})

describe('actorOf', () => {
  // The capacity is the half the office reads this for: an overwrite of a
  // department's figure by City Planning is the thing worth seeing at a glance.
  it('names the capacity the change was made in', () => {
    expect(actorOf(revision())).toEqual({
      name: 'Maria Santos', capacity: 'City Planning Sector Officer',
    })
  })

  it('says nothing about capacity rather than guessing one', () => {
    expect(actorOf(revision({ changed_role: null })).capacity).toBeNull()
  })

  it('keeps the entry when the account is gone', () => {
    expect(actorOf(revision({ changed_by_name: null, changed_by: null })).name)
      .toBe('Account no longer on record')
  })
})

describe('snapshotDescription', () => {
  it('reads the description off whichever side of the change has one', () => {
    expect(snapshotDescription(revision({
      action: 'create', new_values: { description: 'Purchase of ambulance' },
    }))).toBe('Purchase of ambulance')
    expect(snapshotDescription(revision({
      action: 'delete', old_values: { description: 'Purchase of ambulance' },
    }))).toBe('Purchase of ambulance')
    expect(snapshotDescription(revision({ action: 'create', new_values: {} }))).toBeNull()
  })
})
