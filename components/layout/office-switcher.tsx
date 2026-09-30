'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { TracksMark } from '@/components/marketing/tracks-mark'
import { switchOffice } from '@/app/actions/office'
import { officeSwitchDestination } from '@/lib/auth/office'

export interface OfficeOption {
  departmentId: string
  code: string
  name: string
  roleLabel: string
}

/**
 * The sidebar header for a person who holds more than one office. Everyone
 * else gets the plain TRACKS mark — a switcher with one entry is a control
 * that does nothing.
 */
export function OfficeSwitcher({ offices, currentId }: {
  offices: OfficeOption[]
  currentId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const current = offices.find((o) => o.departmentId === currentId) ?? offices[0]
  if (!current) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              disabled={pending}
              aria-label={`Working as ${current.name}. Switch office`}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <TracksMark className="size-6 shrink-0" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">TRACKS</span>
                <span className="truncate text-xs text-muted-foreground">
                  {pending ? 'Switching…' : `${current.code} · ${current.roleLabel}`}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Work as
            </DropdownMenuLabel>
            {offices.map((office) => {
              const isCurrent = office.departmentId === current.departmentId
              return (
                <DropdownMenuItem
                  key={office.departmentId}
                  disabled={pending}
                  onSelect={() => {
                    if (isCurrent) return
                    startTransition(async () => {
                      const result = await switchOffice(office.departmentId)
                      if (!result.ok) { toast.error(result.error); return }
                      toast.success(`Now working as ${office.name}.`)
                      router.push(officeSwitchDestination(pathname) as never)
                      router.refresh()
                    })
                  }}
                >
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate">{office.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {office.code} · {office.roleLabel}
                    </span>
                  </div>
                  {isCurrent ? <Check className="size-4" aria-label="Current office" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
