'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingsTable, TableCell, TableRow } from './settings-table'
import { FormField } from './sectors-panel'
import { upsertStatutoryFund } from '@/app/actions/statutory'
import type { Department, StatutoryFundWithDepartments } from '@/types/tracks'

/**
 * The funds a department files beside its annual programme — the 20% CDF, the
 * 5% CDRRMF, the 5% GAD, the 1% LCPC.
 *
 * They are reference data rather than four columns on `departments`, so a fifth
 * mandated fund is an afternoon here instead of a migration. The list of
 * departments against a fund governs what may be STARTED: removing an office
 * takes away its Start button and leaves every document it has already filed
 * exactly where it was.
 */
export function StatutoryFundsPanel({
  funds, departments,
}: {
  funds: StatutoryFundWithDepartments[]
  departments: Department[]
}) {
  const [editing, setEditing] = useState<StatutoryFundWithDepartments | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <SettingsTable
        description="Each fund is a separate document with its own rows, its own review and its own printout — never part of the annual AIP's grand total. A department sees the Start button only if it is listed here."
        addLabel="Add fund"
        onAdd={() => { setEditing(null); setOpen(true) }}
        head={['Code', 'Fund', 'Share', 'Worksheet', 'Filed by', 'Order', 'Status', '']}
      >
        {funds.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
              No statutory funds yet.
            </TableCell>
          </TableRow>
        ) : null}
        {funds.map((fund) => (
          <TableRow key={fund.id}>
            <TableCell className="font-medium">{fund.code}</TableCell>
            <TableCell>
              {fund.name}
              <span className="block text-xs text-muted-foreground">{fund.short_label}</span>
            </TableCell>
            <TableCell className="tabular-nums">{Number(fund.percentage)}%</TableCell>
            <TableCell className="text-muted-foreground">{fund.sheet_name}</TableCell>
            <TableCell>
              {fund.department_ids.length === 0 ? (
                <span className="text-muted-foreground">No office assigned</span>
              ) : (
                `${fund.department_ids.length} ${
                  fund.department_ids.length === 1 ? 'office' : 'offices'}`
              )}
            </TableCell>
            <TableCell className="tabular-nums">{fund.sort_order}</TableCell>
            <TableCell>
              <Badge variant={fund.active ? 'secondary' : 'outline'}>
                {fund.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost"
                      onClick={() => { setEditing(fund); setOpen(true) }}>
                Edit
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </SettingsTable>

      <FundDialog fund={editing} departments={departments} open={open}
                  onOpenChange={setOpen} />
    </>
  )
}

/**
 * A thin shell; the form is remounted by `key` whenever the fund being edited
 * changes — the same pattern as PpaDialog, and for the same reason.
 *
 * Resetting the fields from the Dialog's own `onOpenChange` does not work here:
 * the panel opens this by setting state directly, and Radix calls
 * `onOpenChange` only for interactions it owns (escape, a click outside). The
 * reset never ran, `useState` initialisers only run on mount, and so the
 * ticked departments of the fund edited before stayed ticked on the next one.
 */
function FundDialog({ fund, departments, open, onOpenChange }: {
  fund: StatutoryFundWithDepartments | null
  departments: Department[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open ? (
          <FundForm
            key={fund?.id ?? 'new'}
            fund={fund}
            departments={departments}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FundForm({ fund, departments, onOpenChange }: {
  fund: StatutoryFundWithDepartments | null
  departments: Department[]
  onOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(fund?.active ?? true)
  const [departmentIds, setDepartmentIds] = useState<string[]>(fund?.department_ids ?? [])
  const [pending, startTransition] = useTransition()

  const toggle = (id: string, checked: boolean) =>
    setDepartmentIds((current) =>
      checked ? [...current, id] : current.filter((d) => d !== id))

  return (
    <>
        <DialogHeader>
          <DialogTitle>{fund ? 'Edit fund' : 'Add fund'}</DialogTitle>
          <DialogDescription>
            The share is written the way the statute writes it — 20 for the 20% Development
            Fund. What it is a share of is entered on the Consolidated AIP, because that
            figure changes every year.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await upsertStatutoryFund({
                id: fund?.id,
                code: String(form.get('code') ?? ''),
                name: String(form.get('name') ?? ''),
                shortLabel: String(form.get('shortLabel') ?? ''),
                sheetName: String(form.get('sheetName') ?? ''),
                percentage: String(form.get('percentage') ?? ''),
                sortOrder: String(form.get('sortOrder') ?? '0'),
                active,
                departmentIds,
              })
              if (!result.ok) { setError(result.error); return }
              toast.success(fund ? 'Fund updated.' : 'Fund added.')
              onOpenChange(false)
            })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code" name="code" defaultValue={fund?.code} required
                       placeholder="CDF20" />
            <FormField label="Short label" name="shortLabel" defaultValue={fund?.short_label}
                       required placeholder="20% CDF"
                       hint="What the buttons and chips say." />
          </div>

          <FormField label="Name" name="name" defaultValue={fund?.name} required
                     placeholder="20% Development Fund" />

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Worksheet name" name="sheetName" defaultValue={fund?.sheet_name}
                       required placeholder="20% CDF" />
            <FormField label="Share (%)" name="percentage"
                       defaultValue={fund ? String(Number(fund.percentage)) : ''} required
                       placeholder="20" />
            <FormField label="Sort order" name="sortOrder"
                       defaultValue={String(fund?.sort_order ?? 0)} required />
          </div>

          <div className="grid gap-2">
            <Label>Filed by</Label>
            <p className="text-xs text-muted-foreground">
              Only these offices are offered this fund. Un-ticking one takes away its Start
              button; a document it has already filed stays exactly as it is.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {departments.map((department) => (
                  <div key={department.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`fund-dept-${department.id}`}
                      checked={departmentIds.includes(department.id)}
                      onCheckedChange={(checked) => toggle(department.id, checked === true)}
                    />
                    <Label htmlFor={`fund-dept-${department.id}`}
                           className="text-sm font-normal">
                      {department.display_name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="fund-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="fund-active">Active</Label>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
    </>
  )
}
