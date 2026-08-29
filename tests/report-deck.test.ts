// The presentation deck's pure layer.
//
// The figures themselves are the database's and are asserted in
// 09_presentation.sql. What is left for this file is the part the SQL suite
// cannot reach: which slides exist, how the deck moves between them, and how a
// figure the database computed is rendered for somebody reading it from the
// back of a session hall.

import { describe, expect, it } from 'vitest'
import {
  CITY_WIDE_SLIDES, FIRST_SLIDE, SLIDES, barWidth, compactPeso, count,
  isDrilledDown, nextSlide, percent, prevSlide, resolveSlide, slideGroups,
  slideIndex, slidesFor,
  type DeckScope, type SlideId,
} from '@/lib/reports/deck'

describe('the deck', () => {
  it('carries the twelve reports the office presents', () => {
    expect(SLIDES).toHaveLength(12)
  })

  it('gives every slide a distinct id', () => {
    expect(new Set(SLIDES.map((s) => s.id)).size).toBe(SLIDES.length)
  })

  it('covers each report the presentation is expected to answer', () => {
    const ids: SlideId[] = [
      'summary', 'sectors', 'offices', 'barangays', 'funding', 'pipeline',
      'priority', 'resources', 'trends', 'execution', 'portfolio', 'decisions',
    ]
    for (const id of ids) {
      expect(SLIDES.map((s) => s.id)).toContain(id)
    }
  })

  it('groups the slides in the order they run', () => {
    const groups = slideGroups()
    expect(groups.flatMap((g) => g.slides.map((s) => s.id)))
      .toEqual(SLIDES.map((s) => s.id))
    // A group is contiguous — the rail never shows the same heading twice.
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
  })
})

describe('moving between slides', () => {
  it('takes a slide id from the URL', () => {
    expect(resolveSlide('execution')).toBe('execution')
  })

  it('falls back rather than erroring on a slide nobody recognises', () => {
    // The same rule a stale ?period= follows: land on something, not a dead end.
    expect(resolveSlide('a-slide-that-was-removed')).toBe(FIRST_SLIDE)
    expect(resolveSlide(undefined)).toBe(FIRST_SLIDE)
    expect(resolveSlide(null)).toBe(FIRST_SLIDE)
  })

  it('stops at both ends rather than wrapping', () => {
    const first = SLIDES[0]!.id
    const last = SLIDES[SLIDES.length - 1]!.id
    expect(prevSlide(first)).toBeNull()
    expect(nextSlide(last)).toBeNull()
  })

  it('walks the whole deck forwards and back to where it started', () => {
    let id: SlideId | null = SLIDES[0]!.id
    const forwards: SlideId[] = [id]
    while ((id = nextSlide(id!)) !== null) forwards.push(id)
    expect(forwards).toEqual(SLIDES.map((s) => s.id))

    let back: SlideId | null = SLIDES[SLIDES.length - 1]!.id
    const backwards: SlideId[] = [back]
    while ((back = prevSlide(back!)) !== null) backwards.push(back)
    expect(backwards.reverse()).toEqual(SLIDES.map((s) => s.id))
  })

  it('numbers the slides from where they sit in the deck', () => {
    expect(slideIndex(SLIDES[0]!.id)).toBe(0)
    expect(slideIndex(SLIDES[3]!.id)).toBe(3)
  })
})

describe('reading a figure from the back of the hall', () => {
  it('scales a peso figure to billions, millions and thousands', () => {
    expect(compactPeso(2_194_073_955)).toBe('₱2.19 B')
    expect(compactPeso(86_222_053)).toBe('₱86.22 M')
    expect(compactPeso(7_500)).toBe('₱7.50 K')
    expect(compactPeso(942.5)).toBe('₱942.50')
  })

  it('does not let a large millions figure tip into billions', () => {
    // ₱986 M and ₱0.99 B look alike at four metres and are the same number
    // read two ways. The threshold is exact so the first never renders as the
    // second — this is the whole failure mode the compact form has to avoid.
    expect(compactPeso(986_000_000)).toBe('₱986.00 M')
    expect(compactPeso(999_999_999)).toBe('₱1,000.00 M')
    expect(compactPeso(1_000_000_000)).toBe('₱1.00 B')
  })

  it('renders a negative figure as a negative figure', () => {
    expect(compactPeso(-45_000_000)).toBe('-₱45.00 M')
  })

  it('shows a dash for a figure that was never recorded', () => {
    // Not "₱0.00". An office that filed no progress report has not told us it
    // did nothing, and a zero on a slide says it did.
    expect(compactPeso(null)).toBe('—')
    expect(compactPeso(undefined)).toBe('—')
    expect(compactPeso(Number.NaN)).toBe('—')
    expect(percent(null)).toBe('—')
    expect(count(null)).toBe('—')
  })

  it('prints zero when zero is what the database said', () => {
    expect(compactPeso(0)).toBe('₱0.00')
    expect(percent(0)).toBe('0.0%')
    expect(count(0)).toBe('0')
  })

  it('prints a percentage to one place, and a count with separators', () => {
    expect(percent(61.25)).toBe('61.3%')
    expect(percent(61.25, 2)).toBe('61.25%')
    expect(count(1268)).toBe('1,268')
  })
})

