// The presentation deck's pure layer.
//
// The figures themselves are the database's and are asserted in
// 09_presentation.sql. What is left for this file is the part the SQL suite
// cannot reach: which slides exist, how the deck moves between them, and how a
// figure the database computed is rendered for somebody reading it from the
// back of a session hall.

import { describe, expect, it } from 'vitest'
import {
  FIRST_SLIDE, SLIDES, barWidth, compactPeso, count, nextSlide, percent,
  prevSlide, resolveSlide, slideGroups, slideIndex,
  type SlideId,
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
