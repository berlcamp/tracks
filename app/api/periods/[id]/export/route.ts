import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/session'
import { buildConsolidatedExportData } from '@/lib/aip/export-data'
import { buildAipWorkbook } from '@/lib/aip/workbook'

/** The consolidated workbook: SUMMARY plus one worksheet per sector. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(['planning_staff', 'planning_admin', 'budget', 'accounting', 'viewer'])
  const { id } = await params

  const kind = request.nextUrl.searchParams.get('kind') === 'supplemental'
    ? 'supplemental' as const
    : 'annual' as const

  const built = await buildConsolidatedExportData(id, kind)
  if (!built || built.data.sectors.length === 0) {
    return NextResponse.json({ error: 'Nothing to export yet.' }, { status: 404 })
  }

  const buffer = await buildAipWorkbook(built.data).xlsx.writeBuffer()
  const suffix = kind === 'supplemental' ? '-Supplemental' : ''

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        `attachment; filename="CY${built.period.year}-AIP-Consolidated${suffix}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
