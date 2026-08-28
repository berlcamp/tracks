import { requireSession } from '@/lib/auth/session'

/**
 * The presentation surface: authenticated, and nothing else.
 *
 * A route group of its own rather than an overlay inside the application shell.
 * An overlay only ever COVERS the sidebar — the rail keeps its place in the tab
 * order and in the accessibility tree, so somebody tabbing mid-presentation
 * lands on invisible links and a screen reader announces a navigation nobody
 * can see. Here there is no navigation to hide, because none is rendered.
 */
export const dynamic = 'force-dynamic'

export default async function PresentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireSession()
  return <div className="min-h-dvh bg-background">{children}</div>
}
