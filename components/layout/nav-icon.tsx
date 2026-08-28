import {
  Activity, Layers, LayoutDashboard, MonitorPlay, Settings, Table, Wallet,
} from 'lucide-react'
import type { NavItem } from '@/lib/nav'

const ICONS = {
  'layout-dashboard': LayoutDashboard,
  table: Table,
  layers: Layers,
  wallet: Wallet,
  activity: Activity,
  presentation: MonitorPlay,
  settings: Settings,
} as const

export function NavIcon({ name, className }: { name: NavItem['icon']; className?: string }) {
  const Icon = ICONS[name]
  return <Icon className={className} />
}
