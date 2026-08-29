// The 16:9 surface every slide is drawn on, and the tiles that go on it.
//
// Nothing here carries a pixel size. Everything is in `em`, and the slide's own
// font-size is a percentage of its height (see .deck-slide in globals.css), so
// one set of components typesets correctly as a panel in the app shell, as a
// full-screen slide on a projector and as a landscape page out of the printer.

import { moneyTotal } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * One slide.
 *
 * `caption` is where a slide says what its own figures do not: that a total was
 * recomputed over filtered rows, that a column was derived rather than
 * recorded, that a percentage speaks for only some of the programme. Those
 * lines are not decoration — they are the difference between a chart and a
 * chart somebody can be held to.
 */
export function Slide({
  title, subtitle, eyebrow, caption, children, footer,
}: {
  title: string
  subtitle?: string
  eyebrow?: React.ReactNode
  caption?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="deck-stage overflow-hidden rounded-xl border border-border bg-card">
      <div className="deck-slide flex flex-col gap-[0.9em] p-[1.6em] text-card-foreground">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-[0.8em]">
          <div className="min-w-0">
            <h2 className="text-[1.9em] leading-tight font-semibold">{title}</h2>
            {subtitle ? (
              <p className="mt-[0.15em] text-[1.05em] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {eyebrow ? (
            <div className="shrink-0 text-right text-[0.95em] text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[0.9em] overflow-hidden">
          {children}
        </div>

        {caption || footer ? (
          <footer className="shrink-0 border-t border-border pt-[0.6em] text-[0.9em] text-muted-foreground">
            {caption}
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A headline figure.
 *
 * The compact form is the thing read from the back of the hall; the exact peso
 * amount sits under it, because a Mayor asked "how much exactly" should not
 * have to wait for somebody to open the workbook.
 */
export function StatTile({
  label, value, exact, note, tone = 'default',
}: {
  label: string
  value: string
  /** The unrounded figure, printed beneath. Pass the number, not a string. */
  exact?: number | null
  note?: string
  tone?: 'default' | 'muted' | 'warning' | 'success'
}) {
  return (
    <div className={cn(
      'flex min-w-0 flex-col justify-center rounded-lg border px-[0.9em] py-[0.7em]',
      tone === 'warning' && 'border-warning/50 bg-warning/10',
      tone === 'success' && 'border-success/40 bg-success/10',
      tone === 'muted' && 'bg-muted/40',
      tone === 'default' && 'bg-background',
    )}>
      <p className="truncate text-[0.95em] text-muted-foreground" title={label}>{label}</p>
      <p className="mt-[0.1em] truncate font-mono text-[2.1em] leading-[1.15] font-semibold tabular-nums"
         title={value}>
        {value}
      </p>
      {exact !== undefined && exact !== null ? (
        <p className="truncate font-mono text-[0.85em] text-muted-foreground tabular-nums">
          ₱{moneyTotal(exact)}
        </p>
      ) : null}
      {note ? <p className="mt-[0.15em] text-[0.9em] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

/** A row of headline figures. Four across is the most a projector carries. */
export function StatRow({ children, columns = 4 }: {
  children: React.ReactNode
  columns?: 2 | 3 | 4 | 5
}) {
  return (
    <div
      className="grid shrink-0 gap-[0.7em]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

/** A titled area inside a slide. Two of these side by side is the deck's
 *  standard two-column layout. */
export function Panel({ title, note, children, className }: {
  title?: string
  note?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    // `flex-1` matters: a Panel inside <Columns> is a grid item and stretches
    // on its own, but one placed straight into the slide's flex column sizes to
    // its content — and a chart whose only height is `h-full` has no content
    // height, so it collapses to nothing. One rule here rather than a height on
    // each call site.
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-[0.55em]', className)}>
      {title ? (
        <h3 className="shrink-0 text-[1.15em] font-semibold">{title}</h3>
      ) : null}
      {note ? (
        <p className="shrink-0 text-[0.9em] text-muted-foreground">{note}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}

export function Columns({ children, ratio = '1fr 1fr' }: {
  children: React.ReactNode
  ratio?: string
}) {
  return (
    <div className="grid min-h-0 flex-1 gap-[1.4em]" style={{ gridTemplateColumns: ratio }}>
      {children}
    </div>
  )
}

/**
 * The caption a filtered slide must carry.
 *
 * The AIP grid already marks a recomputed subtotal "(filtered rows only)". A
 * slide behind the Mayor showing a grand total that quietly excluded two
 * sectors would be the same mistake with a larger audience.
 */
export function FilterNote({ filtered, of }: { filtered: boolean; of?: number | null }) {
  if (!filtered) return null
  return (
    <p className="text-warning-foreground">
      <strong>Filtered.</strong> Every figure on this slide is recomputed over the
      rows now visible
      {of === undefined || of === null
        ? '.'
        : ` — ${of} line${of === 1 ? '' : 's'} of the programme are in the full document.`}
    </p>
  )
}

/**
 * Whose programme this is, when it is not the city's.
 *
 * A department account reads these same twelve reports on its dashboard over
 * its own office alone. Every total on the slide is then that office's, and a
 * slide headed "Investment by Sector" showing one bar has to say why — a head
 * comparing it against the consolidated AIP and finding a different grand
 * total must be able to see, on the slide, that they are not looking at the
 * same document.
 */
export function ScopeNote({ scope }: { scope: { department_name: string } | null | undefined }) {
  if (!scope) return null
  return (
    <p>
      <strong className="text-foreground">{scope.department_name}</strong> only.
      Every figure here is your office&apos;s; the city&apos;s programme is the
      consolidated AIP.
    </p>
  )
}

/** Said out loud wherever a number is derived rather than recorded. */
export function DerivedNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>
}
