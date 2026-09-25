import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { getTripExtras, requestTripExtras } from '@/lib/db'
import { getTripForGuest } from '@/lib/db'
import { buildReceipt } from '@/lib/receipt'
import { checkoutOnlyExtraIds, resolveExtras } from '@/lib/extras'
import { carMainImageUrl } from '@/lib/car-images'
import { formatBusinessDate, formatBusinessTime } from '@/lib/dates'
import { ExtrasSection } from '@/components/checkout/ExtrasSection'
import { TripLocation } from '@/components/trip/TripLocation'

// Adding extras to a trip that has already been paid for.
//
// Trailing underscore so it renders standalone rather than nested inside the
// trip page, matching …_.photos.tsx and …_.receipt.tsx.
//
// Extras chosen here are a REQUEST. They're recorded as 'requested' rows the
// owners approve or decline on the reservation page, and only then are they on
// the trip. Nothing is charged either way: there is no saved payment method
// after checkout (see CLAUDE.md), so an approved extra is settled in person.
//
// price_quote is never touched by any of this, which is what keeps the refund
// math describing exactly what Stripe took. Writing these into price_quote is
// the easy-looking option and would make a later cancellation refund money that
// was never taken.
export const Route = createFileRoute('/_authed/trips/$bookingId_/extras')({
    loader: async ({ params }) => {
        const [trip, extras] = await Promise.all([
            getTripForGuest({ data: params.bookingId }),
            getTripExtras({ data: params.bookingId }),
        ])
        return { ...trip, extras }
    },
    component: TripExtrasPage,
})

const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric' } as const

const textareaClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-ink text-sm ' +
    'placeholder:text-ink-400 focus:outline-none focus:border-brand hover:border-ink-400 transition-colors resize-none'

