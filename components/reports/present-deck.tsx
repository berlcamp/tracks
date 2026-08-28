'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RenderSlide } from '@/components/reports/slides'
import { SLIDES, nextSlide, prevSlide, slideIndex } from '@/lib/reports/deck'
import type { SlideId } from '@/lib/reports/deck'
import type { PresentationDeck, PresentationPpaRow } from '@/lib/data/presentation'
import { routes } from '@/lib/routes'

/**
 * One slide, filling the screen, and the three controls a presenter needs.
 *
 * The keyboard is the real interface here: whoever is presenting is holding a
 * clicker that sends arrows and Page Up/Down and nothing else. The buttons are
 * for the person driving from the laptop.
 */
export function PresentDeck({ deck, portfolio, slideId }: {
  deck: PresentationDeck
  portfolio: PresentationPpaRow[]
  slideId: SlideId
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const position = slideIndex(slideId)
  const forward = nextSlide(slideId)
  const back = prevSlide(slideId)

  const href = useCallback((updates: Record<string, string | null>, path: string) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    return query ? `${path}?${query}` : path
  }, [params])

  const goto = useCallback((slide: SlideId) => {
    router.push(href({ slide }, routes.planningReportsPresent) as never, { scroll: false })
  }, [href, router])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stageRef.current?.requestFullscreen()
    } catch {
      // Fullscreen is a courtesy. A browser or a kiosk policy that refuses it
      // leaves the presentation working exactly as it did.
    }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        if (forward) { event.preventDefault(); goto(forward) }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        if (back) { event.preventDefault(); goto(back) }
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        // Escape leaves fullscreen on its own first; a second press leaves the
        // presentation, which is the order a presenter expects.
        router.push(href({}, routes.planningReports) as never)
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [forward, back, goto, href, router, toggleFullscreen])

  useEffect(() => {
    function onChange() { setIsFullscreen(document.fullscreenElement !== null) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return (
    <div ref={stageRef}
         className="deck-present flex min-h-dvh flex-col items-center justify-center gap-3 p-3">
      <RenderSlide id={slideId} deck={deck} portfolio={portfolio} />

      <div className="flex items-center gap-2">
        <Button asChild={!!back} variant="outline" size="sm" disabled={!back}>
          {back
            ? <Link href={href({ slide: back }, routes.planningReportsPresent) as never}
                    scroll={false}><ChevronLeft className="size-4" /> Back</Link>
            : <span><ChevronLeft className="size-4" /> Back</span>}
        </Button>
        <span className="px-2 text-sm tabular-nums text-muted-foreground">
          {position + 1} / {SLIDES.length}
        </span>
        <Button asChild={!!forward} variant="outline" size="sm" disabled={!forward}>
          {forward
            ? <Link href={href({ slide: forward }, routes.planningReportsPresent) as never}
                    scroll={false}>Next <ChevronRight className="size-4" /></Link>
            : <span>Next <ChevronRight className="size-4" /></span>}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void toggleFullscreen()}>
          {isFullscreen
            ? <><Minimize2 className="size-4" /> Leave full screen</>
            : <><Maximize2 className="size-4" /> Full screen</>}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={href({}, routes.planningReports) as never}>
            <X className="size-4" /> Close
          </Link>
        </Button>
      </div>
    </div>
  )
}
