'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createAip } from '@/app/actions/aip'
import { routes } from '@/lib/routes'
import type { StatutoryFund } from '@/types/tracks'

/**
 * Opens this department's next document.
 *
 * Before the annual AIP exists there is only one thing to start, so this is a
 * plain button. Afterwards it becomes a menu: a supplemental, or one of the
 * statutory funds this office is listed against and has not filed yet. A menu
 * rather than a row of buttons because each entry disappears once used, and a
 * row that empties itself one button at a time reads as things going missing.
 *
 * The database refuses a second annual either way, and the RLS policy refuses a
 * fund this office does not administer — but offering an action that can only
 * fail is worse than not offering it.
 */
export function StartAipButton({
  periodId, departmentId, hasAnnual, startableFunds,
}: {
  periodId: string
  departmentId: string
  hasAnnual: boolean
  startableFunds: StatutoryFund[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const start = (kind: 'annual' | 'supplemental', fundId: string | null) =>
    startTransition(async () => {
      const result = await createAip({ periodId, departmentId, kind, fundId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.push(routes.aip(result.data.id) as never)
    })

  if (!hasAnnual) {
    return (
      <Button disabled={pending} onClick={() => start('annual', null)}>
        <Plus className="size-4" />
        Start our AIP
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={pending}>
          <Plus className="size-4" />
          Start a document
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Annual investment programme</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => start('supplemental', null)}>
          Supplemental AIP
        </DropdownMenuItem>

        {startableFunds.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Statutory funds</DropdownMenuLabel>
            {startableFunds.map((fund) => (
              <DropdownMenuItem key={fund.id} onSelect={() => start('annual', fund.id)}>
                {fund.short_label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
