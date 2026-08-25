import Link from 'next/link'
import { TracksMark } from '@/components/marketing/tracks-mark'
import { routes } from '@/lib/routes'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-6 p-8 md:p-12">
        <Link href={routes.landing} className="flex items-center gap-2.5">
          <TracksMark className="size-7" />
          <span className="text-lg font-semibold tracking-tight">TRACKS</span>
        </Link>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>

      {/* The panel is decorative; it carries no data and is hidden on small screens. */}
      <div className="relative hidden bg-gradient-to-br from-primary/12 via-primary/5 to-background lg:block">
        <div className="absolute inset-0 flex items-center justify-center p-16">
          <blockquote className="max-w-md">
            <p className="text-2xl font-medium leading-snug text-balance">
              &ldquo;The Annual Investment Program shall constitute the total resource
              requirements for all programs, projects and activities.&rdquo;
            </p>
            <footer className="mt-6 text-sm text-muted-foreground">
              Local Government Code · Annual Investment Program
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  )
}
