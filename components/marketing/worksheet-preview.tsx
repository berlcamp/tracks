/**
 * A static rendering of the AIP grid, shown on the landing page.
 *
 * It is deliberately the real thing in miniature — sector band, department band,
 * the column-C group row, the (8)-(12) money columns, a subtotal — because the
 * single question every planning officer asks first is "does it look like our
 * Excel file?"
 */
const COLUMNS = [
  'AIP Ref. Code', 'Program / Project / Activity', 'Implementing Office',
  'Start', 'Completion', 'Funding', 'PS', 'MOOE', 'CO', 'Total',
]

const ROWS: Array<{ code: string; description: string; office: string; funding: string
  ps?: string; mooe?: string; co?: string; total: string }> = [
  { code: '1000-000-2-1-01-001-001-001',
    description: 'Administrative Cost for Salaries, Wages, and Benefits',
    office: "City Mayor's Office", funding: 'GF', ps: '86,222,053.00', total: '86,222,053.00' },
  { code: '1000-000-2-1-01-001-001-002',
    description: 'Administrative Cost for Travelling (Local)',
    office: "City Mayor's Office", funding: 'GF', mooe: '7,000,000.00', total: '7,000,000.00' },
  { code: '1000-000-2-1-01-001-001-030',
    description: 'Acquisition of Office Equipment',
    office: "City Mayor's Office", funding: 'GF', co: '20,000,000.00', total: '20,000,000.00' },
]

export function WorksheetPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          CY 2027 Annual Investment Program — Public Services Sector
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40">
              {COLUMNS.map((column) => (
                <th key={column}
                    className="border border-border/70 px-2.5 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={COLUMNS.length}
                  className="border border-border/70 bg-[#76923c] px-2.5 py-1.5 font-semibold text-white">
                GENERAL PUBLIC SECTOR
              </td>
            </tr>
            <tr>
              <td colSpan={COLUMNS.length}
                  className="border border-border/70 px-2.5 py-1.5 font-semibold">
                City Mayor&apos;s Office (CMO)
              </td>
            </tr>
            <tr>
              <td colSpan={COLUMNS.length}
                  className="border border-border/70 px-2.5 py-1.5 pl-6 font-medium text-muted-foreground">
                General and Administrative Operation
              </td>
            </tr>
            {ROWS.map((row) => (
              <tr key={row.code} className="hover:bg-muted/30">
                <td className="border border-border/70 px-2.5 py-1.5 font-mono text-[0.7rem] whitespace-nowrap">{row.code}</td>
                <td className="border border-border/70 px-2.5 py-1.5">{row.description}</td>
                <td className="border border-border/70 px-2.5 py-1.5 whitespace-nowrap">{row.office}</td>
                <td className="border border-border/70 px-2.5 py-1.5 whitespace-nowrap">January 2027</td>
                <td className="border border-border/70 px-2.5 py-1.5 whitespace-nowrap">December 2027</td>
                <td className="border border-border/70 px-2.5 py-1.5 text-center">{row.funding}</td>
                <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">{row.ps ?? ''}</td>
                <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">{row.mooe ?? ''}</td>
                <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">{row.co ?? ''}</td>
                <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">{row.total}</td>
              </tr>
            ))}
            <tr className="bg-[#d6e3bc] font-semibold text-neutral-900">
              <td colSpan={6} className="border border-border/70 px-2.5 py-1.5 text-right">
                City Mayor&apos;s Office (CMO) TOTAL
              </td>
              <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">86,222,053.00</td>
              <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">7,000,000.00</td>
              <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">20,000,000.00</td>
              <td className="border border-border/70 px-2.5 py-1.5 text-right font-mono tabular-nums">113,222,053.00</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
