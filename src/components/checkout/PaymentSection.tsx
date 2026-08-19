import { Elements } from '@stripe/react-stripe-js'
import type { Appearance, Stripe } from '@stripe/stripe-js'
import type { PaymentMode } from '@/lib/db'
import { PaymentStep } from './PaymentStep'

function RadioDot({ checked }: { checked: boolean }) {
    return (
        <span
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                checked ? 'border-[#152110]' : 'border-gray-400'
            }`}
        >
            {checked && <span className="w-2.5 h-2.5 rounded-full bg-[#152110]" />}
        </span>
    )
}

// Card is first and is the default
const OPTIONS: { mode: PaymentMode; label: string; description: string }[] = [
    {
        mode: 'card',
        label: 'Pay now',
        description: 'Pay the full trip total today with a credit or debit card.',
    },
    {
        mode: 'other',
        label: 'Other payment options',
        description: 'Bank account, Cash App Pay, Amazon Pay, Affirm or Klarna.',
    },
]

export function PaymentSection({
    stripePromise,
    appearance,
    isLoading,
    paymentError,
    clientSecret,
    bookingId,
    total,
    paymentMode,
    onPaymentModeChange,
}: {
    stripePromise: Promise<Stripe | null>
    appearance: Appearance
    isLoading: boolean
    paymentError: string | null
    clientSecret: string | null
    bookingId: string | null
    total: number
    paymentMode: PaymentMode
    onPaymentModeChange: (mode: PaymentMode) => void
}) {
    return (
        <div>
            {/* Deliberately outside <Elements>: switching mode swaps the client
                secret, which remounts the whole Elements tree. Keeping the
                chooser above that boundary means it doesn't flicker as the new
                PaymentIntent is fetched. */}
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Choose when to pay</h2>

            <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-200 shadow-sm">
                {OPTIONS.map(({ mode, label, description }) => (
                    <label
                        key={mode}
                        className="flex items-start gap-3 p-4 cursor-pointer"
                    >
                        <input
                            type="radio"
                            name="paymentMode"
                            className="sr-only"
                            checked={paymentMode === mode}
                            onChange={() => onPaymentModeChange(mode)}
                            disabled={isLoading}
                        />
                        <RadioDot checked={paymentMode === mode} />
                        <div>
                            <span className="text-gray-900 font-medium">{label}</span>
                            <p className="text-sm text-gray-500 mt-1">{description}</p>
                        </div>
                    </label>
                ))}
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mt-8 mb-4">Payment</h2>

            {isLoading && (
                <div className="text-gray-500 text-center py-8 text-sm">
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