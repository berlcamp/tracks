'use client'

import { ChevronsUpDown, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { createClient } from '@/lib/supabase/browser'

export function SidebarUserMenu({
  fullName, email, avatarUrl, roleLabel,
}: {
  fullName: string
  email: string
  avatarUrl: string | null
  roleLabel: string
}) {
  const router = useRouter()
  const initials = fullName.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8 rounded-lg">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{fullName}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="grid text-sm leading-tight">
                <span className="truncate font-medium">{fullName}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await createClient().auth.signOut()
                router.push('/login')
                router.refresh()
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
