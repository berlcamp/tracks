'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from '@/components/ui/sidebar'
import { TracksMark } from '@/components/marketing/tracks-mark'
import type { NavSection } from '@/lib/nav'
import { routes } from '@/lib/routes'
import { NavIcon } from './nav-icon'

export function AppSidebar({
  sections, subtitle, footer,
}: {
  sections: NavSection[]
  subtitle: string
  footer: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href={routes.dashboard}>
                <TracksMark className="size-6 shrink-0" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">TRACKS</span>
                  <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={`${section.label}-${item.label}`}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                    >
                      <Link href={item.href as never}>
                        <NavIcon name={item.icon} className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>{footer}</SidebarFooter>
    </Sidebar>
  )
}
