'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createPpa, updatePpa } from '@/app/actions/ppa'
import { moneyTotal } from '@/lib/format'
import type { PpaGroup, PpaRowView } from '@/types/tracks'

/**
 * Add/edit a PPA.
 *
 * A modal rather than in-cell editing: the grid is read as a document, and the
 * four expense classes plus the schedule need labels and validation that a
 * spreadsheet cell cannot carry. The running total updates as you type, because
 * column (12) is the number everyone checks.
 */

export interface PpaDialogProps {
  aipId: string
  groups: PpaGroup[]
  /** null opens the dialog in "add" mode. */
  row: PpaRowView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FormState {
  groupId: string
  refCode: string
  description: string
  implementingOffice: string
  startDate: string
  endDate: string
  expectedOutput: string
  fundingSource: string
  amountPs: string
  amountMooe: string
  amountFe: string
  amountCo: string
}

const EMPTY: FormState = {
  groupId: '', refCode: '', description: '', implementingOffice: '',
  startDate: '', endDate: '', expectedOutput: '', fundingSource: '',
  amountPs: '', amountMooe: '', amountFe: '', amountCo: '',
}

const NO_GROUP = '__none__'

function fromRow(row: PpaRowView): FormState {
  return {
    groupId: row.group_id ?? '',
    refCode: row.ref_code ?? '',
    description: row.description,
    implementingOffice: row.implementing_office ?? '',
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    expectedOutput: row.expected_output ?? '',
    fundingSource: row.funding_source ?? '',
    amountPs: numberField(row.amount_ps),
    amountMooe: numberField(row.amount_mooe),
    amountFe: numberField(row.amount_fe),
    amountCo: numberField(row.amount_co),
  }
}

function numberField(value: number | string): string {
  const n = Number(value)
  return !Number.isFinite(n) || n === 0 ? '' : String(n)
}

/**
 * The dialog is a thin shell; the form is remounted by `key` whenever the row
 * being edited changes. Resetting fields from an effect instead would set state
 * synchronously during the commit and cascade an extra render on every open.
 */
export function PpaDialog({ aipId, groups, row, open, onOpenChange }: PpaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        {open ? (
          <PpaForm
            key={row?.id ?? 'new'}
            aipId={aipId}
            groups={groups}
            row={row}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PpaForm({ aipId, groups, row, onOpenChange }: Omit<PpaDialogProps, 'open'>) {
  const [form, setForm] = useState<FormState>(() => (row ? fromRow(row) : EMPTY))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const total = useMemo(() => {
    const parse = (value: string) => {
      const n = Number(value.replace(/,/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    return parse(form.amountPs) + parse(form.amountMooe)
      + parse(form.amountFe) + parse(form.amountCo)
  }, [form.amountPs, form.amountMooe, form.amountFe, form.amountCo])

  const set = <K extends keyof FormState>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const payload = { aipId, ...form, groupId: form.groupId === NO_GROUP ? '' : form.groupId }

    startTransition(async () => {
      const result = row
        ? await updatePpa(row.id, payload)
        : await createPpa(payload)

      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(row ? 'Item updated.' : 'Item added.')
      onOpenChange(false)
    })
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>{row ? 'Edit item' : 'Add item'}</DialogTitle>
          <DialogDescription>
            {row?.is_returned
              ? `Returned by City Planning: ${row.open_return_reason}`
              : 'Columns (1) through (12) of the AIP form.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="AIP Ref. Code" htmlFor="ppa-ref-code" hint="(1)">
              <Input id="ppa-ref-code" value={form.refCode} onChange={set('refCode')}
                     placeholder="1000-000-2-1-01-001-001-001" className="font-mono" />
            </Field>
            <Field label="Column-C grouping" htmlFor="ppa-group">
              <Select
                value={form.groupId || NO_GROUP}
                onValueChange={(value) =>
                  setForm((c) => ({ ...c, groupId: value === NO_GROUP ? '' : value }))}
              >
                <SelectTrigger id="ppa-group"><SelectValue placeholder="No grouping" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>No grouping</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {'— '.repeat(Math.max(0, group.depth - 1))}{group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Program / Project / Activity Description" htmlFor="ppa-description" hint="(2)" required>
            <Textarea id="ppa-description" value={form.description} onChange={set('description')} rows={2} required />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Implementing Office" htmlFor="ppa-office" hint="(3)">
              <Input id="ppa-office" value={form.implementingOffice} onChange={set('implementingOffice')} />
            </Field>
            <Field label="Start Date" htmlFor="ppa-start" hint="(4)">
              <Input id="ppa-start" type="date" value={form.startDate} onChange={set('startDate')} />
            </Field>
            <Field label="Completion Date" htmlFor="ppa-end" hint="(5)">
              <Input id="ppa-end" type="date" value={form.endDate} onChange={set('endDate')} />
            </Field>
          </div>

          <Field label="Expected Outputs" htmlFor="ppa-output" hint="(6)">
            <Textarea id="ppa-output" value={form.expectedOutput} onChange={set('expectedOutput')} rows={2} />
          </Field>

          <Field label="Funding Source" htmlFor="ppa-funding" hint="(7)">
            <Input id="ppa-funding" value={form.fundingSource} onChange={set('fundingSource')} placeholder="GF" />
          </Field>

          <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
            <legend className="px-1.5 text-sm font-medium">Amount, in pesos</legend>
            <Field label="Personal Services" htmlFor="ppa-ps" hint="(8)">
              <Input id="ppa-ps" inputMode="decimal" value={form.amountPs} onChange={set('amountPs')}
                     className="text-right font-mono" placeholder="0.00" />
            </Field>
            <Field label="MOOE" htmlFor="ppa-mooe" hint="(9)">
              <Input id="ppa-mooe" inputMode="decimal" value={form.amountMooe} onChange={set('amountMooe')}
                     className="text-right font-mono" placeholder="0.00" />
            </Field>
            <Field label="Financial Expenses" htmlFor="ppa-fe" hint="(10)">
              <Input id="ppa-fe" inputMode="decimal" value={form.amountFe} onChange={set('amountFe')}
                     className="text-right font-mono" placeholder="0.00" />
            </Field>
            <Field label="Capital Outlay" htmlFor="ppa-co" hint="(11)">
              <Input id="ppa-co" inputMode="decimal" value={form.amountCo} onChange={set('amountCo')}
                     className="text-right font-mono" placeholder="0.00" />
            </Field>
            <div className="sm:col-span-4 flex items-baseline justify-end gap-3 border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Total, column (12)</span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {moneyTotal(total)}
              </span>
            </div>
          </fieldset>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : row ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </form>
    </>
  )
}

/**
 * A labelled control. `htmlFor` is not optional: without it the label is just
 * text sitting above a box — a screen reader announces nothing, and clicking the
 * label does not focus the field.
 */
function Field({
  label, htmlFor, hint, required, children,
}: {
  label: string
  htmlFor: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        {label}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  )
}
