import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { confirmBooking } from '@/lib/db'

// Must be a child of <Elements> — useStripe() and useElements() only work
// inside the Elements provider tree. PaymentSection owns the "Choose when to
// pay" chooser and the heading above this, because those have to sit outside
// the Elements boundary that remounts when the mode changes.

export function PaymentStep({
    bookingId,
    subtotal,
}: {
    bookingId: string
    subtotal: number
}) {
    const stripe = useStripe()
    const elements = useElements()
    const navigate = useNavigate()
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // The book button is gated on this: it's the one place the customer agrees
    // to the amount before it's charged.
    const [agreedToTerms, setAgreedToTerms] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        // stripe and elements are null during the initial render before Stripe.js
        // has loaded. The submit button is already disabled in this state, but
        // the guard here prevents any edge-case double-submit.
        if (!stripe || !elements) return

        setProcessing(true)
        setError(null)

        // elements.submit() validates the form client-side and performs any
        // preliminary tokenization. It does NOT charge the card.
        // Errors here are things like incomplete card number, expired date, etc.
        const { error: submitError } = await elements.submit()
        if (submitError) {
            setError(submitError.message ?? 'Please check your card details')
            setProcessing(false)
            return
        }

        // stripe.confirmPayment() actually charges the card using the
        // PaymentIntent identified by the clientSecret that was passed to
        // the <Elements> provider above.
        //
        // redirect: 'if_required' handles 3D Secure inline when possible.
        // return_url is the fallback for cards that require a full browser
        // redirect for 3DS — Stripe sends the user back here after authentication.
        // Without it, those payments fail silently with no error shown. The
        // booking-confirmed page handles checking the PaymentIntent status on arrival.
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
            confirmParams: {
                return_url: `${window.location.origin}/booking-confirmed?bookingId=${bookingId}`,
            },
        })

        if (stripeError) {
            // stripeError.message comes directly from Stripe and is already
            // user-friendly ("Your card was declined", "Insufficient funds", etc.)
            setError(stripeError.message ?? 'Payment failed. Please try again.')
            setProcessing(false)
            return
        }

        if (paymentIntent?.status === 'succeeded') {
            try {
                // Verify on the server: confirmBooking re-fetches the PaymentIntent
                // from Stripe directly to confirm it's genuinely succeeded before
                // updating the booking row to 'confirmed'. This prevents a malicious
                // user from calling confirmBooking with a fake paymentIntentId.
                await confirmBooking({
                    data: {
                        bookingId,
                        paymentIntentId: paymentIntent.id,
                    }
                })
                void navigate({ to: '/booking-confirmed', search: { bookingId } })
            } catch (e: unknown) {
                // Payment went through on Stripe's side but the DB update failed.
                // The webhook (payment_intent.succeeded) will catch this as a backup
                // and set status to 'confirmed' even if we never reach this navigate.
                setError('Payment succeeded but confirmation failed. Please contact us — your booking ID is ' + bookingId)
                setProcessing(false)
            }
            return
        }

        // Any non-succeeded status that slips through without a stripeError.
        // Without this branch the button sits on "Processing payment..." forever
        // with nothing shown and no way out — which is exactly what happened when
        // PaymentElement had fields.billingDetails set to 'never' (see below).
        //
        // Statuses that reach here: 'requires_action' (3DS not completed inline),
        // 'requires_confirmation', 'processing' (bank processing). Rare with
        // redirect: 'if_required', but they must be handled gracefully.
        if (paymentIntent) {
            setError(
                `Payment status: ${paymentIntent.status}. ` +
                'If you were charged, please contact us with your booking reference: ' + bookingId
            )
        } else {
            setError('Payment did not complete. Please try again.')
        }
        setProcessing(false)
    }

    return (
        <form onSubmit={handleSubmit}>
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                {/*
                    PaymentElement renders the card input form styled using the
                    appearance config passed to <Elements> in the route file.

                    Do NOT add fields.billingDetails: 'never' here. That tells Stripe
                    "I will provide this data myself in confirmPayment's confirmParams" —
                    and unless those details are actually supplied, Stripe returns a
                    non-succeeded paymentIntent with no stripeError, which is the
                    infinite "Processing payment..." state.

                    Likewise no layout: 'accordion' — that enables Stripe Link's
                    "Save my information for faster checkout" promotional section. The
                    default 'tabs' layout does not. To suppress Link across all layouts,
                    disable it at the account level in the Stripe Dashboard.

                    There is no method chooser above these fields because the intent
                    permits exactly one family of methods — see PAYMENT_METHOD_TYPES in
                    src/lib/db.ts. In card mode that means the card fields render bare,
                    which is the whole point; nothing here filters them.

                    wallets: applePay/googlePay 'auto' shows those buttons automatically
                    when the device and browser support them.
                */}
                <PaymentElement
                    options={{
                        wallets: {
                            applePay: 'auto',
                            googlePay: 'auto',
                        },
                    }}
                />
            </div>

            <label className="flex items-start gap-3 mt-6 cursor-pointer">
                <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-[#152110] cursor-pointer flex-shrink-0"
                />
                <span className="text-sm text-gray-700">
                    I agree to pay the total shown and to the BlueFin Rentals terms of service
                    and cancellation policy.
                </span>
            </label>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4 text-red-800 text-sm">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={!stripe || processing || !agreedToTerms}
                className="mt-6 w-full py-4 bg-[#152110] hover:bg-[#1d2f17] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-lg transition-colors cursor-pointer"
            >
                {processing ? 'Processing payment...' : `Book trip · $${subtotal.toFixed(2)}`}
            </button>

            <p className="text-center text-gray-500 text-xs mt-3">Secured by Stripe</p>
        </form>
    )
}