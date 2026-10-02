import { Elements } from '@stripe/react-stripe-js'
import type { Appearance, Stripe } from '@stripe/stripe-js'
import { PaymentStep } from './PaymentStep'

// Card only (credit/debit, Apple Pay, Google Pay). There used to be a "Choose
// when to pay" chooser here with Cash App, Amazon Pay, Affirm and Klarna behind
// it; it went when checkout started saving the card for the deposit hold and
// later charges, which those methods can't support. See PAYMENT_METHOD_TYPES in
// src/lib/db.ts.

export function PaymentSection({
    stripePromise,
    appearance,
    isLoading,
    paymentError,
    clientSecret,
    bookingId,
    total,
}: {
    stripePromise: Promise<Stripe | null>
    appearance: Appearance
    isLoading: boolean
    paymentError: string | null
    clientSecret: string | null
    bookingId: string | null
    total: number
}) {
    return (
        <div>
            <h2 className="text-2xl font-bold text-ink mt-8 mb-4">Payment</h2>

            {isLoading && (
                <div className="text-muted text-center py-8 text-sm">
                    Preparing payment...
                </div>
            )}

            {paymentError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 text-sm">
                    {paymentError}
                </div>
            )}

            {clientSecret && bookingId && (
                // key on the secret: a new PaymentIntent needs a fresh Elements
                // instance. Stripe.js will not re-point a mounted Element at a
                // different intent.
                <Elements
                    key={clientSecret}
                    stripe={stripePromise}
                    options={{ clientSecret, appearance }}
                >
                    <PaymentStep bookingId={bookingId} subtotal={total} />
                </Elements>
            )}
        </div>
    )
}