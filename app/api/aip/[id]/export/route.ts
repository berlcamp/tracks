import { NextResponse, type NextRequest } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { buildDepartmentExportData } from '@/lib/aip/export-data'
import { buildAipWorkbook } from '@/lib/aip/workbook'

/**
 * A department's own AIP as the official workbook.
 *
 * Authorization is the RLS-bound read underneath: an AIP the caller may not see
 * comes back empty, and this returns 404 rather than an empty workbook, which
 * would look like a missing submission rather than a refused one.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSession()
  const { id } = await params

  const built = await buildDepartmentExportData(id)
  if (!built || built.data.sectors.length === 0) {
    return NextResponse.json({ error: 'Not found, or nothing to export yet.' }, { status: 404 })
  }

  const buffer = await buildAipWorkbook(built.data).xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${built.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
