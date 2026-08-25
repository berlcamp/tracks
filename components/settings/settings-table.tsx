'use client'

import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Plus } from 'lucide-react'

/** The shared shell for the settings tabs: a heading, an add button, a table. */
export function SettingsTable({
  description, addLabel, onAdd, head, children,
}: {
  description: string
  addLabel: string
  onAdd: () => void
  head: string[]
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {head.map((column) => <TableHead key={column}>{column}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </div>
  )
}

export { TableCell, TableRow }
