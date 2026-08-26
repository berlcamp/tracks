import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth/session'
import { getAipDetail } from '@/lib/data/aip'
import { AipWorkspace } from '@/components/aip/aip-workspace'
import type { EditContext } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function AipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession()
  const detail = await getAipDetail(id)

  // RLS already returns nothing for an AIP the caller may not read, so a missing
  // detail is genuinely "not found" from this user's point of view.
  if (!detail) notFound()

  const ctx: EditContext = {
    role: session.role,
    isSuperAdmin: session.isSuperAdmin,
    profileId: session.profile.id,
    departmentId: session.department?.id ?? null,
    aipStatus: detail.aip.status,
    aipDepartmentId: detail.aip.department_id,
    periodStatus: detail.period.status,
  }

  return (
    <AipWorkspace
      aip={detail.aip}
      period={detail.period}
      department={detail.department}
      rows={detail.rows}
      siblings={detail.siblings}
      ctx={ctx}
    />
  )
}
