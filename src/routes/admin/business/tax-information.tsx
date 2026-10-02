import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { Download } from 'lucide-react'
import { getTaxSales } from '@/lib/payments'
import { buildTaxReport, taxReportCsv } from '@/lib/tax-report'
import { TAX_CONFIG_REVIEWED, TAX_JURISDICTIONS, isTaxJurisdiction } from '@/lib/tax'
import { todayInBusinessTz } from '@/lib/pricing'

// Tax collected and refunded, month by month — the figures a Minnesota sales tax
// return is filed from (ImportantFiles/tax.md). Checkout tax comes from
// each booking's frozen quote and later charges from the ledger, so these are
// the amounts actually charged, not a recalculation.

export const Route = createFileRoute('/admin/business/tax-information')({
    validateSearch: z.object({ year: z.number().int().optional() }),
    loaderDeps: ({ search }) => ({ year: search.year }),
    loader: ({ deps }) => {
        const year = deps.year ?? Number(todayInBusinessTz().slice(0, 4))
        return getTaxSales({ data: year }).then(sales => ({ year, sales }))
    },
    component: TaxInformationPage,
})

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function monthName(month: string): string {
    const [y, m] = month.split('-').map(Number)
    return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function TaxInformationPage() {
    const { year, sales } = Route.useLoaderData()
    const navigate = useNavigate()

    const rows = useMemo(() => buildTaxReport(sales), [sales])
    const months = [...new Set(rows.map(r => r.month))]
    const totalNet = rows.reduce((sum, r) => sum + r.net, 0)

    const download = () => {
        const blob = new Blob([taxReportCsv(rows)], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `bluefin-tax-${year}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="py-8 md:py-16 px-4 md:px-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <h1 className="text-3xl text-black font-bold">Tax information</h1>
                    <div className="flex items-center gap-3">
                        <select
                            value={year}
                            onChange={(e) => void navigate({ to: '.', search: { year: Number(e.target.value) } })}
                            className="border border-line rounded-lg px-3 py-2 text-sm"
                        >
                            {[year + 1, year, year - 1, year - 2].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <button
                            type="button"
                            onClick={download}
                            disabled={rows.length === 0}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line text-sm font-semibold hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                        >
                            <Download size={16} /> CSV
                        </button>
                    </div>
                </div>

                {!TAX_CONFIG_REVIEWED && (
                    <div className="rounded-xl border border-amber-700 bg-amber-100 p-4 text-sm text-ink">
                        <p className="font-bold">Not yet reviewed by an accountant</p>
                        <p className="mt-1">
                            Some rates and which charges are taxable are placeholders. Check these figures against
                            ImportantFiles/tax-todo.md before filing.
                        </p>
                    </div>
                )}

                <p className="text-sm text-gray-600">
                    {money(totalNet)} of tax collected, net of refunds, in {year}. Sales are counted in the month
                    they were paid; refunds reduce the month of the sale they refund.
                </p>

                {months.length === 0 ? (
                    <p className="text-gray-500">No taxed sales in {year}.</p>
                ) : months.map(month => {
                    const monthRows = rows.filter(r => r.month === month)
                    return (
                        <section key={month} className="border border-gray-200 rounded-xl overflow-hidden">
                            <h2 className="px-4 py-3 bg-gray-50 font-bold text-gray-900">{monthName(month)}</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-gray-500">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Where</th>
                                            <th className="px-4 py-2 font-medium">Tax</th>
                                            <th className="px-4 py-2 font-medium text-right">Taxable</th>
                                            <th className="px-4 py-2 font-medium text-right">Collected</th>
                                            <th className="px-4 py-2 font-medium text-right">Refunded</th>
                                            <th className="px-4 py-2 font-medium text-right">Net</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {monthRows.map(r => (
                                            <tr key={`${r.taxId}|${r.jurisdiction}`}>
                                                <td className="px-4 py-2 text-gray-700">
                                                    {isTaxJurisdiction(r.jurisdiction) ? TAX_JURISDICTIONS[r.jurisdiction].name : r.jurisdiction}
                                                </td>
                                                <td className="px-4 py-2 text-gray-900">{r.label}</td>
                                                <td className="px-4 py-2 text-right tabular-nums">{money(r.taxable)}</td>
                                                <td className="px-4 py-2 text-right tabular-nums">{money(r.collected)}</td>
                                                <td className="px-4 py-2 text-right tabular-nums">{money(r.refunded)}</td>
                                                <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(r.net)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )
                })}
            </div>
        </div>
    )
}
