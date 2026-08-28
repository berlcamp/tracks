// The deck on a projector: one slide, 16:9, and no application around it.
//
// Same data as /planning/reports, resolved by the same function, so the screen
// the office set the presentation up on and the screen behind the Mayor cannot
// be showing two different documents.

import { requireRole } from '@/lib/auth/session'
import { loadDeckRequest, type DeckQuery } from '@/lib/data/presentation'
import { PresentDeck } from '@/components/reports/present-deck'

export const dynamic = 'force-dynamic'

export default async function PresentPage({
  searchParams,
}: {
  searchParams: Promise<DeckQuery>
}) {
  await requireRole([
    'planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer',
  ])

  const q = await searchParams
  const request = await loadDeckRequest(q)

  if (!request) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-center">
        <p className="text-lg text-muted-foreground">
          There is no investment programme to present yet.
        </p>
      </div>
    )
  }

  return (
    <PresentDeck
      deck={request.deck}
      portfolio={request.portfolio}
      slideId={request.slideId}
    />
  )
}
