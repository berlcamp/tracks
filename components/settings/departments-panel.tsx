'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsTable, TableCell, TableRow } from './settings-table'
import { FormField } from './sectors-panel'
import { upsertDepartment } from '@/app/actions/settings'
import type { Department, Sector } from '@/types/tracks'

/**
 * A department belongs to exactly one sector — that is what decides which
 * worksheet its rows print on, and it is the assumption the whole consolidated
 * layout rests on.
 */
export function DepartmentsPanel({
  departments, sectors,
}: {
  departments: Department[]
  sectors: Sector[]
}) {
  const [editing, setEditing] = useState<Department | null>(null)
  const [open, setOpen] = useState(false)
  const sectorName = (id: string) => sectors.find((s) => s.id === id)?.code ?? '—'

  return (
    <>
      <SettingsTable
        description="Each department prints under one sector. The band row shows the name with its code appended, so the two cannot drift apart."
        addLabel="Add department"
        onAdd={() => { setEditing(null); setOpen(true) }}
        head={['Code', 'Name', 'Sector', 'SUMMARY no.', 'Order', 'Status', '']}
      >
        {departments.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
              No departments yet.
            </TableCell>
          </TableRow>
        ) : null}
        {departments.map((department) => (
          <TableRow key={department.id}>
            <TableCell className="font-medium">{department.code}</TableCell>
            <TableCell>{department.name}</TableCell>
            <TableCell>{sectorName(department.sector_id)}</TableCell>
            <TableCell className="tabular-nums">{department.code_number ?? '—'}</TableCell>
            <TableCell className="tabular-nums">{department.sort_order}</TableCell>
            <TableCell>
              <Badge variant={department.active ? 'secondary' : 'outline'}>
                {department.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost"
                      onClick={() => { setEditing(department); setOpen(true) }}>
                Edit
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </SettingsTable>

      <DepartmentDialog department={editing} sectors={sectors} open={open}
                        onOpenChange={setOpen} />
    </>
  )
}

function DepartmentDialog({ department, sectors, open, onOpenChange }: {
  department: Department | null
  sectors: Sector[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [sectorId, setSectorId] = useState(department?.sector_id ?? sectors[0]?.id ?? '')
  const [active, setActive] = useState(department?.active ?? true)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setSectorId(department?.sector_id ?? sectors[0]?.id ?? '')
          setActive(department?.active ?? true)
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{department ? 'Edit department' : 'Add department'}</DialogTitle>
          <DialogDescription>
            Moving a department to another sector moves every one of its rows to that
            worksheet.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const form = new FormData(event.currentTarget)
            startTransition(async () => {
              const result = await upsertDepartment({
                id: department?.id,
                sectorId,
                code: String(form.get('code') ?? ''),
                name: String(form.get('name') ?? ''),
                codeNumber: String(form.get('codeNumber') ?? ''),
                sortOrder: String(form.get('sortOrder') ?? '0'),
                active,
              })
              if (!result.ok) { setError(result.error); return }
              toast.success(department ? 'Department updated.' : 'Department added.')
              onOpenChange(false)
            })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code" name="code" defaultValue={department?.code} required
                       placeholder="CMO" />
            <div className="grid gap-2">
              <Label>Sector</Label>
              <Select value={sectorId} onValueChange={setSectorId}>
                <SelectTrigger><SelectValue placeholder="Choose a sector" /></SelectTrigger>
                <SelectContent>
                  {sectors.map((sector) => (
                    <SelectItem key={sector.id} value={sector.id}>
                      {sector.code} — {sector.heading}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <FormField label="Name" name="name" defaultValue={department?.name} required
                     placeholder="City Mayor's Office"
                     hint="The band row prints this with the code appended." />

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="SUMMARY code no." name="codeNumber"
                       defaultValue={department?.code_number?.toString() ?? ''} />
            <FormField label="Sort order" name="sortOrder"
                       defaultValue={String(department?.sort_order ?? 0)} required />
            <div className="flex items-end gap-3 pb-2">
              <Switch id="dept-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="dept-active">Active</Label>
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
      </DialogContent>
    </Dialog>
  )
}
