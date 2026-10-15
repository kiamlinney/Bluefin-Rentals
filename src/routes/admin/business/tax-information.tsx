import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { ChevronRight, Download } from 'lucide-react'
import { getTaxSales } from '@/lib/payments'
import { buildTaxMonths, buildTaxReport, taxReportCsv, type TaxMonth, type TaxPlace } from '@/lib/tax-report'
import { isTopicOpen, parseTaxQuestions, type TaxQuestionTopic } from '@/lib/tax-questions'
import { TAX_CONFIG_REVIEWED, TAX_JURISDICTIONS, formatTaxRate, isTaxJurisdiction } from '@/lib/tax'
import { todayInBusinessTz } from '@/lib/pricing'
import { formatBusinessDate } from '@/lib/dates'
import { roundMoney } from '@/lib/money'
import taxTodo from '../../../../ImportantFiles/tax-todo.md?raw'

// Tax collected and refunded, month by month — the figures a Minnesota sales tax
// return is filed from (ImportantFiles/tax.md). Checkout tax comes from
// each booking's frozen quote and later charges from the ledger, so these are
// the amounts actually charged, not a recalculation.
//
// Each month leads with what's owed and shows the taxes the way a receipt does
// (sales tax, rental tax); the per-rate rows the return needs, which are also
// the CSV, are folded under "Breakdown for the tax form". The accountant's open
// questions are read from ImportantFiles/tax-todo.md, so this page and that
// document can't disagree.

export const Route = createFileRoute('/admin/business/tax-information')({
    validateSearch: z.object({ year: z.number().int().optional() }),
    loaderDeps: ({ search }) => ({ year: search.year }),
    loader: ({ deps }) => {
        const year = deps.year ?? Number(todayInBusinessTz().slice(0, 4))
        return getTaxSales({ data: year }).then(sales => ({ year, sales }))
    },
    component: TaxInformationPage,
})

const QUESTIONS = parseTaxQuestions(taxTodo)

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const placeName = (jurisdiction: string) =>
    isTaxJurisdiction(jurisdiction) ? TAX_JURISDICTIONS[jurisdiction].name : jurisdiction

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function monthName(month: string): string {
    const [y, m] = month.split('-').map(Number)
    return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function TaxInformationPage() {
    const { year, sales } = Route.useLoaderData()
    const navigate = useNavigate()

    const rows = useMemo(() => buildTaxReport(sales), [sales])
    const months = useMemo(() => buildTaxMonths(sales), [sales])
    const collected = roundMoney(months.reduce((sum, m) => sum + m.collected, 0))
    const refunded = roundMoney(months.reduce((sum, m) => sum + m.refunded, 0))
    const owed = roundMoney(months.reduce((sum, m) => sum + m.owed, 0))

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
                            title="The per-rate rows, for the tax return or the accountant"
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
                            Some rates and which charges are taxable are placeholders. The open questions for the
                            accountant are listed below. Check these figures against them before filing.
                        </p>
                    </div>
                )}

                <AccountantQuestions topics={QUESTIONS} />

                <section className="rounded-xl border border-gray-200 p-5 space-y-3">
                    <p className="text-sm text-gray-600">{year}</p>
                    <p className="text-2xl font-bold text-gray-900">
                        You owe {money(owed)} in tax
                    </p>
                    <p className="text-sm text-gray-600">
                        Tax charged to customers {money(collected)}, minus {money(refunded)} given back in refunds.
                    </p>
                    <details className="text-sm text-gray-700">
                        <summary className="cursor-pointer font-semibold text-gray-900">How to read this page</summary>
                        <ul className="mt-2 ml-5 list-disc space-y-1">
                            <li>
                                Tax you charge a customer isn't yours: it's held for the state and paid when you file.
                                <strong> You owe</strong> is the tax charged minus the tax given back in refunds.
                            </li>
                            <li>
                                Each place a car is picked up has its own local taxes, so each month is split by
                                pickup place.
                            </li>
                            <li>
                                <strong>Sales tax</strong> is several taxes added together (state, metro, city,
                                county). The tax return asks for each one, so the breakdown and the CSV list them
                                separately.
                            </li>
                            <li>
                                A booking counts in the month it was made, and a later charge in the month it was
                                paid. A refund lowers the month of the original booking, not the month it was given.
                            </li>
                            <li>
                                Turo trips aren't here: Turo collected and paid that tax.
                            </li>
                        </ul>
                    </details>
                </section>

                {months.length === 0 ? (
                    <p className="text-gray-500">No taxed sales in {year}.</p>
                ) : months.map(month => <MonthSection key={month.month} month={month} />)}
            </div>
        </div>
    )
}

