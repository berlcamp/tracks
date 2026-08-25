import { cn } from '@/lib/utils'

/** The mark: four stacked bars, read as an investment programme growing down a
 *  worksheet. Inline SVG so it inherits currentColor and costs no request. */
export function TracksMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('text-primary', className)}>
      <rect x="2" y="3" width="20" height="18" rx="3.5" className="fill-primary/12" />
      <rect x="5.5" y="15" width="3" height="3.5" rx="1" className="fill-primary" />
      <rect x="10.5" y="11" width="3" height="7.5" rx="1" className="fill-primary/75" />
      <rect x="15.5" y="6.5" width="3" height="12" rx="1" className="fill-primary/50" />
    </svg>
  )
}
