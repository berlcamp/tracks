// The City Planning Office's presentation of the Annual Investment Program to
// the Mayor, the Local Development Council and the City Council.
//
// A reporting surface and nothing else: it reads, it never writes, and it adds
// nothing up. Every figure on every slide came out of
// `tracks.presentation_deck()` — see lib/data/presentation.ts and 0017.

import { requireRole } from '@/lib/auth/session'
import { loadDeckRequest, type DeckQuery } from '@/lib/data/presentation'
import { ReportDeck } from '@/components/reports/report-deck'
import { RenderSlide } from '@/components/reports/slides'
import { SLIDES } from '@/lib/reports/deck'

export const dynamic = 'force-dynamic'

export default async function PlanningReportsPage({
  searchParams,
}: {
  searchParams: Promise<DeckQuery>
}) {
  // The same readership as the Consolidated AIP. A department user has no
  // business presenting the city's programme, and their own office's figures
  // are on their AIP screen where they belong.
  await requireRole([
    'planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer',
  ])

  const q = await searchParams
  const request = await loadDeckRequest(q)

  if (!request) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">Nothing to present yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The City Planning Office has not opened an investment programme year,
          or its figures did not come back.
        </p>
      </div>
    )
  }

  const { deck, portfolio } = request

  // `?print=all` stacks every slide, one to a landscape page, for the PDF the
  // office hands round the table. The app shell is hidden by the print rules in
  // globals.css, so what comes out is the deck and nothing else.
  if (q.print === 'all') {
    return (
      <div className="flex flex-col gap-6">
        <p className="deck-print-hide rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Every slide, one to a landscape page. Print this page, or save it as
          PDF — the sidebar and these controls are left off the paper.
        </p>
        {SLIDES.map((slide) => (
          <RenderSlide key={slide.id} id={slide.id} deck={deck} portfolio={portfolio} />
        ))}
      </div>
    )
  }

  return (
    <ReportDeck
      deck={deck}
      portfolio={portfolio}
      periods={request.periods}
      funds={request.funds}
      slideId={request.slideId}
      hasSupplementals={request.hasSupplementals}
    />
  )
}