function AccountantQuestions({ topics }: { topics: TaxQuestionTopic[] }) {
    const open = topics.filter(isTopicOpen)
    const openQuestions = topics.reduce((sum, t) => sum + t.questions.filter(q => !q.answered).length, 0)

    return (
        <details className="group rounded-xl border border-gray-200">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-bold text-gray-900">
                <ChevronRight size={18} className="transition-transform group-open:rotate-90" />
                Open questions for your accountant
                <span className="font-normal text-gray-600">
                    · {open.length} of {topics.length} topics open, {plural(openQuestions, 'question', 'questions')}
                </span>
            </summary>
            <div className="space-y-5 border-t border-gray-200 px-4 py-4 text-sm">
                <p className="text-gray-600">
                    The full document, with what we do now and why we aren't sure, is
                    <code className="mx-1 rounded bg-gray-100 px-1">ImportantFiles/tax-todo.md</code>
                    in the code. This list is read from it. Bring that file and a CSV to the meeting.
                </p>
                {topics.map(topic => (
                    <div key={topic.number}>
                        <p className="font-semibold text-gray-900">
                            {topic.number}. {topic.topic}
                            {!isTopicOpen(topic) && <span className="ml-2 text-green-700">Answered</span>}
                        </p>
                        <p className="text-gray-600">
                            Now: {topic.currentPosition}
                            {topic.neededBeforeLaunch && <> · Needed before launch: {topic.neededBeforeLaunch}</>}
                        </p>
                        <ul className="mt-1 ml-5 list-disc space-y-1 text-gray-800">
                            {topic.questions.map((q, i) => (
                                <li key={i} className={q.answered ? 'text-gray-400 line-through' : undefined}>{q.text}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </details>
    )
}

function MonthSection({ month }: { month: TaxMonth }) {
    return (
        <section className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-gray-50">
                <div>
                    <h2 className="font-bold text-gray-900">{monthName(month.month)}</h2>
                    <p className="text-sm text-gray-600">
                        {plural(month.bookingCount, 'booking', 'bookings')}
                        {month.chargeCount > 0 && <> · {plural(month.chargeCount, 'later charge', 'later charges')}</>}
                    </p>
                </div>
                <p className="font-bold text-gray-900">You owe {money(month.owed)}</p>
            </div>

            <div className="divide-y divide-gray-100">
                {month.places.map(place => <PlaceSummary key={place.jurisdiction} place={place} />)}
            </div>

            <details className="border-t border-gray-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900">
                    Bookings and charges this month
                </summary>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-gray-500">
                            <tr>
                                <th className="px-4 py-2 font-medium">Paid</th>
                                <th className="px-4 py-2 font-medium">What</th>
                                <th className="px-4 py-2 font-medium">Pickup</th>
                                <th className="px-4 py-2 font-medium text-right">Customer paid</th>
                                <th className="px-4 py-2 font-medium text-right">Refunded</th>
                                <th className="px-4 py-2 font-medium text-right">Tax owed</th>
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {month.sales.map(sale => (
                                <tr key={`${sale.source}-${sale.reference}`}>
                                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatBusinessDate(sale.date)}</td>
                                    <td className="px-4 py-2 text-gray-900">{sale.source === 'checkout' ? 'Booking' : 'Later charge'}</td>
                                    <td className="px-4 py-2 text-gray-700">{placeName(sale.jurisdiction)}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{money(sale.total)}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{money(sale.refunded)}</td>
                                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(sale.taxOwed)}</td>
                                    <td className="px-4 py-2 text-right">
                                        <Link
                                            to="/admin/reservation/$bookingId"
                                            params={{ bookingId: sale.bookingId }}
                                            className="text-sm font-semibold underline whitespace-nowrap"
                                        >
                                            View trip
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </section>
    )
}

function PlaceSummary({ place }: { place: TaxPlace }) {
    return (
        <div className="px-4 py-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-gray-900">{placeName(place.jurisdiction)}</h3>
                <p className="text-sm text-gray-600">{money(place.rentalPriceTaxed)} of rentals taxed (before refunds)</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-left text-gray-500">
                        <tr>
                            <th className="py-1 pr-4 font-medium">Tax</th>
                            <th className="py-1 px-4 font-medium text-right">Tax charged</th>
                            <th className="py-1 px-4 font-medium text-right">Given back</th>
                            <th className="py-1 pl-4 font-medium text-right">You owe</th>
                        </tr>
                    </thead>
                    <tbody>
                        {place.lines.map(line => (
                            <tr key={line.id}>
                                <td className="py-1 pr-4 text-gray-900">{line.label} ({formatTaxRate(line.rate)})</td>
                                <td className="py-1 px-4 text-right tabular-nums">{money(line.collected)}</td>
                                <td className="py-1 px-4 text-right tabular-nums">{money(line.refunded)}</td>
                                <td className="py-1 pl-4 text-right tabular-nums font-semibold">{money(line.owed)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <details>
                <summary className="cursor-pointer text-sm text-gray-600">
                    Breakdown for the tax form ({plural(place.rows.length, 'tax', 'taxes')})
                </summary>
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-gray-500">
                            <tr>
                                <th className="py-1 pr-4 font-medium">Tax</th>
                                <th className="py-1 px-4 font-medium text-right">Rate</th>
                                <th className="py-1 px-4 font-medium text-right">Rental price taxed</th>
                                <th className="py-1 px-4 font-medium text-right">Tax charged</th>
                                <th className="py-1 px-4 font-medium text-right">Given back</th>
                                <th className="py-1 pl-4 font-medium text-right">You owe</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {place.rows.map(r => (
                                <tr key={r.taxId}>
                                    <td className="py-1 pr-4 text-gray-900">{r.label}</td>
                                    <td className="py-1 px-4 text-right tabular-nums">{formatTaxRate(r.rate)}</td>
                                    <td className="py-1 px-4 text-right tabular-nums">{money(r.taxable)}</td>
                                    <td className="py-1 px-4 text-right tabular-nums">{money(r.collected)}</td>
                                    <td className="py-1 px-4 text-right tabular-nums">{money(r.refunded)}</td>
                                    <td className="py-1 pl-4 text-right tabular-nums font-semibold">{money(r.net)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-xs text-gray-500">
                        Each tax is charged on the same rental price (the rental tax leaves out trips booked
                        for more than 28 days), so don't add up that column.
                    </p>
                </div>
            </details>
        </div>
    )
}
