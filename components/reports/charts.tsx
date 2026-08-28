'use client'

// Charts for the presentation deck, on Recharts through shadcn's ChartContainer.
//
// The chart TYPE is chosen from what the figures are, not from variety:
//
//   horizontal bars  a ranking with long names — sectors, offices, barangays,
//                    funding sources, the largest PPAs. Names read left to
//                    right, so the category axis has to be the vertical one.
//   vertical bars    a small ordered set with short labels: the review
//                    checkpoints, the money cascade, a programme against a
//                    ceiling.
//   line             time. Years run left to right and the slope IS the point;
//                    a bar chart of years reads as a ranking instead.
//   donut            a PARTITION of one figure already on the slide — expense
//                    classes, funded and unfunded, local and external. Never a
//                    ranking: a pie of fourteen offices is unreadable at four
//                    metres and unreadable on paper.
//
// Colour follows the note in globals.css. A chart plotting one measure uses
// --viz-series-1 and nothing else, which keeps it clear of colour-vision
// deficiency entirely; a genuinely categorical chart takes --chart-1 … --chart-5
// in the documented order and every slice is labelled in text as well, so
// colour is never the only thing carrying the meaning.
//
// Nothing here computes a figure. `value` is what the database returned and
// `display` is how it is written; the components only decide length and colour.

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart,
  XAxis, YAxis,
} from 'recharts'
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'
import { barWidth } from '@/lib/reports/deck'
import { cn } from '@/lib/utils'

/** The categorical ramp, in the order globals.css documents. */
const CATEGORICAL = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)',
]

const SERIES = 'var(--viz-series-1)'

/**
 * ChartContainer ships `aspect-video` and `text-xs`, and the deck can have
 * neither: a slide gives its charts a height, and every size in the deck is a
 * proportion of the slide so that one component typesets on a laptop panel, a
 * projector and a sheet of A4. So the box fills its panel and the axis type is
 * in `em` like everything else.
 */
//
// `min-h` matters more than it looks. ResponsiveContainer draws into whatever
// height it is given, and a slide with one panel too many collapses its
// `flex-1` rows to nothing — at which point the chart renders a 0px SVG and
// the slide simply has a blank where a figure should be. A floor turns that
// into an overflowing slide, which somebody notices.
const FRAME = 'aspect-auto h-full min-h-[4.5em] w-full text-[0.8em]'

export interface Datum {
  key: string
  /** The category name, as it appears on the axis. */
  label: string
  /** The measure. Straight from the database. */
  value: number
  /** The measure, written out — "₱86.22 M". Printed on the bar. */
  display: string
  /** A second line under the bar's label. */
  note?: string
  /** The row the slide is drilled into. */
  active?: boolean
}

function configFor(data: Datum[], categorical: boolean): ChartConfig {
  return Object.fromEntries(data.map((d, i) => [
    d.key,
    { label: d.label, color: categorical ? CATEGORICAL[i % CATEGORICAL.length] : SERIES },
  ]))
}

/**
 * Category labels are truncated for the AXIS only — the full name is on the
 * tooltip and, where it matters, in the note under the bar. A PPA description
 * runs to a dozen words and Recharts will happily draw all of them straight
 * through the neighbouring bar.
 */
