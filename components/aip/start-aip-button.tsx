'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createAip } from '@/app/actions/aip'
import { routes } from '@/lib/routes'

/**
 * Opens this department's submission. Once an annual AIP exists the button turns
 * into "Start a supplemental" — the database refuses a second annual either way,
 * but offering the wrong one is a worse experience than not offering it.
 */
export function StartAipButton({
  periodId, departmentId, hasAnnual,
}: {
  periodId: string
  departmentId: string
  hasAnnual: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const kind = hasAnnual ? 'supplemental' : 'annual'

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createAip({ periodId, departmentId, kind })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          router.push(routes.aip(result.data.id) as never)
        })}
    >
      <Plus className="size-4" />
      {hasAnnual ? 'Start a supplemental AIP' : 'Start our AIP'}
    </Button>
  )
}
