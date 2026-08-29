import { cookies } from 'next/headers'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import type { SessionContext } from '@/lib/auth/session'
import { ROLE_LABELS } from '@/lib/auth/permissions'
import { isDepartmentUser } from '@/lib/auth/permissions'
import { getVisibleDemoPeriod } from '@/lib/data/aip'
import { visibleNav } from '@/lib/nav'
import { DemoBanner } from './demo-banner'
import { AppSidebar } from './app-sidebar'
import { SidebarUserMenu } from './sidebar-user-menu'
import { ThemeToggle } from './theme-toggle'

export async function AppShell({
  session, children,
}: {
  session: SessionContext
  children: React.ReactNode
}) {
  const sections = visibleNav(session.role, session.isSuperAdmin, session.department !== null)

  const roleLabel = session.isSuperAdmin && !session.role
    ? 'Administrator'
    : session.role ? ROLE_LABELS[session.role] : 'No role assigned'

  // Read the collapse state on the server so a collapsed rail does not flash
  // open on first paint. The cookie name is the one SidebarProvider writes.
  const store = await cookies()
  const defaultOpen = store.get('sidebar_state')?.value !== 'false'

  // Null unless demo mode is on: `aip_periods_read` hides a demo period while
  // the switch is off, so this one read is both the test and the answer.
  const demoPeriod = await getVisibleDemoPeriod()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        sections={sections}
        subtitle={session.department?.code ?? 'City Planning Office'}
        footer={
          <SidebarUserMenu
            fullName={session.profile.full_name}
            email={session.profile.email}
            avatarUrl={session.profile.avatar_url}
            roleLabel={roleLabel}
          />
        }
      />
      {/* SidebarInset ships `w-full`, which measures the wrapper's full width and
          then sits *after* the 256px rail — pushing the document 256px wider than
          the viewport. `w-auto flex-1 min-w-0` makes it take the remaining space
          instead, and lets a wide grid scroll inside its own container rather
          than scrolling the page. */}
      <SidebarInset className="w-auto min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm text-muted-foreground">
            {session.department ? session.department.display_name : 'City-wide'}
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        {demoPeriod ? (
          <DemoBanner
            period={demoPeriod}
            isDepartmentUser={isDepartmentUser(session.role)}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