function axisLabel(value: unknown, max: number): string {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * A value printed on a bar, on one line.
 *
 * Recharts wraps a LabelList to the width of the bar it sits on, which turns
 * "₱559.86 M" into two lines the moment the column is narrower than the text —
 * and a figure broken across two lines on a projector reads as two figures.
 * Drawing the text directly is the only way to say "never wrap this".
 */
function barLabel(
  place: 'top' | 'right',
  /** Takes the raw cell value. Some series carry a number to be formatted and
   *  some carry an already-written string, so this must not coerce. */
  format: (value: unknown) => string,
  offset = 8,
) {
  function Rendered(props: unknown) {
    const { x, y, width, height, value } = props as {
      x?: number; y?: number; width?: number; height?: number; value?: unknown
    }
    if (x === undefined || y === undefined) return null
    const text = format(value)
    if (!text) return null

    return place === 'top' ? (
      <text
        x={x + (width ?? 0) / 2}
        y={y - offset}
        textAnchor="middle"
        className="fill-foreground font-mono font-semibold"
      >
        {text}
      </text>
    ) : (
      <text
        x={x + (width ?? 0) + offset}
        y={y + (height ?? 0) / 2}
        dominantBaseline="central"
        className="fill-foreground font-mono"
      >
        {text}
      </text>
    )
  }
  return Rendered
}

/** A value that is already written out — `Datum.display`. */
const written = (value: unknown) => (value == null ? '' : String(value))

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bars — a ranking
// ---------------------------------------------------------------------------

/**
 * The workhorse of the deck. Bars are scaled to the LARGEST ROW rather than to
 * the programme total, so the shape of a ranking stays visible when one office
 * carries most of it; the share of the whole is printed in the note, where it
 * cannot be misread off the bar geometry.
 */
export function RankedBarChart({
  data, emptyMessage = 'Nothing to show.', nameWidth = 190, unit, maxLabel = 34,
}: {
  data: Datum[]
  emptyMessage?: string
  /** Room for the category names, in pixels of the rendered chart. */
  nameWidth?: number
  /** What the measure is, for the tooltip: "Programmed", "PPAs". */
  unit?: string
  /** Characters before a category label is elided on the axis. */
  maxLabel?: number
}) {
  if (data.length === 0) return <Empty message={emptyMessage} />

  return (
    <ChartContainer config={configFor(data, false)} className={FRAME}>
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 96, bottom: 4, left: 4 }}
        barCategoryGap="22%"
      >
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
        {/* `dataMax` explicitly: left to choose its own domain Recharts rounds
            the maximum up to a "nice" number, and every bar is then drawn at a
            fraction of the width for no reason a reader can see. Scaled to the
            largest row is what the caption on these slides says. */}
        <XAxis type="number" dataKey="value" domain={[0, 'dataMax']} hide />
        <YAxis
          type="category"
          dataKey="label"
          width={nameWidth}
          tickLine={false}
          axisLine={false}
          interval={0}
          tickFormatter={(value) => axisLabel(value, maxLabel)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelKey="label"
              formatter={(_value, _name, item) => (
                <span className="font-mono tabular-nums">
                  {unit ? `${unit}: ` : ''}
                  {(item?.payload as Datum | undefined)?.display}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.active ? 'var(--primary)' : SERIES} />
          ))}
          <LabelList dataKey="display" content={barLabel('right', written, 10)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------
// Vertical bars — a small ordered set
// ---------------------------------------------------------------------------

export function ColumnBarChart({
  data, emptyMessage = 'Nothing to show.',
}: {
  data: Datum[]
  emptyMessage?: string
}) {
  if (data.length === 0) return <Empty message={emptyMessage} />

  return (
    <ChartContainer config={configFor(data, false)} className={FRAME}>
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 26, right: 8, bottom: 4, left: 8 }}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          tickMargin={8}
          tickFormatter={(value) => axisLabel(value, 14)}
        />
        <YAxis hide domain={[0, 'dataMax']} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelKey="label"
              formatter={(_value, _name, item) => (
                <span className="font-mono tabular-nums">
                  {(item?.payload as Datum | undefined)?.display}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.active ? 'var(--primary)' : SERIES} />
          ))}
          <LabelList dataKey="display" content={barLabel('top', written)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------
// Grouped bars — two measures over the same categories
// ---------------------------------------------------------------------------

export interface SeriesDef {
  key: string
  label: string
  /** Omit to take the next colour in the documented order. */
  color?: string
}

/**
 * Two or three measures side by side over the same categories: obligation
 * against physical progress per sector, programmed against a stated ceiling.
 * Grouped rather than stacked, because these measures are compared with each
 * other and do not add up to anything.
 */
export function GroupedBarChart({
  data, series, layout = 'horizontal', formatter, emptyMessage = 'Nothing to show.',
  nameWidth = 150,
}: {
  /** One row per category: `{ label, [seriesKey]: number }`. */
  data: Array<Record<string, string | number>>
  series: SeriesDef[]
  /** `horizontal` draws vertical columns; `vertical` draws horizontal bars. */
  layout?: 'horizontal' | 'vertical'
  formatter: (value: number) => string
  emptyMessage?: string
  nameWidth?: number
}) {
  if (data.length === 0) return <Empty message={emptyMessage} />

  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [
    s.key, { label: s.label, color: s.color ?? CATEGORICAL[i % CATEGORICAL.length] },
  ]))
  const vertical = layout === 'vertical'

  return (
    <ChartContainer config={config} className={FRAME}>
      <BarChart
        accessibilityLayer
        data={data}
        layout={layout}
        margin={{ top: 8, right: vertical ? 86 : 8, bottom: 4, left: 8 }}
        barCategoryGap="22%"
      >
        <CartesianGrid vertical={vertical} horizontal={!vertical} stroke="var(--viz-grid)" />
        {vertical ? (
          <>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="label" width={nameWidth}
                   tickLine={false} axisLine={false} interval={0}
                   tickFormatter={(value) => axisLabel(value, 22)} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tickLine={false} axisLine={false}
                   interval={0} tickMargin={8}
                   tickFormatter={(value) => axisLabel(value, 14)} />
            <YAxis hide domain={[0, 'dataMax']} />
          </>
        )}
        <ChartTooltip
          content={<ChartTooltipContent
            formatter={(value, name) => (
              <span className="font-mono tabular-nums">
                {config[name as string]?.label as string}: {formatter(Number(value))}
              </span>
            )}
          />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={`var(--color-${s.key})`}
            radius={vertical ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={s.key}
              content={barLabel(vertical ? 'right' : 'top', (v) => formatter(Number(v)), 6)}
            />
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------
// Donut — a partition of one figure
// ---------------------------------------------------------------------------

/**
 * A share of the whole, with the whole written in the middle.
 *
 * Only ever a PARTITION — the parts must add back to the figure in the centre.
 * A part with nothing in it keeps its legend entry and reads zero, because
 * "none of the programme is unfunded" is a statement worth making out loud.
 */
export function SharePie({
  data, centreLabel, centreValue, emptyMessage = 'Nothing to show.',
}: {
  data: Datum[]
  centreLabel?: string
  /** Already formatted. The parts add to this. */
  centreValue?: string
  emptyMessage?: string
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <Empty message={emptyMessage} />
  }

  return (
    <ChartContainer config={configFor(data, true)} className={FRAME}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <ChartTooltip
          content={
            <ChartTooltipContent
              nameKey="label"
              formatter={(_value, _name, item) => (
                <span className="font-mono tabular-nums">
                  {(item?.payload as Datum | undefined)?.display}
                </span>
              )}
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="68%"
          outerRadius="90%"
          paddingAngle={1}
          isAnimationActive={false}
        >
          {data.map((d, i) => (
            <Cell key={d.key} fill={CATEGORICAL[i % CATEGORICAL.length]} stroke="none" />
          ))}
          {centreValue ? (
            <LabelList
              dataKey="key"
              position="center"
              content={(props) => {
                // Recharts hands every slice to `content`; the centre is drawn
                // once, from the first.
                const { index, viewBox } = props as {
                  index?: number
                  viewBox?: { cx?: number; cy?: number }
                }
                if (index !== 0 || viewBox?.cx === undefined) return null
                return (
                  <g>
                    {/* Sized to sit INSIDE the hole. A centre figure that
                        spills over the ring reads as a rendering fault, and
                        the exact amount is on the tile above anyway. */}
                    <text x={viewBox.cx} y={(viewBox.cy ?? 0) - 3}
                          textAnchor="middle" dominantBaseline="middle"
                          className="fill-foreground font-mono text-[0.98em] font-semibold">
                      {centreValue}
                    </text>
                    {centreLabel ? (
                      <text x={viewBox.cx} y={(viewBox.cy ?? 0) + 12}
                            textAnchor="middle" dominantBaseline="middle"
                            className="fill-muted-foreground text-[0.8em]">
                        {centreLabel}
                      </text>
                    ) : null}
                  </g>
                )
              }}
            />
          ) : null}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}

/**
 * The donut's legend, as a list rather than inside the chart.
 *
 * Kept out of the SVG on purpose: a Recharts legend shrinks the ring to make
 * room for itself, and at the far end of a session hall the ring is the part
 * that has to stay large. This also lets each entry carry its own figure.
 */
export function ShareLegend({ data, columns = 1 }: {
  data: Datum[]
  columns?: 1 | 2
}) {
  return (
    <ul className="grid gap-x-[1.2em] gap-y-[0.5em]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {data.map((d, i) => (
        <li key={d.key} className="flex items-start gap-[0.5em]">
          <span aria-hidden className="mt-[0.45em] size-[0.7em] shrink-0 rounded-[2px]"
                style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
          <span className="min-w-0">
            <span className="block truncate text-[1em] font-medium" title={d.label}>
              {d.label}
            </span>
            <span className="block font-mono text-[1.15em] font-semibold tabular-nums">
              {d.display}
            </span>
            {d.note ? (
              <span className="block text-[0.9em] text-muted-foreground">{d.note}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Line — time
// ---------------------------------------------------------------------------

/**
 * One point per programme year. Time runs left to right and the slope is the
 * point, which is exactly what a bar chart of years cannot show.
 *
 * A year in which nothing was filed is plotted at zero rather than dropped, so
 * a gap in the record shows as a gap.
 */
export function TrendLineChart({
  data, series, formatter, emptyMessage = 'No programme years on record.',
  showDots = true,
}: {
  /** One row per year: `{ label, [seriesKey]: number }`. */
  data: Array<Record<string, string | number>>
  series: SeriesDef[]
  formatter: (value: number) => string
  emptyMessage?: string
  showDots?: boolean
}) {
  if (data.length === 0) return <Empty message={emptyMessage} />

  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [
    s.key,
    {
      label: s.label,
      color: s.color ?? (series.length === 1 ? SERIES : CATEGORICAL[i % CATEGORICAL.length]),
    },
  ]))

  return (
    <ChartContainer config={config} className={FRAME}>
      <LineChart
        accessibilityLayer
        data={data}
        // Room for the value printed over the first and last points,
        // which would otherwise be clipped by the plot area.
        margin={{ top: 26, right: 44, bottom: 4, left: 44 }}
      >
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false}
               interval={0} tickMargin={8} />
        <YAxis hide />
        <ChartTooltip
          content={<ChartTooltipContent
            formatter={(value, name) => (
              <span className="font-mono tabular-nums">
                {config[name as string]?.label as string}: {formatter(Number(value))}
              </span>
            )}
          />}
        />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            strokeWidth={3}
            dot={showDots ? { r: 4, strokeWidth: 0, fill: `var(--color-${s.key})` } : false}
            activeDot={{ r: 6 }}
            isAnimationActive={false}
          >
            {series.length === 1 ? (
              <LabelList dataKey={s.key}
                         content={barLabel('top', (v) => formatter(Number(v)), 12)} />
            ) : null}
          </Line>
        ))}
      </LineChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------
// A single percentage
// ---------------------------------------------------------------------------

/**
 * Not a chart, and deliberately not one: a charting library adds nothing to a
 * single percentage against a track, and a gauge would take four times the
 * room to say it.
 *
 * `value` null renders an empty track and a dash, never 0% — the office that
 * has filed no progress report has not told us it did nothing, and a meter
 * sitting at zero says it did.
 */
export function Meter({
  label, value, caption, tone = 'series',
}: {
  label: string
  value: number | null
  caption?: string
  tone?: 'series' | 'warning' | 'success'
}) {
  const colour =
    tone === 'warning' ? 'var(--warning)'
      : tone === 'success' ? 'var(--success)'
        : SERIES

  return (
    <div className="flex flex-col gap-[0.3em]">
      <div className="flex items-baseline justify-between gap-[0.8em]">
        <span className="text-[1.05em] font-medium">{label}</span>
        <span className="font-mono text-[1.6em] font-semibold tabular-nums">
          {value === null ? '—' : `${value.toFixed(1)}%`}
        </span>
      </div>
      <div className={cn('h-[0.9em] w-full overflow-hidden rounded-sm bg-muted')}>
        {value === null ? null : (
          <div className="h-full rounded-sm"
               style={{ width: barWidth(value, 100), background: colour }} />
        )}
      </div>
      {caption ? (
        <p className="text-[0.95em] text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}
