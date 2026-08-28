'use client'

import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Presentation, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RenderSlide } from '@/components/reports/slides'
import {
  SLIDES, nextSlide, prevSlide, slideGroups, slideIndex, STAGE_LABELS,
} from '@/lib/reports/deck'
import type { SlideId } from '@/lib/reports/deck'
import type { PresentationDeck, PresentationPpaRow } from '@/lib/data/presentation'
import type { AipPeriod, StatutoryFundTotals } from '@/types/tracks'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

/** Radix will not take an empty string as a value, and "no filter" needs one. */
const ANY = '__any__'

export function ReportDeck({
  deck, portfolio, periods, funds, slideId, hasSupplementals,
}: {
  deck: PresentationDeck
  portfolio: PresentationPpaRow[]
  periods: AipPeriod[]
  funds: StatutoryFundTotals[]
  slideId: SlideId
  hasSupplementals: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const go = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    router.push(`${pathname}?${next.toString()}` as never, { scroll: false })
  }, [params, pathname, router])

  const forward = nextSlide(slideId)
  const back = prevSlide(slideId)
  const position = slideIndex(slideId)

  // Presentation mode is driven from the keyboard, because whoever is
  // presenting is holding a clicker that sends arrows and Page Up/Down and
  // nothing else. Escape leaves, as it does everywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        if (forward) { event.preventDefault(); go({ slide: forward }) }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        if (back) { event.preventDefault(); go({ slide: back }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [forward, back, go])

  const slideTitle = SLIDES[position]?.title ?? ''
  const doc = deck.document

  // ------------------------------------------------------------------ inside
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="deck-print-hide flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AIP Presentation</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{doc.title}</span>
            {doc.fund_label ? <Badge variant="secondary">{doc.fund_label}</Badge> : null}
            {deck.filtered ? <Badge variant="outline">Filtered</Badge> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periods.length > 1 ? (
            <Picker
              id="deck-period" label="Year" width="w-32"
              value={doc.period_id}
              options={periods.map((p) => ({ id: p.id, label: `CY ${p.year}` }))}
              onChange={(id) => go({ period: id, slide: slideId })}
            />
          ) : null}
          {/* Its own route, not an overlay: an overlay only covers the
              sidebar, which keeps its place in the tab order and in the
              accessibility tree behind it. */}
          <Button asChild variant="outline">
            <Link href={`${routes.planningReportsPresent}?${params.toString()}` as never}>
              <Presentation className="size-4" /> Presentation mode
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href={`${pathname}?${withParam(params, 'print', 'all')}`} target="_blank"
               rel="noreferrer">
              <Printer className="size-4" /> Print all slides
            </a>
          </Button>
        </div>
      </div>

      {/* Which document is being presented. The statutory funds sit beside the
          annual programme rather than under it — each is its own document with
          its own rows, and none of their money is in the AIP's grand total. */}
      <div className="deck-print-hide flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border p-1">
        <DocTab active={!doc.fund_id && doc.kind === 'annual'} label="Annual"
                onClick={() => go({ fund: null, kind: null })} />
        {hasSupplementals ? (
          <DocTab active={!doc.fund_id && doc.kind === 'supplemental'} label="Supplementals"
                  onClick={() => go({ fund: null, kind: 'supplemental' })} />
        ) : null}
        {funds.map((f) => (
          <DocTab key={f.fund_id} active={doc.fund_id === f.fund_id} label={f.fund_label}
                  onClick={() => go({ fund: f.fund_id, kind: null })} />
        ))}
      </div>

      <div className="deck-print-hide flex flex-wrap items-end gap-3">
        <Picker id="deck-sector" label="Sector" width="w-52"
                value={deck.filters.sector_id ?? ANY}
                options={deck.options.sectors}
                onChange={(id) => go({ sector: id === ANY ? null : id })} />
        <Picker id="deck-office" label="Office" width="w-64"
                value={deck.filters.department_id ?? ANY}
                options={deck.options.departments}
                onChange={(id) => go({ office: id === ANY ? null : id })} />
        <Picker id="deck-funding" label="Funding source" width="w-52"
                value={deck.filters.funding_source ?? ANY}
                options={deck.options.funding_sources}
                onChange={(id) => go({ source: id === ANY ? null : id })} />
        <Picker id="deck-barangay" label="Barangay" width="w-44"
                value={deck.filters.barangay ?? ANY}
                options={deck.options.barangays}
                onChange={(id) => go({ barangay: id === ANY ? null : id })} />
        <Picker id="deck-status" label="Status" width="w-56"
                value={deck.filters.status ?? ANY}
                options={deck.options.stages.map((s) => ({
                  id: s.id, label: STAGE_LABELS[s.id] ?? s.label,
                }))}
                onChange={(id) => go({ status: id === ANY ? null : id })} />
        {deck.filtered ? (
          <Button variant="ghost" size="sm"
                  onClick={() => go({ sector: null, office: null, source: null,
                                      barangay: null, status: null })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Report contents"
             className="deck-print-hide order-2 flex flex-col gap-4 lg:order-1">
          {slideGroups().map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.group}
              </p>
              {group.slides.map((s) => (
                <Link
                  key={s.id}
                  href={`${pathname}?${withParam(params, 'slide', s.id)}` as never}
                  scroll={false}
                  aria-current={s.id === slideId ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-sm',
                    s.id === slideId
                      ? 'bg-secondary font-medium text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span className="mr-2 tabular-nums opacity-60">
                    {String(slideIndex(s.id) + 1).padStart(2, '0')}
                  </span>
                  {s.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <RenderSlide id={slideId} deck={deck} portfolio={portfolio} />

          <div className="deck-print-hide flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={!back}
                    onClick={() => back && go({ slide: back })}>
              <ChevronLeft className="size-4" /> {back ? SLIDES[position - 1]?.title : 'Back'}
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              Slide {position + 1} of {SLIDES.length} — {slideTitle}
            </span>
            <Button variant="outline" size="sm" disabled={!forward}
                    onClick={() => forward && go({ slide: forward })}>
              {forward ? SLIDES[position + 1]?.title : 'Next'} <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params.toString())
  next.set(key, value)
  return next.toString()
}

function DocTab({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void
}) {
  return (
    <Button size="sm" variant={active ? 'secondary' : 'ghost'}
            className={cn(!active && 'text-muted-foreground')} onClick={onClick}>
      {label}
    </Button>
  )
}

/** Every filter is the same control, and every one of them is labelled: a box
 *  with text floating above it announces nothing to a screen reader. */
function Picker({ id, label, value, options, onChange, width }: {
  id: string
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (id: string) => void
  width: string
}) {
  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label))
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {sorted.map((option) => (
            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
