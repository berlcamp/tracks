import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * The viewport is an external store, so it is read with useSyncExternalStore
 * rather than mirrored into state from an effect. The shipped shadcn version
 * called setState inside an effect, which this repo's lint rules reject and
 * which costs a second render on every mount.
 *
 * The server snapshot is `false`: markup is rendered desktop-first and the
 * client corrects it before paint.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
