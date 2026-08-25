import { TracksMark } from './tracks-mark'

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <TracksMark className="size-5" />
          <span className="font-medium text-foreground">TRACKS</span>
          <span>· Annual Investment Program</span>
        </div>
        <p>Built for the City Planning and Development Services Office.</p>
      </div>
    </footer>
  )
}
