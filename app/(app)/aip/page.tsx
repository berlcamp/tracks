import { requireSession } from '@/lib/auth/session'
import { getPeriods, listAips, resolvePeriod } from '@/lib/data/aip'
import { isDepartmentUser } from '@/lib/auth/permissions'
import { PeriodPicker } from '@/components/aip/period-picker'
import { StartAipButton } from '@/components/aip/start-aip-button'
import { SubmissionsTable } from '@/components/aip/submissions-table'
import { groupSubmissions } from '@/lib/aip/submissions'
import { listStartableFunds } from '@/lib/data/statutory'

export default async function AipListPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const session = await requireSession()
  const { period: requestedPeriod } = await searchParams
  const [period, periods] = await Promise.all([
    resolvePeriod(requestedPeriod), getPeriods(),
  ])

  if (!period) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No AIP period yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The City Planning Office has not opened an investment programme year.
        </p>
      </div>
    )
  }

  const all = await listAips(period.id)
  const departmentScoped = isDepartmentUser(session.role) && session.department
  const rows = departmentScoped
    ? all.filter((a) => a.department_id === session.department!.id)
    : all

  // The annual programme and the statutory funds are separate documents and are
  // never shown as one list. A statutory filing is `kind = 'annual'` too, so
  // splitting on kind alone would put the 20% CDF among the AIPs.
  const annual = rows.filter((a) => !a.fund_id)
  const statutory = rows.filter((a) => a.fund_id)

  const hasAnnual = annual.some((a) => a.kind === 'annual')
  const isCurrentPeriod = period.id === periods[0]?.id
  const startableFunds = departmentScoped && isCurrentPeriod && hasAnnual
    ? await listStartableFunds(session.department!.id, period.id)
    : []

  // A department's supplementals sit under its annual AIP. They are separate
  // documents — a supplemental only adds PPAs — so they are listed, not merged.
  const grouped = groupSubmissions(annual)
  const groupedStatutory = groupSubmissions(statutory)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {departmentScoped ? 'Our AIP' : 'Submissions'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CY {period.year}
            {departmentScoped ? ` · ${session.department!.display_name}` : ' · all departments'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {periods.length > 1 ? (
            <PeriodPicker periods={periods} currentId={period.id} />
          ) : null}
          {/* Only the year being worked on takes a new submission. An older
              period may still be `open` — nothing closes it automatically — and
              starting this year's AIP against last year's programme is a
              mistake nobody notices until the export. */}
          {departmentScoped && isCurrentPeriod ? (
            <StartAipButton
              periodId={period.id}
              departmentId={session.department!.id}
              hasAnnual={hasAnnual}
              startableFunds={startableFunds}
            />
          ) : null}
        </div>
      </div>

      <SubmissionsTable
        groups={grouped}
        emptyMessage={`No submissions for CY ${period.year} yet.`}
      />

      {/* The statutory funds are a second table and never the same one. Each is
          its own document with its own review and its own printout, and none of
          them is part of the annual programme's grand total. */}
      {groupedStatutory.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-medium">Statutory funds</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Filed beside the annual programme, not inside it. These figures are not part
              of the AIP&apos;s grand total.
            </p>
          </div>
          <SubmissionsTable
            groups={groupedStatutory}
            emptyMessage="No statutory documents for this year yet."
          />
        </div>
      ) : null}
    </div>
  )
}

export const dynamic = 'force-dynamic'
