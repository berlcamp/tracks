'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { setPeriodStatus } from '@/app/actions/settings'
import { PERIOD_STATUS_LABELS, PERIOD_STATUS_ORDER } from '@/lib/auth/permissions'
import type { PeriodStatus } from '@/types/tracks'

/**
 * Where the printed programme currently is.
 *
 * This lives beside the consolidated AIP rather than in Settings because it is
 * not reference data: it is a fact about this document, recorded by the person
 * looking at it. It goes through tracks.set_period_status, so every move is
 * audited, and the move is free in both directions — paper comes back from the
 * Mayor's Office as often as it goes out.
 *
 * `finalize_aip_period()` sets the same field for the one move it owns
 * (`open`/`consolidating` → `for_ldc`) after checking that every row has been
 * read. This control does no such checking, which is why it is the
 * administrator's alone.
 */
export function PeriodStatusControl({ periodId, status }: {
  periodId: string
  status: PeriodStatus
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="period-status" className="text-xs text-muted-foreground">
        Programme status
      </Label>
      <Select
        value={status}
        onValueChange={(next) =>
          startTransition(async () => {
            const result = await setPeriodStatus(periodId, next)
            if (result.ok) {
              toast.success(`Moved to ${PERIOD_STATUS_LABELS[next as PeriodStatus]}.`)
            } else {
              toast.error(result.error)
            }
          })}
      >
        <SelectTrigger id="period-status" className="w-56" disabled={pending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_STATUS_ORDER.map((option) => (
            <SelectItem key={option} value={option}>
              {PERIOD_STATUS_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
