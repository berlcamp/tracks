'use client'

// The twelve slides.
//
// Client, because the charts are: a formatter passed to <TrendLineChart> is a
// FUNCTION, and a function cannot cross the server/client boundary. Without
// this the interactive deck worked (it is reached through a client component)
// and `?print=all` — reached straight from a server component — returned a 500.
// The slides are presentational and hold no server-only code, so the boundary
// belongs here rather than at each chart call site.
//
// Every one of them is a pure function of the payload `tracks.presentation_deck()`
// returned. NOTHING in this file adds, divides or rounds a peso figure: where a
// slide states a share, a rate or a variance, that number was computed in SQL
// beside the totals it came from. Grouping an array or reading its first element
// is not arithmetic; `a.total / b.total` is, and there is none of it here on
// purpose — 09_presentation.sql can only guarantee the figures it computes, and
// a ratio invented in a component is outside that guarantee.
//
// The chart on each panel is chosen from what the figures ARE — see the note at
// the top of charts.tsx. Rankings get horizontal bars, partitions get a donut,
// years get a line, and a small ordered set gets columns.

import { Columns, DerivedNote, FilterNote, Panel, Slide, StatRow, StatTile }
  from '@/components/reports/slide-frame'
import {
  ColumnBarChart, GroupedBarChart, Meter, RankedBarChart, ShareLegend, SharePie,
  TrendLineChart, type Datum,
} from '@/components/reports/charts'
import {
  CHECKPOINT_SHORT, ORIGIN_LABELS, ORIGIN_RULE, PROGRESS_LABELS, STAGE_LABELS,
  STAGE_SHORT,
  compactPeso, count, percent, ppas,
} from '@/lib/reports/deck'
import type { SlideId } from '@/lib/reports/deck'
import type { PresentationDeck, PresentationPpaRow } from '@/lib/data/presentation'
import { moneyTotal, schedule } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface SlideProps {
  deck: PresentationDeck
  portfolio: PresentationPpaRow[]
}

/** What every slide says in its top-right corner. */
function documentEyebrow(deck: PresentationDeck) {
  const d = deck.document
  const name = d.fund_name ?? (d.kind === 'supplemental'
    ? 'Supplemental Investment Programs'
    : 'Annual Investment Program')
  return (
    <>
      <p className="font-medium text-foreground">{name}</p>
      <p>CY {d.year} · {d.lgu_name ?? 'City of Bayugan'}</p>
    </>
  )
}

function filterCaption(deck: PresentationDeck) {
  return <FilterNote filtered={deck.filtered} of={deck.document_ppa_count} />
}

