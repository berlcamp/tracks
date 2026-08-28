'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  recordAllotment, recordDisbursement, recordObligation, recordProgress,
} from '@/app/actions/execution'
import { moneyTotal } from '@/lib/format'
import type { PpaLedger } from '@/lib/data/execution'
import type { UserRole } from '@/types/tracks'

/**
 * One PPA's execution ledger.
 *
 * The three transaction kinds are separate tabs because they are separate
 * offices' work: Budget records the allotment and the OBR, Accounting records
 * the DV. The buttons follow the role; the database follows it again.
 *
 * `canRecordMoney` says whether this copy of the ledger is the place money is
 * entered. It is a placement decision, not a permission — Budget & Obligations
 * is the workspace, monitoring is the report, and a report that also takes
 * entries is a report people edit by accident. The officer's rights are
 * unchanged: they record the same OBR from /budget, and RLS would let them
 * either way. Physical progress is not money and stays available on both,
 * because the implementing office reports it from the monitoring side.
 */

type Kind = 'allotment' | 'obligation' | 'disbursement' | 'progress'

export function PpaLedgerPanel({
  ppaId, title, subtitle, approvedAmount, ledger, role, isSuperAdmin,
  canRecordMoney,
}: {
  ppaId: string
  title: string
  subtitle: string
  approvedAmount: number
  ledger: PpaLedger
  role: UserRole | null
  isSuperAdmin: boolean
  /** Whether this screen is where allotments, OBRs and DVs are entered. */
  canRecordMoney: boolean
}) {
  const [dialog, setDialog] = useState<Kind | null>(null)

  const isBudget = canRecordMoney && (isSuperAdmin || role === 'budget')
  const isAccounting = canRecordMoney && (isSuperAdmin || role === 'accounting')
  const isPlanning = isSuperAdmin || role === 'planning_staff' || role === 'planning_admin'

  const f = ledger.financials

  return (
    <div className="flex min-w-0 flex-col gap-5 rounded-lg border border-border p-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Programmed" value={approvedAmount} />
        <Figure label="Allotted" value={Number(f?.allotted ?? 0)} />
        <Figure label="Obligated" value={Number(f?.obligated ?? 0)} />
        <Figure label="Disbursed" value={Number(f?.disbursed ?? 0)} />
      </div>

      {f && Number(f.allotted) > 0 && Number(f.allotted) < approvedAmount ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Allotted {moneyTotal(Number(f.allotted))} of {moneyTotal(approvedAmount)} programmed.
          Utilisation below is measured against the allotment, not the programmed amount.
        </p>
      ) : null}

      <Tabs defaultValue="obligations">
        <TabsList>
          <TabsTrigger value="allotments">Allotments</TabsTrigger>
          <TabsTrigger value="obligations">Obligations</TabsTrigger>
          <TabsTrigger value="disbursements">Disbursements</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </TabsList>

        <TabsContent value="allotments" className="mt-4 flex flex-col gap-3">
          {isBudget ? (
            <AddButton label="Record allotment" onClick={() => setDialog('allotment')} />
          ) : null}
          <LedgerTable
            head={['Date', 'Reference', 'Remarks', 'Amount']}
            rows={ledger.allotments.map((a) => [
              a.allotment_date, a.reference_no ?? '—', a.remarks ?? '—', moneyTotal(a.amount),
            ])}
            empty="No allotment released yet."
          />
        </TabsContent>

        <TabsContent value="obligations" className="mt-4 flex flex-col gap-3">
          {isBudget ? (
            <AddButton label="Record obligation" onClick={() => setDialog('obligation')} />
          ) : null}
          <LedgerTable
            head={['Date', 'OBR No.', 'Payee', 'Status', 'Amount']}
            rows={ledger.obligations.map((o) => [
              o.obligation_date, o.obr_no ?? '—', o.payee ?? '—',
              o.status === 'cancelled' ? 'Cancelled' : 'Active', moneyTotal(o.amount),
            ])}
            empty="Nothing obligated yet."
          />
        </TabsContent>

        <TabsContent value="disbursements" className="mt-4 flex flex-col gap-3">
          {isAccounting ? (
            <AddButton label="Record disbursement" onClick={() => setDialog('disbursement')} />
          ) : null}
          <LedgerTable
            head={['Date', 'DV No.', 'Check / ADA', 'Against OBR', 'Amount']}
            rows={ledger.disbursements.map((d) => [
              d.disbursement_date, d.dv_no ?? '—', d.check_ada_no ?? '—',
              d.obligation_id
                ? ledger.obligations.find((o) => o.id === d.obligation_id)?.obr_no ?? 'linked'
                : 'not linked',
              moneyTotal(d.amount),
            ])}
            empty="Nothing disbursed yet."
          />
        </TabsContent>

        <TabsContent value="progress" className="mt-4 flex flex-col gap-3">
          {isPlanning || role === 'dept_encoder' || role === 'dept_head' ? (
            <AddButton label="Report progress" onClick={() => setDialog('progress')} />
          ) : null}
          <LedgerTable
            head={['As of', 'Complete', 'Remarks']}
            rows={ledger.progress.map((p) => [
              p.as_of_date, `${p.percent_complete}%`, p.remarks ?? '—',
            ])}
            empty="No physical accomplishment reported yet."
          />
        </TabsContent>
      </Tabs>

      <RecordDialog
        kind={dialog}
        ppaId={ppaId}
        obligations={ledger.obligations.filter((o) => o.status === 'active')}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-sm font-medium tabular-nums" title={moneyTotal(value)}>
        {moneyTotal(value)}
      </p>
    </div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button size="sm" onClick={onClick}>
        <Plus className="size-4" /> {label}
      </Button>
    </div>
  )
}

