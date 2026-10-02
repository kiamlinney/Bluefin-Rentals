import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { finishChargePayment, getChargePayLink } from '@/lib/payments'
import { stripeAppearance, stripePromise } from '@/lib/stripe-client'
import { chargeKindLabel, chargeTotal } from '@/lib/charges'
import { formatBusinessDateTime } from '@/lib/dates'
import { displayTaxLines } from '@/lib/tax'
import { DialogError, Money, primaryButtonClass } from '@/components/trip/ModalShell'

// The pay link: /trips/{bookingId}/pay/{chargeId}.
//
// Where a guest lands from the "a payment for your trip needs you" email, when
// the card saved on their trip couldn't pay a charge — declined, or the bank
// wanted them to authenticate. They can pay with the same card or another; the
// card they pay with here is saved to the trip, and the page says so.
//
// The trailing underscore on $bookingId_ keeps this out of the trip page's
// layout, like /receipt. getChargePayLink authorizes the caller against the
// booking and checks the charge belongs to it.
export const Route = createFileRoute('/_authed/trips/$bookingId_/pay/$chargeId')({
    loader: ({ params }) => getChargePayLink({ data: { bookingId: params.bookingId, chargeId: params.chargeId } }),
    component: PayChargePage,
})

function PayChargePage() {
    const { charge, clientSecret, paid } = Route.useLoaderData()
    const { bookingId } = Route.useParams()
    const [done, setDone] = useState(paid)

    return (
        <div className="min-h-screen px-4 py-24 md:px-8">
            <div className="mx-auto max-w-lg space-y-6">
                <Link
                    to="/trips/$bookingId"
                    params={{ bookingId }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-500 hover:underline"
                >
                    <ArrowLeft size={16} />
                    Back to trip
                </Link>

                <div className="bg-surface border border-line rounded-2xl p-6 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted">{chargeKindLabel(charge)}</p>
                    <h1 className="text-2xl font-bold text-ink">{charge.description}</h1>
                    <div className="space-y-1.5 text-sm pt-2">
                        {charge.line_items.map((item, i) => (
                            <div key={i} className="flex justify-between gap-4">
                                <span className="text-muted">{item.label}{item.detail ? ` (${item.detail})` : ''}</span>
                                <Money amount={item.amount} className="text-ink" />
                            </div>
                        ))}
                        {displayTaxLines(charge.tax_lines).map(tax => (
                            <div key={tax.id} className="flex justify-between gap-4">
                                <span className="text-muted">{tax.label}</span>
                                <Money amount={tax.amount} className="text-ink" />
                            </div>
                        ))}
                        <div className="border-t border-line pt-2 flex justify-between font-bold text-ink text-base">
                            <span>Total</span>
                            <Money amount={chargeTotal(charge)} />
                        </div>
                    </div>
                    <p className="text-xs text-muted">Added {formatBusinessDateTime(charge.created_at)}</p>
                </div>

                {done ? (
                    <div className="bg-surface border border-line rounded-2xl p-6">
                        <p className="font-bold text-ink">Paid. Thank you.</p>
                        <p className="text-sm text-muted mt-1">A receipt is on its way to your email and on your trip page.</p>
                    </div>
                ) : clientSecret ? (
                    <>
                        {charge.failure_message && (
                            <p className="text-sm text-muted">
                                We couldn't charge your saved card: "{charge.failure_message}"
                            </p>
                        )}
                        <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
                            <PayForm bookingId={bookingId} chargeId={charge.id} total={chargeTotal(charge)} onPaid={() => setDone(true)} />
                        </Elements>
                    </>
                ) : null}
            </div>
        </div>
    )
}

function PayForm({
    bookingId,
    chargeId,
    total,
    onPaid,
}: {
    bookingId: string
    chargeId: string
    total: number
    onPaid: () => void
}) {
    const stripe = useStripe()
    const elements = useElements()
    const router = useRouter()
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const pay = async () => {
        if (!stripe || !elements) return
        setWorking(true)
        setError(null)
        const { error: submitError } = await elements.submit()
        if (submitError) {
            setError(submitError.message ?? 'Check your card details.')
            setWorking(false)
            return
        }
        const { error: payError } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
            confirmParams: { return_url: `${window.location.origin}/trips/${bookingId}/pay/${chargeId}` },
        })
        if (payError) {
            setError(payError.message ?? 'The payment did not go through.')
            setWorking(false)
            return
        }
        const { charge } = await finishChargePayment({ data: { bookingId, chargeId } })
        if (charge.status === 'succeeded' || charge.status === 'authorized') {
            onPaid()
            void router.invalidate()
        } else {
            setError('The payment is still processing. This page will update when it clears.')
        }
        setWorking(false)
    }

    return (
        <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
            <PaymentElement options={{ wallets: { applePay: 'auto', googlePay: 'auto' } }} />
            <p className="text-xs text-muted">
                The card you pay with is saved to this trip and used as your{' '}
                <Link to="/policies/terms" target="_blank" className="underline">terms of service</Link> describe.
            </p>
            <DialogError message={error} />
            <button type="button" onClick={pay} disabled={!stripe || working} className={`w-full ${primaryButtonClass}`}>
                {working ? 'Processing…' : `Pay $${total.toFixed(2)}`}
            </button>
        </div>
    )
}