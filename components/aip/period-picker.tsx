'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { AipPeriod } from '@/types/tracks'

/**
 * Which investment programme year is on screen.
 *
 * Last year's AIP has always been readable — nothing in RLS hides it — but
 * until this there was no way to reach it: every screen took the latest period
 * and offered no way back. The year goes in the URL so a link to CY 2026's
 * consolidated programme is a link somebody can send.
 */
export function PeriodPicker({ periods, currentId }: {
  periods: AipPeriod[]
  currentId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="period-picker" className="text-xs text-muted-foreground">
        Programme year
      </Label>
      <Select
        value={currentId}
        onValueChange={(id) => {
          const next = new URLSearchParams(params.toString())
          next.set('period', id)
          router.push(`${pathname}?${next.toString()}` as never)
        }}
      >
        <SelectTrigger id="period-picker" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* A demo year is badged wherever it is offered. It is the one place
              somebody could pick it up by mistake and start encoding real work
              into a programme nobody will ever print. */}
          {periods.map((period) => (
            <SelectItem key={period.id} value={period.id}>
              <span>CY {period.year}</span>
              {period.is_demo ? (
                <Badge variant="outline" className="ml-1.5">DEMO</Badge>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
