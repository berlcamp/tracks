// Generates a real .xlsx from the local database, end to end:
//   views -> mappers -> assembler -> workbook
//
//   npm run export:demo [outfile]
//
// Reads the throwaway `tracks_demo` database built by supabase/tests/run-local.sh
// plus supabase/seed.sql. It exists to prove the whole path works against real
// SQL, not just fixtures — and to give the office something to open.

import { Client } from 'pg'
import { writeFile } from 'node:fs/promises'
import { assembleExportData } from '../lib/aip/assemble'
import { buildAipWorkbook } from '../lib/aip/workbook'
import { toAmountSet, toDepartmentTotal, toPpaRowSource, toSectorTotal } from '../lib/aip/query'

const DB = process.env.TRACKS_DB ?? 'tracks_demo'
const OUT = process.argv[2] ?? 'CY2027-AIP-Consolidated.xlsx'

async function main() {
  const client = new Client({ database: DB })
  await client.connect()

  const { rows: periods } = await client.query(
    `select id, year, draft_label, nta_amount from tracks.aip_periods order by year desc limit 1`,
  )
  const period = periods[0]
  if (!period) throw new Error(`no AIP period in ${DB}`)

  const { rows: lgu } = await client.query(`select lgu_name, lgu_type from tracks.lgu_settings`)

  const { rows: sectors } = await client.query(
    `select id, summary_label from tracks.sectors`,
  )
  const summaryLabels = new Map<string, string>(sectors.map((s) => [s.id, s.summary_label]))

  const { rows: departments } = await client.query(
    `select id, code_number from tracks.departments`,
  )
  const codeNumbers = new Map<string, number | null>(departments.map((d) => [d.id, d.code_number]))

  const { rows: ppaRows } = await client.query(
    `select * from tracks.v_ppa_rows
      where period_id = $1 and aip_kind = 'annual'
      order by sector_sort, department_sort, group_sort_path, item_no`,
    [period.id],
  )

  const { rows: deptTotals } = await client.query(
    `select * from tracks.v_aip_totals where period_id = $1 and kind = 'annual'`, [period.id],
  )
  const { rows: sectorTotals } = await client.query(
    `select * from tracks.v_sector_totals where period_id = $1 and kind = 'annual'`, [period.id],
  )
  const { rows: periodTotals } = await client.query(
    `select * from tracks.v_period_totals where period_id = $1 and kind = 'annual'`, [period.id],
  )

  await client.end()

  const data = assembleExportData({
    year: period.year,
    lguName: lgu[0]?.lgu_name ?? 'Bayugan',
    lguType: lgu[0]?.lgu_type ?? 'City',
    draftLabel: period.draft_label,
    ntaAmount: period.nta_amount === null ? null : Number(period.nta_amount),
    scope: 'consolidated',
    rows: ppaRows.map((r) =>
      toPpaRowSource(r, {
        summaryLabel: summaryLabels.get(r.sector_id) ?? r.sector_heading,
        codeNumber: codeNumbers.get(r.department_id) ?? null,
      }),
    ),
    departmentTotals: deptTotals.map(toDepartmentTotal),
    sectorTotals: sectorTotals.map(toSectorTotal),
    grandTotals: periodTotals[0]
      ? toAmountSet(periodTotals[0])
      : { ps: 0, mooe: 0, fe: 0, co: 0, total: 0 },
  })

  const buffer = await buildAipWorkbook(data).xlsx.writeBuffer()
  await writeFile(OUT, Buffer.from(buffer))

  const rowCount = data.sectors.reduce(
    (n, s) => n + s.departments.reduce((m, d) => m + d.rows.length, 0), 0)
  console.log(
    `${OUT}\n  ${data.sectors.length} sector sheet(s), ${rowCount} PPA row(s), ` +
    `grand total ${data.grandTotals.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
