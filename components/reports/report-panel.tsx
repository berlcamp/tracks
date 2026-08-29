'use client'

// The presentation deck's reports, on the dashboard.
//
// Same slides, same payload, same components as /planning/reports — the charts
// are not reimplemented here, because two drawings of the same figure are two
// things to keep in step. What is different is the frame: no contents rail, no
// presentation mode, no printing, and one dropdown instead of twelve links.
// Somebody opening the dashboard came for their own programme at a glance, not
// to present it.
//
// The report is client state, not a URL parameter. The whole deck arrives in
// one payload, so changing report costs nothing and a round trip per dropdown
// would be a round trip for data already in the browser. The deck at
// /planning/reports keeps `?slide=` because a presenter has to be able to send
// somebody a link to slide nine.

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RenderSlide } from '@/components/reports/slides'
import { FIRST_SLIDE, slideGroups, slidesFor, type SlideId } from '@/lib/reports/deck'
import type { PresentationDeck, PresentationPpaRow } from '@/lib/data/presentation'

export function ReportPanel({ deck, portfolio }: {
  deck: PresentationDeck
  portfolio: PresentationPpaRow[]
}) {
  const available = slidesFor(deck.scope)
  const [slideId, setSlideId] = useState<SlideId>(
    available.some((s) => s.id === FIRST_SLIDE) ? FIRST_SLIDE : available[0]!.id,
  )

  const groups = slideGroups(available)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="dashboard-report" className="text-xs text-muted-foreground">
            Report
          </Label>
          <Select value={slideId} onValueChange={(id) => setSlideId(id as SlideId)}>
            <SelectTrigger id="dashboard-report" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.slides.map((slide) => (
                    <SelectItem key={slide.id} value={slide.id}>{slide.title}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        {deck.scope ? (
          // Said here as well as on the slide. The reader picking a report is
          // choosing from a shorter list than the office presents from, and a
          // list that is quietly two items short is a list somebody eventually
          // reports as a bug.
          <p className="max-w-md text-xs text-muted-foreground">
            {available.length} reports on {deck.scope.department_name}&apos;s
            programme. The resources and multi-year reports are the city&apos;s
            and belong to no single office, so they are not shown here.
          </p>
        ) : null}
      </div>

      <RenderSlide id={slideId} deck={deck} portfolio={portfolio} />
    </div>
  )
}
