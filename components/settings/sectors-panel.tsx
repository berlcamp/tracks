'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingsTable, TableCell, TableRow } from './settings-table'
import { upsertSector } from '@/app/actions/settings'
import type { Sector } from '@/types/tracks'

/**
 * Sectors are the workbook's worksheets. The three labels are separate fields
 * because the source file genuinely uses three different names for the same
 * sector — the tab says "PUBLIC SERVICES Sector", the band row inside says
 * "GENERAL PUBLIC SECTOR", and SUMMARY calls it "GOVERNANCE SECTOR".
 */
export function SectorsPanel({ sectors }: { sectors: Sector[] }) {
  const [editing, setEditing] = useState<Sector | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <SettingsTable
        description="One sector is one worksheet in the exported workbook. Only the City Planning Office can change them."
        addLabel="Add sector"
        onAdd={() => { setEditing(null); setOpen(true) }}
        head={['Code', 'Worksheet tab', 'Band row', 'SUMMARY label', 'Order', 'Status', '']}
      >
        {sectors.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
              No sectors yet.
            </TableCell>
          </TableRow>
        ) : null}
        {sectors.map((sector) => (
          <TableRow key={sector.id}>
            <TableCell className="font-medium">{sector.code}</TableCell>
            <TableCell>{sector.sheet_name}</TableCell>
            <TableCell>{sector.heading}</TableCell>
            <TableCell>{sector.summary_label}</TableCell>
            <TableCell className="tabular-nums">{sector.sort_order}</TableCell>
            <TableCell>
              <Badge variant={sector.active ? 'secondary' : 'outline'}>
                {sector.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost"
                      onClick={() => { setEditing(sector); setOpen(true) }}>
                Edit
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </SettingsTable>

      <SectorDialog sector={editing} open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * A thin shell; the form is remounted by `key` whenever the sector being edited
 * changes. Resetting from the Dialog's own `onOpenChange` never ran — the panel
 * opens this by setting state directly, and Radix calls `onOpenChange` only for
 * interactions it owns — so Active kept the previously edited sector's value.
 */
function SectorDialog({ sector, open, onOpenChange }: {
  sector: Sector | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <SectorForm key={sector?.id ?? 'new'} sector={sector}
                      onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SectorForm({ sector, onOpenChange }: {
  sector: Sector | null
  onOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(sector?.active ?? true)
  const [pending, startTransition] = useTransition()

  return (
    <>
        <DialogHeader>
          <DialogTitle>{sector ? 'Edit sector' : 'Add sector'}</DialogTitle>
          <DialogDescription>
            The workbook uses three different names for one sector. All three print.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await upsertSector({
                id: sector?.id,
                code: String(form.get('code') ?? ''),
                name: String(form.get('name') ?? ''),
                sheetName: String(form.get('sheetName') ?? ''),
                heading: String(form.get('heading') ?? ''),
                summaryLabel: String(form.get('summaryLabel') ?? ''),
                sortOrder: String(form.get('sortOrder') ?? '0'),
                active,
              })
              if (!result.ok) { setError(result.error); return }
              toast.success(sector ? 'Sector updated.' : 'Sector added.')
              onOpenChange(false)
            })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code" name="code" defaultValue={sector?.code} required
                       placeholder="PUBLIC" />
            <FormField label="Name" name="name" defaultValue={sector?.name} required
                       placeholder="Public Services" />
          </div>
          <FormField label="Worksheet tab" name="sheetName" defaultValue={sector?.sheet_name}
                     required placeholder="PUBLIC SERVICES Sector"
                     hint="Excel allows at most 31 characters." />
          <FormField label="Band row inside the sheet" name="heading" defaultValue={sector?.heading}
                     required placeholder="GENERAL PUBLIC SECTOR" />
          <FormField label="SUMMARY label" name="summaryLabel" defaultValue={sector?.summary_label}
                     required placeholder="GOVERNANCE SECTOR" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Sort order" name="sortOrder"
                       defaultValue={String(sector?.sort_order ?? 0)} required />
            <div className="flex items-end gap-3 pb-2">
              <Switch id="active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="active">Active</Label>
            </div>
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

export function FormField({
  label, name, defaultValue, required, placeholder, hint, type,
}: {
  label: string
  name: string
  defaultValue?: string
  required?: boolean
  placeholder?: string
  hint?: string
  type?: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} required={required}
             placeholder={placeholder} type={type} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