/** A donut and its list, stacked: the ring keeps the height, the list the width. */
function Share({ data, centre, centreLabel, columns = 1 }: {
  data: Datum[]
  centre?: string
  centreLabel?: string
  columns?: 1 | 2
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-[0.5em]">
      <div className="min-h-0 flex-1">
        <SharePie data={data} centreValue={centre} centreLabel={centreLabel} />
      </div>
      <div className="shrink-0">
        <ShareLegend data={data} columns={columns} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Executive Summary
// ---------------------------------------------------------------------------

export function SummarySlide({ deck }: SlideProps) {
  const o = deck.overview

  const byClass: Datum[] = [
    { key: 'ps', label: 'Personal Services (8)', value: o.total_ps, display: compactPeso(o.total_ps) },
    { key: 'mooe', label: 'MOOE (9)', value: o.total_mooe, display: compactPeso(o.total_mooe) },
    { key: 'fe', label: 'Financial Expenses (10)', value: o.total_fe, display: compactPeso(o.total_fe) },
    { key: 'co', label: 'Capital Outlay (11)', value: o.total_co, display: compactPeso(o.total_co) },
  ]
  const byFunding: Datum[] = [
    { key: 'funded', label: 'Funding source stated', value: o.funded_amount,
      display: compactPeso(o.funded_amount), note: ppas(o.funded_count) },
    { key: 'unfunded', label: 'None stated', value: o.unfunded_amount,
      display: compactPeso(o.unfunded_amount), note: ppas(o.unfunded_count) },
  ]
  // A flat pair of lines at zero says "nothing has moved yet", which is a
  // different statement from "there is nothing to show" — so the chart is only
  // withheld when not one peso has been obligated or disbursed all year.
  const months = deck.monthly.map((m) => ({
    label: m.label,
    obligated: m.obligated_cumulative,
    disbursed: m.disbursed_cumulative,
  }))
  const anyMovement = deck.monthly.some(
    (m) => m.obligated_cumulative > 0 || m.disbursed_cumulative > 0)

  return (
    <Slide
      title="Executive Summary"
      subtitle={deck.document.title}
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Anything obligated before the year opens January, so the curve ends
            at the year&apos;s totals rather than restarting from zero.
          </p>
        </>
      }
    >
      <StatRow columns={4}>
        <StatTile label="Total investment requirement"
                  value={compactPeso(o.total_amount)} exact={o.total_amount} />
        <StatTile label="Programs, projects and activities"
                  value={count(o.ppa_count)}
                  note={`largest single line ${compactPeso(o.largest_amount)}`} />
        <StatTile label="Offices and sectors"
                  value={`${count(o.department_count)} · ${count(o.sector_count)}`}
                  note={`${count(o.implementing_office_count)} implementing offices named`} />
        <StatTile label="Continuing PPAs"
                  value={count(o.continuing_count)}
                  note={o.continuing_count === 0
                    ? `all ${count(o.new_count)} are new this year`
                    : `${count(o.new_count)} new · ${compactPeso(o.continuing_amount)} carried over`} />
      </StatRow>

      {/* One row of panels, and only one. Two rows of charts do not fit a 16:9
          slide: the flex row collapses, ResponsiveContainer is handed no
          height, and the slide reads as though the office has no figures. */}
      <Columns ratio="1.35fr 1fr 1fr">
        {/* The gap between the two lines is money committed but not yet paid,
            and the shape of that gap over the year is the thing a table of
            totals cannot show — which is the whole reason this is a line. */}
        <Panel
          title={`Obligation and disbursement, CY ${deck.document.year}`}
          note="Cumulative, as at each month end"
        >
          <TrendLineChart
            data={anyMovement ? months : []}
            formatter={compactPeso}
            showDots={false}
            series={[
              { key: 'obligated', label: 'Obligated' },
              { key: 'disbursed', label: 'Disbursed' },
            ]}
            emptyMessage="Nothing obligated or disbursed this year yet."
          />
        </Panel>
        <Panel title="By expense class" note="Columns (8) to (11) of the form">
          <Share data={byClass} centre={compactPeso(o.total_amount)} centreLabel="programmed" />
        </Panel>
        <Panel title="Funding source" note="Column (7), stated or left blank">
          <Share data={byFunding} centre={count(o.ppa_count)} centreLabel="PPAs" />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 2. By sector
// ---------------------------------------------------------------------------

export function SectorsSlide({ deck }: SlideProps) {
  const top = deck.sectors[0]
  const bars: Datum[] = deck.sectors.map((s) => ({
    key: s.sector_id,
    label: s.name,
    value: s.total_amount,
    display: compactPeso(s.total_amount),
    active: deck.filters.sector_id === s.sector_id,
  }))
  const share: Datum[] = deck.sectors.map((s) => ({
    key: s.sector_id,
    label: s.name,
    value: s.total_amount,
    display: percent(s.share_pct),
    note: `${ppas(s.ppa_count)} · ${compactPeso(s.total_amount)}`,
  }))

  return (
    <Slide
      title="Investment by Sector"
      subtitle="Ranked by the amount programmed"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>Bars are scaled to the largest sector; the ring is each sector&apos;s share of the whole.</p>
        </>
      }
    >
      <StatRow columns={3}>
        <StatTile label="Sectors in the programme" value={count(deck.sectors.length)} />
        <StatTile label="Largest sector" value={top?.name ?? '—'}
                  note={top ? `${ppas(top.ppa_count)} across ${count(top.department_count)} offices` : undefined} />
        <StatTile label="Largest sector's share"
                  value={percent(top?.share_pct ?? null)}
                  exact={top?.total_amount ?? null} />
      </StatRow>

      <Columns ratio="1.4fr 1fr">
        <Panel title="Amount programmed">
          <RankedBarChart
            data={bars}
            unit="Programmed"
            nameWidth={132}
            emptyMessage="No sector has a line in this programme yet."
          />
        </Panel>
        <Panel title="Share of the programme">
          <Share data={share} centre={compactPeso(deck.overview.total_amount)}
                 centreLabel="programmed" />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 3. By office
// ---------------------------------------------------------------------------

const OFFICE_LIMIT = 12

export function OfficesSlide({ deck }: SlideProps) {
  const top = deck.offices[0]
  const bars: Datum[] = deck.offices.slice(0, OFFICE_LIMIT).map((d) => ({
    key: d.department_id,
    label: d.code,
    value: d.total_amount,
    display: compactPeso(d.total_amount),
    active: deck.filters.department_id === d.department_id,
    note: d.name,
  }))

  return (
    <Slide
      title="Investment by Office"
      subtitle="Ranked by the amount programmed"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Offices are shown by their code; the full name is in the tooltip.
            {deck.offices.length > OFFICE_LIMIT
              ? ` Showing the ${OFFICE_LIMIT} largest of ${count(deck.offices.length)} — the full list is on the Consolidated AIP.`
              : null}
          </p>
        </>
      }
    >
      <StatRow columns={3}>
        <StatTile label="Offices with a submission" value={count(deck.offices.length)} />
        <StatTile label="Largest office" value={top?.code ?? '—'}
                  note={top?.name} exact={top?.total_amount ?? null} />
        <StatTile label="Largest office's share" value={percent(top?.share_pct ?? null)}
                  note={top ? ppas(top.ppa_count) : undefined} />
      </StatRow>

      <Panel>
        <RankedBarChart
          data={bars}
          unit="Programmed"
          nameWidth={72}
          emptyMessage="No office has filed a line in this programme yet."
        />
      </Panel>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 4. By barangay — derived, and saying so
// ---------------------------------------------------------------------------

export function BarangaysSlide({ deck }: SlideProps) {
  const cov = deck.location_coverage
  const rows = deck.barangays
  const highest = rows[0]
  const lowest = rows.at(-1)

  const bars: Datum[] = rows.slice(0, 10).map((b) => ({
    key: b.name,
    label: b.name,
    value: b.total_amount,
    display: compactPeso(b.total_amount),
    active: deck.filters.barangay === b.name,
    note: ppas(b.ppa_count),
  }))
  const coverage: Datum[] = [
    { key: 'single', label: 'Names one barangay', value: cov.single_amount,
      display: compactPeso(cov.single_amount), note: ppas(cov.single_count) },
    { key: 'multiple', label: 'Names several', value: cov.multiple_amount,
      display: compactPeso(cov.multiple_amount), note: `${ppas(cov.multiple_count)} — not attributed` },
    { key: 'unstated', label: 'Names none', value: cov.unstated_amount,
      display: compactPeso(cov.unstated_amount), note: `${ppas(cov.unstated_count)} — city-wide or unstated` },
  ]

  return (
    <Slide
      title="Investment by Barangay"
      subtitle="Read from the wording of each PPA"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <DerivedNote>
            <strong>Derived, not recorded.</strong> The AIP form has no location
            column and TRACKS stores no barangay: these figures are read from
            barangay names written into a PPA&apos;s description or expected
            output. A row naming several barangays is attributed to none of them
            — attributing it to each would count the same peso twice — and a row
            naming none is not assigned to anywhere.
          </DerivedNote>
        </>
      }
    >
      <StatRow columns={4}>
        <StatTile label="Barangays named" value={count(rows.length)} />
        <StatTile label={highest ? `Highest — ${highest.name}` : 'Highest'} tone="success"
                  value={highest ? compactPeso(highest.total_amount) : '—'}
                  exact={highest?.total_amount ?? null}
                  note={highest ? ppas(highest.ppa_count) : undefined} />
        <StatTile label={lowest ? `Lowest — ${lowest.name}` : 'Lowest'} tone="warning"
                  value={lowest ? compactPeso(lowest.total_amount) : '—'}
                  exact={lowest?.total_amount ?? null}
                  note={lowest ? ppas(lowest.ppa_count) : undefined} />
        <StatTile label="Not attributable to one barangay" tone="muted"
                  value={compactPeso(cov.multiple_amount + cov.unstated_amount)}
                  note={`${ppas(cov.multiple_count + cov.unstated_count)} name several or none`} />
      </StatRow>

      {rows.length === 0 ? (
        <Columns ratio="1.4fr 1fr">
          <Panel>
            <div className="flex h-full flex-col justify-center gap-[0.6em] rounded-lg border border-dashed border-border p-[1.4em]">
              <p className="text-[1.3em] font-medium">No PPA in this programme names a barangay.</p>
              <p className="text-[1.05em] text-muted-foreground">
                Nothing is missing from the database — there is no field for it.
                A barangay breakdown that can be relied on needs a location
                recorded against each PPA, which is a change to the encoding form
                and to the AIP row itself, not to this report.
              </p>
            </div>
          </Panel>
          <Panel title="What the wording does say">
            <Share data={coverage} centre={compactPeso(deck.overview.total_amount)}
                   centreLabel="programmed" />
          </Panel>
        </Columns>
      ) : (
        <Columns ratio="1.4fr 1fr">
          <Panel title="Where the named money goes">
            <RankedBarChart data={bars} unit="Programmed" nameWidth={124} maxLabel={18} />
          </Panel>
          <Panel title="How much of the programme names a place">
            <Share data={coverage} centre={compactPeso(deck.overview.total_amount)}
                   centreLabel="programmed" />
          </Panel>
        </Columns>
      )}
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 5. Funding sources
// ---------------------------------------------------------------------------

export function FundingSlide({ deck }: SlideProps) {
  const top = deck.funding_sources[0]
  const bars: Datum[] = deck.funding_sources.slice(0, 9).map((f) => ({
    key: f.key,
    label: f.label,
    value: f.total_amount,
    display: compactPeso(f.total_amount),
    active: deck.filters.funding_source === f.key,
    note: `${ppas(f.ppa_count)} · ${percent(f.share_pct)}`,
  }))
  const origins: Datum[] = deck.funding_origins.map((o) => ({
    key: o.origin,
    label: ORIGIN_LABELS[o.origin] ?? o.origin,
    value: o.total_amount,
    display: compactPeso(o.total_amount),
    note: ppas(o.ppa_count),
  }))

  return (
    <Slide
      title="Funding Sources"
      subtitle="Column (7) of the AIP form, as each office wrote it"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Spellings that differ only in case or spacing are counted as one
            source; the label shown is the office&apos;s own wording.{' '}
            {ORIGIN_RULE}
            {deck.document.fund_id === null && deck.statutory_funds.length > 0
              ? ' The statutory funds are separate documents and none of their money is on this slide.'
              : null}
          </p>
        </>
      }
    >
      <StatRow columns={3}>
        <StatTile label="Distinct funding sources" value={count(deck.funding_sources.length)} />
        <StatTile label="Largest source" value={top?.label ?? '—'}
                  exact={top?.total_amount ?? null}
                  note={top ? `${percent(top.share_pct)} of the programme` : undefined} />
        <StatTile label="No source stated"
                  tone={deck.overview.unfunded_count > 0 ? 'warning' : 'default'}
                  value={compactPeso(deck.overview.unfunded_amount)}
                  exact={deck.overview.unfunded_amount}
                  note={ppas(deck.overview.unfunded_count)} />
      </StatRow>

      <Columns ratio="1.4fr 1fr">
        <Panel title="Ranked by amount">
          <RankedBarChart
            data={bars}
            unit="Programmed"
            nameWidth={140}
            maxLabel={22}
            emptyMessage="No funding source has been stated in this programme."
          />
        </Panel>
        <Panel title="Local and external">
          <Share data={origins} centre={compactPeso(deck.overview.total_amount)}
                 centreLabel="programmed" />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 6. Status and review pipeline
// ---------------------------------------------------------------------------

export function PipelineSlide({ deck }: SlideProps) {
  const accepted = deck.checkpoints.find((c) => c.key === 'accepted')
  const disbursed = deck.checkpoints.find((c) => c.key === 'disbursed')

  const checkpoints: Datum[] = deck.checkpoints.map((c) => ({
    key: c.key,
    label: CHECKPOINT_SHORT[c.key] ?? c.label,
    value: c.ppa_count,
    display: count(c.ppa_count),
  }))
  const stages: Datum[] = deck.stages.map((s) => ({
    key: s.stage,
    label: STAGE_SHORT[s.stage] ?? s.stage,
    value: s.ppa_count,
    display: count(s.ppa_count),
    active: deck.filters.status === s.stage,
    note: compactPeso(s.total_amount),
  }))
  const progress: Datum[] = deck.progress.map((p) => ({
    key: p.state,
    label: PROGRESS_LABELS[p.state] ?? p.state,
    value: p.ppa_count,
    display: count(p.ppa_count),
    note: compactPeso(p.total_amount),
  }))

  return (
    <Slide
      title="Status and Review Pipeline"
      subtitle="How far each line of the programme has got"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Each checkpoint is counted on its own evidence and none is inferred
            from another, so the columns need not fall evenly: a line can be
            accepted with no department reading on record — reopening an AIP
            returns it to draft without erasing a reading, and rows encoded
            before the two-stage review carry none.
          </p>
        </>
      }
    >
      <StatRow columns={4}>
        <StatTile label="Lines in the programme" value={count(deck.overview.ppa_count)} />
        <StatTile label="Accepted into the consolidation"
                  value={count(accepted?.ppa_count ?? 0)}
                  exact={accepted?.total_amount ?? null} />
        <StatTile label="Money has moved on"
                  value={count(disbursed?.ppa_count ?? 0)}
                  exact={disbursed?.total_amount ?? null}
                  note="at least one disbursement recorded" />
        <StatTile label="Period status"
                  value={deck.document.period_status.replace(/_/g, ' ')}
                  note={deck.document.draft_label ?? undefined} />
      </StatRow>

      <Columns ratio="1.2fr 1.5fr 1fr">
        <Panel title="Checkpoints passed" note="From encoding through to payment">
          <ColumnBarChart data={checkpoints} emptyMessage="Nothing encoded yet." />
        </Panel>
        <Panel title="Where each line stands now">
          <RankedBarChart data={stages} unit="PPAs" nameWidth={148} maxLabel={20}
                          emptyMessage="Nothing encoded yet." />
        </Panel>
        <Panel title="Physical delivery">
          <Share data={progress} centre={count(deck.overview.ppa_count)} centreLabel="PPAs" />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 7. Investment portfolio — where the money is concentrated
// ---------------------------------------------------------------------------

export function PrioritySlide({ deck }: SlideProps) {
  const d = deck.decisions
  const o = deck.overview

  const largest: Datum[] = deck.top_ppas.slice(0, 8).map((p) => ({
    key: p.ppa_id,
    label: p.description,
    value: p.amount_total,
    display: compactPeso(p.amount_total),
    note: `${p.department_code} · ${p.sector_name}${p.is_continuing ? ' · continuing' : ''}`,
  }))
  const byAge: Datum[] = [
    { key: 'new', label: 'New this year', value: o.new_amount,
      display: compactPeso(o.new_amount), note: ppas(o.new_count) },
    { key: 'continuing', label: 'Continuing', value: o.continuing_amount,
      display: compactPeso(o.continuing_amount), note: ppas(o.continuing_count) },
  ]

  return (
    <Slide
      title="Investment Portfolio"
      subtitle="Where the money is concentrated"
      eyebrow={documentEyebrow(deck)}
      caption={filterCaption(deck)}
    >
      <StatRow columns={4}>
        <StatTile label="Largest single PPA"
                  value={compactPeso(o.largest_amount)} exact={o.largest_amount} />
        <StatTile label="The ten largest, together"
                  value={compactPeso(d.top_ten_ppa_amount)} exact={d.top_ten_ppa_amount}
                  note={`${percent(d.top_ten_ppa_share)} of the programme`} />
        <StatTile label="Median PPA"
                  value={compactPeso(o.median_amount)} exact={o.median_amount}
                  note={`average ${compactPeso(o.average_amount)}`} />
        <StatTile label="Top three sectors, together"
                  value={percent(d.top_three_sector_share)}
                  note="share of the programme" />
      </StatRow>

      <Columns ratio="1.6fr 1fr">
        <Panel title="The largest lines of the programme">
          <RankedBarChart data={largest} unit="Programmed" nameWidth={250} maxLabel={38}
                          emptyMessage="Nothing programmed yet." />
        </Panel>
        <Panel title="Continuing and new">
          <Share data={byAge} centre={compactPeso(o.total_amount)} centreLabel="programmed" />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 8. Programme against recorded resources
// ---------------------------------------------------------------------------

export function ResourcesSlide({ deck }: SlideProps) {
  const r = deck.resources
  const overCeiling = deck.decisions.funds_over_ceiling

  // Four figures side by side, never added together: the NTA is a resource and
  // the other three are separate documents.
  const scale: Datum[] = [
    { key: 'nta', label: 'NTA recorded', value: r.nta_amount ?? 0,
      display: r.nta_amount === null ? 'Not stated' : compactPeso(r.nta_amount) },
    { key: 'annual', label: 'Annual AIP', value: r.annual_programmed,
      display: compactPeso(r.annual_programmed), active: true },
    { key: 'supp', label: 'Supplementals', value: r.supplemental_programmed,
      display: compactPeso(r.supplemental_programmed) },
    { key: 'statutory', label: 'Statutory funds', value: r.statutory_programmed,
      display: compactPeso(r.statutory_programmed) },
  ]

  const funds = deck.statutory_funds.map((f) => ({
    label: f.label,
    programmed: f.programmed_amount,
    ceiling: f.ceiling_amount ?? 0,
  }))

  return (
    <Slide
      title="Programme against Recorded Resources"
      subtitle="Measured against the figures TRACKS holds, and nothing else"
      eyebrow={documentEyebrow(deck)}
      caption={
        <p>
          <strong>Every figure here is recorded, none is projected.</strong> The
          resource line is the National Tax Allotment the City Planning
          administrator entered for CY {deck.document.year}; TRACKS holds no
          revenue estimate and none is inferred. A gap against this figure is a
          gap against the NTA alone — it is not a statement about the
          city&apos;s whole income. The four columns are never added together:
          the NTA is a resource and the other three are separate documents.
          {r.funds_without_base > 0
            ? ` ${r.funds_without_base} statutory fund${r.funds_without_base === 1 ? ' has' : 's have'} no base stated for the year, so ${r.funds_without_base === 1 ? 'its ceiling reads zero' : 'their ceilings read zero'} rather than a figure.`
            : null}
        </p>
      }
    >
      <StatRow columns={4}>
        <StatTile label="Annual programme"
                  value={compactPeso(r.annual_programmed)} exact={r.annual_programmed} />
        <StatTile label="National Tax Allotment recorded"
                  value={r.nta_amount === null ? 'Not stated' : compactPeso(r.nta_amount)}
                  exact={r.nta_amount} />
        <StatTile label={r.gap !== null && r.gap < 0 ? 'Programmed over the NTA' : 'Unprogrammed against the NTA'}
                  tone={r.gap !== null && r.gap < 0 ? 'warning' : 'default'}
                  value={r.gap === null ? '—' : compactPeso(Math.abs(r.gap))}
                  exact={r.gap === null ? null : Math.abs(r.gap)}
                  note={r.gap === null ? 'no NTA figure on record' : undefined} />
        <StatTile label="Of the NTA, programmed" value={percent(r.covered_pct)} />
      </StatRow>

      <Columns ratio="1fr 1.2fr">
        <Panel title="The year at a glance" note="Four figures, never one total">
          <ColumnBarChart data={scale} />
        </Panel>
        <Panel title="Statutory funds against their stated ceiling"
               note={overCeiling.length > 0
                 ? `${overCeiling.length} fund${overCeiling.length === 1 ? ' is' : 's are'} programmed past the ceiling — reported, never refused`
                 : 'A fund with no base stated for the year has no ceiling to show'}>
          <GroupedBarChart
            data={funds}
            layout="vertical"
            nameWidth={110}
            formatter={compactPeso}
            series={[
              { key: 'programmed', label: 'Programmed' },
              { key: 'ceiling', label: 'Ceiling' },
            ]}
            emptyMessage="No statutory fund is set up for this year."
          />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 9. Multi-year trends
// ---------------------------------------------------------------------------

export function TrendsSlide({ deck }: SlideProps) {
  const years = deck.trend.map((y) => ({
    label: `CY ${y.year}`,
    total: y.total_amount,
  }))

  // One line per sector, over the same years. Grouped here rather than in SQL
  // because reshaping rows is not arithmetic — every figure is the one the
  // database returned.
  const sectorNames = [...new Map(
    deck.trend_sectors.map((s) => [s.sector_id, s.name])).entries()]
  const byYear = new Map<number, Record<string, string | number>>()
  for (const year of deck.trend) {
    byYear.set(year.year, { label: `CY ${year.year}` })
  }
  for (const [id] of sectorNames) {
    for (const row of byYear.values()) row[id] = 0
  }
  for (const row of deck.trend_sectors) {
    const entry = byYear.get(row.year)
    if (entry) entry[row.sector_id] = row.total_amount
  }

  return (
    <Slide
      title="Multi-Year Trends"
      subtitle={`${deck.document.fund_name ?? (deck.document.kind === 'supplemental' ? 'Supplemental programmes' : 'Annual Investment Program')}, every year on record`}
      eyebrow={documentEyebrow(deck)}
      caption={
        <p>
          Every programme year in TRACKS is shown, including any in which this
          document was never filed — a year at zero is a gap in the record, not
          a year with nothing in it.
        </p>
      }
    >
      <Columns ratio="1fr 1fr">
        <Panel title="Total investment by year">
          <TrendLineChart
            data={years}
            formatter={compactPeso}
            series={[{ key: 'total', label: 'Programmed' }]}
          />
        </Panel>
        <Panel title="By sector" note="Same years, one line per sector">
          <TrendLineChart
            data={[...byYear.values()]}
            formatter={compactPeso}
            series={sectorNames.map(([id, name]) => ({ key: id, label: name }))}
            emptyMessage="No sector has a figure in any year yet."
          />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 10. Execution and monitoring
// ---------------------------------------------------------------------------

export function ExecutionSlide({ deck }: SlideProps) {
  const e = deck.execution
  const ahead = e.variance_points !== null && e.variance_points > 0

  const bySector = deck.execution_sectors.map((s) => ({
    label: s.name,
    obligated: s.obligation_rate ?? 0,
    physical: s.physical_weighted_pct ?? 0,
  }))

  return (
    <Slide
      title="Execution and Monitoring"
      subtitle="Allotment, obligation, disbursement and physical progress"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Utilisation is measured against the <strong>allotment</strong> — what
            Budget actually released — not against the programmed amount, and the
            two are shown together because they differ. Physical progress is
            weighted by amount and speaks only for the{' '}
            {count(e.physical_reported_count)} of {count(e.ppa_count)} lines that
            have reported one; a line with no report is not counted as zero.
          </p>
        </>
      }
    >
      <StatRow columns={4}>
        <StatTile label="Programmed" value={compactPeso(e.programmed)} exact={e.programmed} />
        <StatTile label="Allotted" value={compactPeso(e.allotted)} exact={e.allotted} />
        <StatTile label="Obligated" value={compactPeso(e.obligated)} exact={e.obligated} />
        <StatTile label="Disbursed" value={compactPeso(e.disbursed)} exact={e.disbursed} />
      </StatRow>

      <Columns ratio="1fr 1fr 1.3fr">
        <Panel title="Financial utilisation">
          <div className="flex flex-col gap-[0.8em]">
            <Meter label="Allotted, of programmed" value={e.allotment_rate} />
            <Meter label="Obligated, of allotment" value={e.obligation_rate} />
            <Meter label="Disbursed, of allotment" value={e.disbursement_rate} />
          </div>
        </Panel>

        <Panel title="Physical accomplishment">
          <div className="flex flex-col gap-[0.8em]">
            <Meter label="Weighted physical progress" value={e.physical_weighted_pct}
                   tone="success"
                   caption={`Reported on ${percent(e.physical_coverage_pct)} of the lines`} />
            <Meter label="Financial, over the same lines" value={e.variance_financial_pct} />
            <StatTile
              label={ahead ? 'Money is ahead of delivery by' : 'Delivery is ahead of money by'}
              tone={ahead && (e.variance_points ?? 0) > 20 ? 'warning' : 'default'}
              value={e.variance_points === null
                ? '—'
                : `${Math.abs(e.variance_points).toFixed(1)} pts`}
              note={e.variance_points === null
                ? 'no line has reported physical progress'
                : 'obligation rate less physical progress, same lines'} />
          </div>
        </Panel>

        <Panel title="By sector" note="Money released against work delivered">
          <GroupedBarChart
            data={bySector}
            layout="vertical"
            nameWidth={130}
            formatter={(v) => `${v.toFixed(1)}%`}
            series={[
              { key: 'obligated', label: 'Obligated, of allotment' },
              { key: 'physical', label: 'Physical progress' },
            ]}
            emptyMessage="Nothing has been allotted yet."
          />
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 11. The Mayor's project portfolio
// ---------------------------------------------------------------------------

const TH = 'px-[0.6em] py-[0.4em] text-left font-semibold'
const TD = 'px-[0.6em] py-[0.45em] align-top'

export function PortfolioSlide({ deck, portfolio }: SlideProps) {
  return (
    <Slide
      title="Mayor's Project Portfolio"
      subtitle="The major projects of the programme, largest first"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            Showing {count(portfolio.length)} of {count(deck.overview.ppa_count)} lines,
            ordered by investment. Location is read from the wording of the PPA;
            the AIP form records no location field.
          </p>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[0.95em]">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className={cn(TH, 'w-[2.5em] text-center')}>#</th>
              <th className={TH}>Project</th>
              <th className={cn(TH, 'w-[9em]')}>Office &amp; sector</th>
              <th className={cn(TH, 'w-[7em]')}>Location</th>
              <th className={cn(TH, 'w-[8em] text-right')}>Amount</th>
              <th className={cn(TH, 'w-[7em]')}>Funding</th>
              <th className={cn(TH, 'w-[8em]')}>Schedule</th>
              <th className={cn(TH, 'w-[9em]')}>Status</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-[1em] py-[3em] text-center text-muted-foreground">
                  Nothing programmed in this document yet.
                </td>
              </tr>
            ) : null}
            {portfolio.map((row, i) => (
              <tr key={row.ppa_id} className="border-t border-border/70">
                <td className={cn(TD, 'text-center tabular-nums text-muted-foreground')}>{i + 1}</td>
                <td className={TD}>
                  <span className="font-medium">{row.description}</span>
                  {row.is_continuing ? (
                    <span className="ml-[0.5em] rounded-sm bg-secondary px-[0.4em] py-[0.1em] text-[0.85em]">
                      continuing
                    </span>
                  ) : null}
                  {row.expected_output ? (
                    <span className="mt-[0.15em] block text-[0.9em] text-muted-foreground">
                      {row.expected_output}
                    </span>
                  ) : null}
                </td>
                <td className={cn(TD, 'text-muted-foreground')}>
                  <span className="block font-medium text-foreground">{row.department_code}</span>
                  {row.sector_name}
                </td>
                <td className={cn(TD, 'text-muted-foreground')}>
                  {row.location_label
                    ?? (row.location_bucket === 'multiple' ? 'Several barangays' : '—')}
                </td>
                <td className={cn(TD, 'text-right font-mono font-semibold tabular-nums')}>
                  {moneyTotal(row.amount_total)}
                </td>
                <td className={cn(TD, 'text-muted-foreground')}>{row.funding_source ?? '—'}</td>
                <td className={cn(TD, 'text-muted-foreground')}>
                  {row.start_date || row.end_date
                    ? `${schedule(row.start_date)} – ${schedule(row.end_date)}`
                    : '—'}
                </td>
                <td className={cn(TD, 'text-muted-foreground')}>
                  <span className="block">{STAGE_LABELS[row.workflow_stage] ?? row.workflow_stage}</span>
                  <span className="text-[0.9em]">
                    {row.physical_percent === null
                      ? 'no progress reported'
                      : `${row.physical_percent}% physical`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Slide>
  )
}

// ---------------------------------------------------------------------------
// 12. Decision summary
// ---------------------------------------------------------------------------

function Fact({ label, value, detail, tone }: {
  label: string
  value: string
  detail?: string
  tone?: 'warning' | 'default'
}) {
  return (
    <li className={cn(
      'rounded-lg border px-[0.8em] py-[0.55em]',
      tone === 'warning' ? 'border-warning/50 bg-warning/10' : 'bg-background',
    )}>
      <p className="text-[0.95em] text-muted-foreground">{label}</p>
      <p className="text-[1.25em] font-semibold">{value}</p>
      {detail ? <p className="text-[0.9em] text-muted-foreground">{detail}</p> : null}
    </li>
  )
}

export function DecisionsSlide({ deck }: SlideProps) {
  const d = deck.decisions
  const r = deck.resources

  return (
    <Slide
      title="Decision Summary"
      subtitle="What the figures say, counted from the database"
      eyebrow={documentEyebrow(deck)}
      caption={
        <>
          {filterCaption(deck)}
          <p>
            <strong>Counted, not advised.</strong> Every line on this slide is a
            figure read from the same rows the AIP workbook prints. Nothing here
            recommends a course of action — that is the room&apos;s to decide.
          </p>
        </>
      }
    >
      <Columns ratio="1fr 1fr 1fr">
        <Panel title="Concentration">
          <ul className="flex flex-col gap-[0.5em]">
            <Fact label="Largest sector"
                  value={d.top_sector?.name ?? '—'}
                  detail={d.top_sector
                    ? `${compactPeso(d.top_sector.total_amount)} · ${percent(d.top_sector.share_pct)} of the programme`
                    : undefined} />
            <Fact label="Largest office"
                  value={d.top_office?.name ?? '—'}
                  detail={d.top_office
                    ? `${compactPeso(d.top_office.total_amount)} · ${percent(d.top_office.share_pct)}`
                    : undefined} />
            <Fact label="Largest single PPA"
                  value={d.top_ppa?.name ?? '—'}
                  detail={d.top_ppa
                    ? `${compactPeso(d.top_ppa.total_amount)} · ${d.top_ppa.department_name}`
                    : undefined} />
            <Fact label="Top three sectors together"
                  value={percent(d.top_three_sector_share)}
                  detail={`the ten largest PPAs are ${percent(d.top_ten_ppa_share)} of the programme`} />
          </ul>
        </Panel>

        <Panel title="Funding">
          <ul className="flex flex-col gap-[0.5em]">
            <Fact label="PPAs with no funding source stated"
                  tone={d.unfunded_count > 0 ? 'warning' : 'default'}
                  value={count(d.unfunded_count)}
                  detail={`${compactPeso(d.unfunded_amount)} of the programme`} />
            <Fact label={r.gap !== null && r.gap < 0
                    ? 'Programmed beyond the recorded NTA'
                    : 'NTA not yet programmed'}
                  tone={r.gap !== null && r.gap < 0 ? 'warning' : 'default'}
                  value={r.gap === null ? 'No NTA on record' : compactPeso(Math.abs(r.gap))}
                  detail={r.covered_pct === null
                    ? 'the year’s NTA has not been entered'
                    : `${percent(r.covered_pct)} of the NTA is programmed`} />
            <Fact label="Statutory funds past their stated ceiling"
                  tone={d.funds_over_ceiling.length > 0 ? 'warning' : 'default'}
                  value={count(d.funds_over_ceiling.length)}
                  detail={d.funds_over_ceiling.length > 0
                    ? d.funds_over_ceiling
                        .map((f) => `${f.label} over by ${compactPeso(f.over_by)}`).join('; ')
                    : 'none, of the funds with a base stated'} />
            <Fact label="Statutory funds with no base stated"
                  value={count(r.funds_without_base)}
                  detail="no ceiling can be reported for these" />
          </ul>
        </Panel>

        <Panel title="Execution">
          <ul className="flex flex-col gap-[0.5em]">
            <Fact label="Accepted PPAs with no allotment"
                  tone={d.accepted_unallotted > 0 ? 'warning' : 'default'}
                  value={count(d.accepted_unallotted)}
                  detail={`${compactPeso(d.accepted_unallotted_amount)} approved, nothing released`} />
            <Fact label="Offices with an allotment but no obligation"
                  tone={d.offices_with_no_obligation > 0 ? 'warning' : 'default'}
                  value={count(d.offices_with_no_obligation)} />
            <Fact label="Allotted PPAs with no progress report"
                  value={count(d.allotted_unreported)}
                  detail="money released, nothing reported back" />
            <Fact label="Obligated more than 25 points ahead of delivery"
                  tone={d.lagging_physical > 0 ? 'warning' : 'default'}
                  value={count(d.lagging_physical)}
                  detail={`unpaid obligations stand at ${compactPeso(d.unpaid_obligations)}`} />
          </ul>
        </Panel>
      </Columns>
    </Slide>
  )
}

// ---------------------------------------------------------------------------

const SLIDE_COMPONENTS: Record<SlideId, (props: SlideProps) => React.ReactElement> = {
  summary: SummarySlide,
  sectors: SectorsSlide,
  offices: OfficesSlide,
  barangays: BarangaysSlide,
  funding: FundingSlide,
  resources: ResourcesSlide,
  pipeline: PipelineSlide,
  execution: ExecutionSlide,
  trends: TrendsSlide,
  priority: PrioritySlide,
  portfolio: PortfolioSlide,
  decisions: DecisionsSlide,
}

export function RenderSlide({ id, ...props }: SlideProps & { id: SlideId }) {
  const Component = SLIDE_COMPONENTS[id]
  return <Component {...props} />
}