describe('bar geometry', () => {
  it('is a share of the largest row', () => {
    expect(barWidth(50, 200)).toBe('25.000%')
    expect(barWidth(200, 200)).toBe('100.000%')
  })

  it('never draws past the track, or behind it', () => {
    // Geometry only. The percentage PRINTED beside a bar is whatever the
    // database computed — clamping here must never reach the figure.
    expect(barWidth(300, 200)).toBe('100.000%')
    expect(barWidth(-5, 200)).toBe('0.000%')
  })

  it('draws nothing rather than dividing by zero', () => {
    expect(barWidth(10, 0)).toBe('0%')
    expect(barWidth(Number.NaN, 100)).toBe('0%')
  })
})


// ---------------------------------------------------------------------------
// Reading the deck inside one office
//
// The dashboard offers these same reports to a department account over its own
// programme. The scope is not a filter the reader chose, and the two rules
// below are what keep that honest: a slide must not caption itself "Filtered"
// for a scope, and a report the database computes city-wide must not be shown
// under a heading that says one office.
// ---------------------------------------------------------------------------

const OFFICE: DeckScope = {
  department_id: '11111111-1111-1111-1111-111111111111',
  department_name: 'City Engineering Office',
}

const NO_FILTERS = {
  sector_id: null, department_id: null,
  funding_source: null, status: null, barangay: null,
}

describe('a scoped deck', () => {
  it('offers every report when there is no scope', () => {
    expect(slidesFor(null)).toEqual(SLIDES)
    expect(slidesFor(undefined)).toHaveLength(12)
  })

  it('withholds the reports that are the city\'s by construction', () => {
    const ids = slidesFor(OFFICE).map((s) => s.id)
    expect(ids).toHaveLength(SLIDES.length - CITY_WIDE_SLIDES.length)
    for (const id of CITY_WIDE_SLIDES) expect(ids).not.toContain(id)
  })

  it('keeps the deck\'s order in what is left', () => {
    const ids = slidesFor(OFFICE).map((s) => s.id)
    expect(ids).toEqual(SLIDES.map((s) => s.id).filter((id) => !CITY_WIDE_SLIDES.includes(id)))
  })

  it('still has a landing report to open on', () => {
    expect(slidesFor(OFFICE).map((s) => s.id)).toContain(FIRST_SLIDE)
  })

  it('groups what is left without repeating a heading', () => {
    // The dropdown's optgroups. Dropping two slides could leave a group empty
    // or split one in two, and the same heading twice in a list of ten reads
    // as a rendering fault.
    const groups = slideGroups(slidesFor(OFFICE))
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
    for (const group of groups) expect(group.slides.length).toBeGreaterThan(0)
    expect(groups.flatMap((g) => g.slides.map((s) => s.id)))
      .toEqual(slidesFor(OFFICE).map((s) => s.id))
  })
})

describe('what counts as a drill-down', () => {
  it('is nothing, when nothing is set', () => {
    expect(isDrilledDown(NO_FILTERS)).toBe(false)
    expect(isDrilledDown(NO_FILTERS, OFFICE)).toBe(false)
  })

  it('is not the office a scoped reader is confined to', () => {
    // The whole point: `presentation_deck()` sets `filtered` the moment a
    // department id is passed, and a department account always passes one.
    expect(isDrilledDown(
      { ...NO_FILTERS, department_id: OFFICE.department_id }, OFFICE,
    )).toBe(false)
  })

  it('is any office, to a reader who was not scoped to one', () => {
    expect(isDrilledDown({ ...NO_FILTERS, department_id: OFFICE.department_id }))
      .toBe(true)
  })

  it('is another office, to a scoped reader', () => {
    expect(isDrilledDown(
      { ...NO_FILTERS, department_id: '22222222-2222-2222-2222-222222222222' },
      OFFICE,
    )).toBe(true)
  })

  it('is any of the other four, scope or no scope', () => {
    for (const key of ['sector_id', 'funding_source', 'status', 'barangay'] as const) {
      expect(isDrilledDown({ ...NO_FILTERS, [key]: 'x' }, OFFICE)).toBe(true)
      expect(isDrilledDown({ ...NO_FILTERS, [key]: 'x' })).toBe(true)
    }
  })
})
