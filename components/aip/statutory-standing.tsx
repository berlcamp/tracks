'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setFundBase } from '@/app/actions/statutory'
import { moneyTotal } from '@/lib/format'
import type { StatutoryFundTotals } from '@/types/tracks'
import { cn } from '@/lib/utils'

/**
 * Programmed against the ceiling, for one statutory fund in one year.
 *
 * The ceiling is city-wide while each department files its own document, so
 * this is the only place the compliance question can be answered — one office's
 * document cannot know whether the city is within its 20%.
 *
 * Nothing here is enforced. An overage is stated plainly and the office decides
 * what to do about it: a department encoding in September must not be blocked
 * by what another office entered in August, and a refused row would send them
 * looking for a fault in their own figures.
 */
export function StatutoryStanding({
  standing, canSetBase,
}: {
  standing: StatutoryFundTotals
  canSetBase: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  const base = standing.base_amount === null ? null : Number(standing.base_amount)
  const ceiling = standing.ceiling_amount === null ? null : Number(standing.ceiling_amount)
  const programmed = Number(standing.programmed_amount)
  const remaining = standing.remaining_amount === null
    ? null
    : Number(standing.remaining_amount)
  const over = remaining !== null && remaining < 0

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{standing.fund_name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {Number(standing.percentage)}% of the year&apos;s base, across{' '}
            {standing.document_count === 1
              ? 'one document'
              : `${standing.document_count} documents`}.
          </p>
        </div>
        {canSetBase && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {base === null ? 'State the base' : 'Change the base'}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await setFundBase({
                fundId: standing.fund_id,
                periodId: standing.period_id,
                baseAmount: String(form.get('baseAmount') ?? ''),
              })
              if (!result.ok) { toast.error(result.error); return }
              toast.success('Base amount recorded.')
              setEditing(false)
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="baseAmount">
              Base amount for CY {standing.period_year}
            </Label>
            <Input
              id="baseAmount"
              name="baseAmount"
              defaultValue={base === null ? '' : String(base)}
              placeholder="0.00"
              className="w-56"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : null}

      <dl className="mt-4 grid gap-4 sm:grid-cols-4">
        <Figure label="Base" value={base} />
        <Figure label={`Ceiling (${Number(standing.percentage)}%)`} value={ceiling} />
        <Figure label="Programmed" value={programmed} />
        <Figure
          label={over ? 'Over the ceiling by' : 'Remaining'}
          value={remaining === null ? null : Math.abs(remaining)}
          tone={over ? 'over' : undefined}
        />
      </dl>

      {base === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The ceiling cannot be stated until the City Planning administrator enters what
          this fund is a share of.
        </p>
      ) : null}
      {over ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          The documents filed against this fund programme more than the ceiling allows.
          Nothing here refuses the figures — the office decides what comes out.
        </p>
      ) : null}
    </div>
  )
}

function Figure({ label, value, tone }: {
  label: string
  value: number | null
  tone?: 'over'
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn(
        'mt-0.5 font-mono text-sm tabular-nums',
        tone === 'over' && 'text-amber-700 dark:text-amber-400',
      )}>
        {value === null ? '—' : moneyTotal(value)}
      </dd>
    </div>
  )
}