function LedgerTable({ head, rows, empty }: {
  head: string[]; rows: string[][]; empty: string
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((column, index) => (
              <TableHead key={column}
                         className={index === head.length - 1 ? 'text-right' : undefined}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={head.length} className="py-8 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  key={cellIndex}
                  className={cellIndex === row.length - 1
                    ? 'text-right font-mono tabular-nums'
                    : undefined}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

const TITLES: Record<Kind, string> = {
  allotment: 'Record an allotment',
  obligation: 'Record an obligation',
  disbursement: 'Record a disbursement',
  progress: 'Report physical progress',
}

const NO_OBLIGATION = '__none__'

function RecordDialog({ kind, ppaId, obligations, onClose }: {
  kind: Kind | null
  ppaId: string
  obligations: PpaLedger['obligations']
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [obligationId, setObligationId] = useState<string>(NO_OBLIGATION)
  const [pending, startTransition] = useTransition()

  if (!kind) return null

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '')

    startTransition(async () => {
      const result =
        kind === 'allotment'
          ? await recordAllotment({
              ppaId, amount: value('amount'), allotmentDate: value('date'),
              referenceNo: value('reference'), remarks: value('remarks'),
            })
          : kind === 'obligation'
            ? await recordObligation({
                ppaId, amount: value('amount'), obligationDate: value('date'),
                obrNo: value('reference'), payee: value('payee'),
                particulars: value('particulars'),
              })
            : kind === 'disbursement'
              ? await recordDisbursement({
                  ppaId, amount: value('amount'), disbursementDate: value('date'),
                  dvNo: value('reference'), checkAdaNo: value('check'),
                  payee: value('payee'), particulars: value('particulars'),
                  obligationId: obligationId === NO_OBLIGATION ? '' : obligationId,
                })
              : await recordProgress({
                  ppaId, asOfDate: value('date'),
                  percentComplete: value('percent'), remarks: value('remarks'),
                })

      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Recorded.')
      setObligationId(NO_OBLIGATION)
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{TITLES[kind]}</DialogTitle></DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="date">
              {kind === 'progress' ? 'As of date' : 'Date'}
            </Label>
            <Input id="date" name="date" type="date" required />
          </div>

          {kind === 'progress' ? (
            <div className="grid gap-2">
              <Label htmlFor="percent">Percent complete</Label>
              <Input id="percent" name="percent" inputMode="decimal" required
                     placeholder="60" className="text-right font-mono" />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" inputMode="decimal" required
                     placeholder="0.00" className="text-right font-mono" />
            </div>
          )}

          {kind !== 'progress' ? (
            <div className="grid gap-2">
              <Label htmlFor="reference">
                {kind === 'allotment' ? 'Reference no.'
                  : kind === 'obligation' ? 'OBR no.' : 'DV no.'}
              </Label>
              <Input id="reference" name="reference" />
            </div>
          ) : null}

          {kind === 'disbursement' ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="check">Check / ADA no.</Label>
                <Input id="check" name="check" />
              </div>
              <div className="grid gap-2">
                <Label>Against obligation</Label>
                <Select value={obligationId} onValueChange={setObligationId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OBLIGATION}>Not linked to an OBR</SelectItem>
                    {obligations.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.obr_no ?? 'OBR'} · {moneyTotal(o.amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A payment left unlinked still counts toward the total, but cannot be
                  matched against an obligation in the unliquidated report.
                </p>
              </div>
            </>
          ) : null}

          {kind === 'obligation' || kind === 'disbursement' ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="payee">Payee</Label>
                <Input id="payee" name="payee" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="particulars">Particulars</Label>
                <Input id="particulars" name="particulars" />
              </div>
            </>
          ) : null}

          {kind === 'allotment' || kind === 'progress' ? (
            <div className="grid gap-2">
              <Label htmlFor="remarks">Remarks</Label>
              <Input id="remarks" name="remarks" />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Record'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

