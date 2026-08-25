import Link from 'next/link'
import {
  ArrowRight, Building2, CheckCircle2, FileSpreadsheet, Landmark,
  ListChecks, Repeat, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { WorksheetPreview } from '@/components/marketing/worksheet-preview'
import { routes } from '@/lib/routes'

const WORKFLOW = [
  {
    icon: ListChecks,
    title: 'Departments encode their PPAs',
    body: 'Each office builds its programmes, projects and activities in a grid laid out '
      + 'exactly like the AIP form, then the department head submits it.',
  },
  {
    icon: Repeat,
    title: 'City Planning reviews item by item',
    body: 'Individual line items go back to the department with a reason. The rest of the '
      + 'submission stays locked — three corrections do not reopen two hundred rows.',
  },
  {
    icon: Landmark,
    title: 'The consolidated AIP goes out on paper',
    body: 'Print the workbook for the Local Development Council, the Mayor and the City '
      + 'Council. When the resolution comes back, record it against the programme.',
  },
  {
    icon: Wallet,
    title: 'Budget allots, execution is tracked',
    body: 'Allotments, obligations and disbursements are recorded as transactions, so '
      + 'utilisation and physical accomplishment are always current.',
  },
]

const ROLES = [
  { name: 'Department Encoder', detail: 'Builds and edits the office’s PPAs.' },
  { name: 'Department Head', detail: 'The only role that can submit the office’s AIP.' },
  { name: 'City Planning Staff', detail: 'Reviews submissions, returns items, consolidates.' },
  { name: 'City Planning Administrator', detail: 'Sectors, departments, periods and users.' },
  { name: 'Budget Office', detail: 'Records allotments and obligations.' },
  { name: 'Accounting Office', detail: 'Records disbursements against obligations.' },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-border/60 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-6">
                Annual Investment Program · Local Government
              </Badge>
              <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                The AIP your office already knows — without the version numbers
                in the filename.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
                TRACKS takes the Annual Investment Program from a department&apos;s first
                draft through consolidation, the council resolution, budget allotment and
                monitoring. It still prints the exact workbook you submit today.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href={routes.login}>
                    Sign in with Google <ArrowRight className="ml-1 size-4" />
                  </Link>
                </Button>
                <p className="text-sm text-muted-foreground">
                  Access is by invitation from the City Planning Office.
                </p>
              </div>
            </div>

            <div className="mt-16">
              <WorksheetPreview />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">
              One programme, four hands, no re-keying
            </h2>
            <p className="mt-4 text-muted-foreground text-pretty">
              The AIP passes between offices whether or not there is a system. TRACKS
              records each pass instead of starting a new spreadsheet.
            </p>
          </div>

          <ol className="mt-12 grid gap-6 md:grid-cols-2">
            {WORKFLOW.map((step, index) => (
              <li key={step.title}
                  className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <step.icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3 className="font-semibold">{step.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground text-pretty">{step.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Reports / export */}
        <section id="reports" className="border-y border-border/60 bg-muted/30">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                It prints your workbook, not a lookalike
              </h2>
              <p className="mt-4 text-muted-foreground text-pretty">
                The export reproduces the official form: the merged title block, the
                two-tier header with its numbered columns, the sector and department
                bands, the group rows, the subtotals and the SUMMARY sheet.
              </p>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'City Planning exports the consolidated programme, every sector.',
                  'A department exports only its own AIP, in the same layout.',
                  'Every figure is the one the database computed — no live formulas to decay.',
                  'Amounts print in pesos, with the misleading caption corrected.',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
              <FileSpreadsheet className="size-9 text-primary" />
              <p className="mt-5 text-lg font-medium text-pretty">
                &ldquo;Annual Investment Program (AIP), By Program/ Project/ Activity by
                Sector&rdquo;
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Columns (1) through (15), landscape, ready for the LDC folder.
              </p>
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">Who uses it</h2>
            <p className="mt-4 text-muted-foreground text-pretty">
              Each office sees the whole investment programme and can change only its own
              part of it. Access is granted by the City Planning Office.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role) => (
              <div key={role.name}
                   className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Building2 className="size-4 text-primary" />
                  <h3 className="font-medium">{role.name}</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground text-pretty">{role.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