function TripExtrasPage() {
    const { booking, extras } = Route.useLoaderData()
    const navigate = useNavigate()

    const car = booking.cars
    const receipt = buildReceipt(booking, car)
    const billableDays = receipt.billableDays

    // What the trip already has, from booking_extras — checkout and
    // post-booking alike. Read from the table rather than the quote because the
    // quote only knows about what was bought at checkout, and an extra added
    // last week must not be offered again either.
    const ownedIds = extras.map(extra => extra.extra_id)

    // Plus anything that can only be bought at checkout. Unlimited mileage is
    // the case: it rewrites how the trip is billed rather than being an item
    // handed over at pickup, so buying it late is a way to erase a mileage bill
    // you can already see coming. The server refuses these too — this only
    // keeps them off the form.
    const unavailableIds = [...ownedIds, ...checkoutOnlyExtraIds()]

    const [selected, setSelected] = useState<string[]>([])
    const [message, setMessage] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)

    
    useEffect(() => {
        if (sent) window.scrollTo({ top: 0, behavior: 'auto' })
    }, [sent])

    // Priced with the same function the server uses, and labelled as an
    // estimate because the owners confirm availability before anything is owed.
    const { total: estimated } = resolveExtras(selected, billableDays)

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            await requestTripExtras({
                data: { bookingId: booking.id, extraIds: selected, message },
            })
            setSent(true)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not send that request.')
        } finally {
            setWorking(false)
        }
    }

    if (sent) {
        return (
            <div className="min-h-screen py-24 px-4 md:px-8">
                <div className="max-w-md mx-auto text-center">
                    <div className="w-16 h-16 bg-pine-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check className="w-8 h-8 text-pine-700" strokeWidth={3} />
                    </div>
                    <h1 className="text-2xl font-bold text-ink">Request sent</h1>
                    <p className="text-muted mt-2">
                        We'll confirm these shortly. Nothing has been charged — anything we
                        approve is settled when you pick the car up.
                    </p>
                    <Link
                        to="/trips/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="inline-block mt-6 px-5 py-2.5 bg-brand hover:bg-pine-800 text-on-brand font-bold rounded-xl text-sm transition-colors"
                    >
                        Back to your trip
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen py-24 px-4 md:px-8">
            <div className="max-w-5xl mx-auto">
                <Link
                    to="/trips/$bookingId"
                    params={{ bookingId: booking.id }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink transition-colors"
                >
                    <ArrowLeft size={16} />
                    Back to your trip
                </Link>

                <h1 className="text-3xl font-bold text-ink mt-4 pb-6 border-b border-line">Extras</h1>

                <div className="grid gap-10 lg:grid-cols-[1fr_340px] lg:items-start pt-8">
                    <div className="min-w-0">
                        {/* What's already on the trip, so the form below is
                            plainly a list of what's left rather than the same
                            four options again. */}
                        {extras.length > 0 && (
                            <div className="mb-8 border border-line rounded-2xl p-5">
                                <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-2">
                                    Already on this trip
                                </h2>
                                <ul className="space-y-1">
                                    {extras.map((extra) => (
                                        <li key={extra.id} className="flex items-center justify-between gap-3 text-ink">
                                            <span className="flex items-center gap-2">
                                                <Check size={16} className="text-pine-700 shrink-0" />
                                                {extra.name}
                                            </span>
                                            {/* Says which ones are still owed, so
                                                the guest isn't surprised at pickup. */}
                                            <span className="text-sm text-muted shrink-0">
                                                {extra.status === 'requested'
                                                    ? 'awaiting confirmation'
                                                    : extra.charged ? 'paid' : 'pay at pickup'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <ExtrasSection
                            value={selected}
                            onChange={setSelected}
                            billableDays={billableDays}
                            disabled={working}
                            heading="Add extras"
                            // subheading="These are offered by Bluefin. Prices are estimates until we confirm availability."
                            exclude={unavailableIds}
                            emptyMessage="You already have every extra we offer on this trip. Get in touch if you need something else."
                        />

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-ink mb-1.5">
                                Message <span className="font-normal text-muted">(optional)</span>
                            </label>
                            <textarea
                                className={textareaClass}
                                rows={4}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Anything we should know — timing, car seat size, that sort of thing."
                                disabled={working}
                            />
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-800">
                                {error}
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={submit}
                                disabled={working || selected.length === 0}
                                className="px-5 py-2.5 rounded-xl bg-brand text-on-brand text-sm font-bold hover:bg-pine-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {working ? 'Sending…' : 'Send request'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void navigate({ to: '/trips/$bookingId', params: { bookingId: booking.id } })}
                                disabled={working}
                                className="px-5 py-2.5 rounded-xl border border-line text-ink text-sm font-bold hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>

                    {/* ── The trip this is for ────────────────────────────── */}
                    <div className="bg-surface border border-line rounded-2xl p-5 space-y-4 lg:sticky lg:top-6">
                        <img
                            src={carMainImageUrl(car.id)}
                            alt={`${car.make} ${car.model} ${car.year}`}
                            className="w-full aspect-[5/3] object-cover rounded-xl border border-line"
                            decoding="async"
                        />

                        <div>
                            <p className="font-bold text-ink">
                                {car.make} {car.model} {car.year}
                            </p>
                            <p className="text-sm text-muted">
                                {formatBusinessDate(booking.start_time, DATE_FORMAT)}{' '}
                                {formatBusinessTime(booking.start_time)} —{' '}
                                {formatBusinessDate(booking.end_time, DATE_FORMAT)}{' '}
                                {formatBusinessTime(booking.end_time)}
                            </p>
                        </div>

                        <TripLocation pickupLocation={booking.pickup_location} />

                        <hr className="border-line" />

                        <div className="flex justify-between text-sm">
                            <span className="text-muted">Previously paid</span>
                            <span className="text-ink tabular-nums">−${booking.total_price}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted">If approved</span>
                            <span className="text-ink tabular-nums">${estimated.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-base font-bold">
                            <span className="text-ink">Charged to your card</span>
                            <span className="text-ink tabular-nums">$0.00</span>
                        </div>

                        <p className="text-xs text-muted">
                            This is a request — we'll confirm what's available. Nothing is
                            charged to your card here; anything approved is settled when you
                            pick the car up.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
