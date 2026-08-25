import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'
import { TracksMark } from './tracks-mark'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href={routes.landing} className="flex items-center gap-2.5">
          <TracksMark className="size-7" />
          <span className="text-lg font-semibold tracking-tight">TRACKS</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#roles" className="transition-colors hover:text-foreground">Who uses it</a>
          <a href="#reports" className="transition-colors hover:text-foreground">Reports</a>
        </nav>
        <Button asChild size="sm">
          <Link href={routes.login}>Sign in</Link>
        </Button>
      </div>
    </header>
  )
}
