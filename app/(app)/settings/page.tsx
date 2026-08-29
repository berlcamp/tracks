import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectorsPanel } from '@/components/settings/sectors-panel'
import { DepartmentsPanel } from '@/components/settings/departments-panel'
import { PeriodsPanel } from '@/components/settings/periods-panel'
import { UsersPanel } from '@/components/settings/users-panel'
import { StatutoryFundsPanel } from '@/components/settings/statutory-funds-panel'
import { DemoPanel, type DemoStanding } from '@/components/settings/demo-panel'
import { listFundsWithDepartments } from '@/lib/data/statutory'
import type { AipPeriod, Department, Sector, UserRole } from '@/types/tracks'

export const dynamic = 'force-dynamic'

interface UserRow {
  id: string
  role: UserRole
  status: 'active' | 'inactive'
  department_id: string | null
  profile: { id: string; email: string; full_name: string } | null
}

interface InviteRow {
  id: string
  email: string
  full_name: string
  role: UserRole
  department_id: string | null
  status: string
  expires_at: string
}

interface DemoState {
  enabled: boolean
  period: DemoStanding | null
}

export default async function SettingsPage() {
  await requireRole(['planning_admin'])
  const supabase = await createClient()

  const [sectors, departments, periods, users, invites, funds, demo] = await Promise.all([
    supabase.from('sectors').select('*').order('sort_order'),
    supabase.from('departments').select('*').order('sort_order'),
    supabase.from('aip_periods').select('*').order('year', { ascending: false }),
    supabase.from('user_roles')
      .select('id, role, status, department_id, profile:profiles(id, email, full_name)'),
    supabase.from('invites').select('*').order('created_at', { ascending: false }),
    listFundsWithDepartments(),
    // Read through an RPC rather than the tables: while demo mode is off the
    // demo year is hidden from this page by the same RLS that hides it from
    // every other one, and this panel is where somebody decides to turn it
    // back on.
    supabase.rpc('demo_standing'),
  ])

  const demoState = (demo.data ?? { enabled: false, period: null }) as DemoState

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sectors, departments, statutory funds, AIP periods and access — the City
          Planning Office&apos;s reference data.
        </p>
      </div>

      <Tabs defaultValue="sectors">
        <TabsList>
          <TabsTrigger value="sectors">Sectors</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="funds">Statutory funds</TabsTrigger>
          <TabsTrigger value="periods">AIP periods</TabsTrigger>
          <TabsTrigger value="users">Access</TabsTrigger>
          <TabsTrigger value="demo">Demo</TabsTrigger>
        </TabsList>

        <TabsContent value="sectors" className="mt-5">
          <SectorsPanel sectors={(sectors.data ?? []) as Sector[]} />
        </TabsContent>
        <TabsContent value="departments" className="mt-5">
          <DepartmentsPanel
            departments={(departments.data ?? []) as Department[]}
            sectors={(sectors.data ?? []) as Sector[]}
          />
        </TabsContent>
        <TabsContent value="funds" className="mt-5">
          <StatutoryFundsPanel
            funds={funds}
            departments={(departments.data ?? []) as Department[]}
          />
        </TabsContent>
        <TabsContent value="periods" className="mt-5">
          <PeriodsPanel periods={(periods.data ?? []) as AipPeriod[]} />
        </TabsContent>
        <TabsContent value="users" className="mt-5">
          <UsersPanel
            users={(users.data ?? []) as unknown as UserRow[]}
            invites={(invites.data ?? []) as InviteRow[]}
            departments={(departments.data ?? []) as Department[]}
          />
        </TabsContent>
        <TabsContent value="demo" className="mt-5">
          <DemoPanel enabled={demoState.enabled} standing={demoState.period} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
