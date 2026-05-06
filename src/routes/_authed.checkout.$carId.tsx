import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
    Elements,
    PaymentElement,
    useStripe,
    useElements,
} from '@stripe/react-stripe-js'
import { z } from 'zod'
import {
    getCarById,
    getProfile,
    saveDriverInfo,
    createIdentitySession,
    createCheckoutSession,
    confirmBooking,
    finalizeIdentitySession,
} from '@/lib/db'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// These are the search params passed from the car page via navigate()
const checkoutSearchSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    totalDays: z.number(),
    subtotal: z.number(),
    pickupLocation: z.string(),
    bookingId: z.string().optional(),
})

export const Route = createFileRoute('/_authed/checkout/$carId')({
    validateSearch: checkoutSearchSchema,
    loader: async ({ params }) => {
        // Load car details and profile in parallel — faster than sequential
        const [car, profile] = await Promise.all([
            getCarById({ data: params.carId }),
            getProfile(),
        ])
        return { car, profile }
    },
    component: CheckoutPage,
})

// Build an ISO string from a date input (either YYYY-MM-DD or a full ISO) and an "HH:mm" time.
// Robust to receiving a full ISO (e.g., 2026-04-03T00:00:00.000Z) by slicing YYYY-MM-DD.
const buildDateTime = (dateInput: string, time: string): string => {
    const yyyyMmDd = dateInput.slice(0, 10)
    const [hRaw, mRaw] = time.split(':')
    const hourStr = String(Number(hRaw ?? 0)).padStart(2, '0')
    const minuteStr = String(Number(mRaw ?? 0)).padStart(2, '0')
    const iso = `${yyyyMmDd}T${hourStr}:${minuteStr}:00`
    const d = new Date(iso)
    if (isNaN(d.getTime())) {
        throw new Error(`Invalid date/time: ${iso}`)
    }
    return d.toISOString()
}

// The three steps of first-time checkout
type Step = 'driver-info' | 'identity' | 'payment'

function CheckoutPage() {
    const { car, profile: initialProfile } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const search = Route.useSearch()
    const [currentProfile, setCurrentProfile] = useState(initialProfile)


    // Determine starting step based on what the user has already completed.
    // identity_verified means they've done both info and verification before.
    // If profile has a name but isn't verified, they need identity step.
    // If profile is empty, start from the beginning.
    const getInitialStep = (): Step => {
        if (currentProfile?.identity_verified) return 'payment'
        if (currentProfile?.full_name) return 'identity'
        return 'driver-info'
    }

    const [step, setStep] = useState<Step>(getInitialStep)

    // Hard guard on payment step, never allow an unverified user to reach this step
    useEffect(() => {
        if (step === 'payment' && !currentProfile?.identity_verified) {
            setStep('identity')
        }
    }, [step, currentProfile])


    const [clientSecret, setClientSecret] = useState<string | null>(null)
    const [bookingId, setBookingId] = useState<string | null>(null)
    const [paymentError, setPaymentError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Initialize Stripe payment intent when we reach the payment step
    // The ref prevents double-initialization from React Strict Mode
    const hasInitialized = useRef(false)
    useEffect(() => {
        if (step !== 'payment' || hasInitialized.current) return
        hasInitialized.current = true

        const init = async () => {
            setIsLoading(true)
            try {
                const result = await createCheckoutSession({
                    data: {
                        carId,
                        startTime: buildDateTime(search.startDate, search.startTime),
                        endTime: buildDateTime(search.endDate, search.endTime),
                        totalPrice: search.subtotal,
                        pickupLocation: search.pickupLocation,
                        bookingId: search.bookingId,
                    }
                })
                setClientSecret(result.clientSecret)
                setBookingId(result.bookingId)
            } catch (e: any) {
                setPaymentError(e.message)
            } finally {
                setIsLoading(false)
            }
        }
        init()
    }, [step])

    const startDate = new Date(search.startDate).toLocaleDateString()
    const endDate = new Date(search.endDate).toLocaleDateString()

    return (
        <div className="min-h-screen bg-[#152110] py-12">
            <div className="max-w-2xl mx-auto px-4">

                {/* Step indicator */}
                <div className="mt-6 flex items-center gap-2 mb-8">
                    {(['driver-info', 'identity', 'payment'] as Step[]).map((s, i) => (
                        <div key={s} className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                step === s
                                    ? 'bg-[#3a7d2c] text-white'
                                    : getInitialStep() === 'payment' ||
                                    (getInitialStep() === 'identity' && i === 0) ||
                                    step === 'identity' && i === 0 ||
                                    step === 'payment' && i < 2
                                        ? 'bg-[#2a4a1e] text-[#6fcf4a]'
                                        : 'bg-[#1e3318] text-[#3d5c38]'
                            }`}>
                                {i + 1}
                            </div>
                            <span className={`text-xs hidden sm:block ${step === s ? 'text-[#d4e8c2]' : 'text-[#6a9455]'}`}>
                                {s === 'driver-info' ? 'Your info' : s === 'identity' ? 'Verify ID' : 'Payment'}
                            </span>
                            {i < 2 && <div className="w-8 h-px bg-[#2a4a1e]" />}
                        </div>
                    ))}
                </div>

                {/* Trip summary — visible on all steps */}
                <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-5 mb-6">
                    <div className="flex gap-4 items-center">
                        <img
                            src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/main.PNG`}
                            alt={`${car.year} ${car.make} ${car.model}`}
                            className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-white">{car.year} {car.make} {car.model}</p>
                            <p className="text-[#a3c98a] text-sm mt-0.5">
                                {startDate}, {search.startTime} → {endDate}, {search.endTime} · Total: ${search.subtotal}
                            </p>
                            <p className="text-[#6a9455] text-xs mt-0.5">{search.pickupLocation}</p>
                        </div>
                    </div>
                </div>

                {/* Step content */}
                {step === 'driver-info' && (
                    <DriverInfoStep
                        existingProfile={currentProfile}
                        onComplete={() => {
                            // Tell local state we have a name so getInitialStep doesn't get confused
                            setCurrentProfile((prev: any) => ({ ...prev, full_name: 'Saved' }))
                            setStep('identity')
                        }}
                    />
                )}

                {step === 'identity' && (
                    <IdentityStep
                        carId={carId}
                        search={search}
                        onComplete={() => {
                            // Instantly update the local profile state so the hard guard lets us pass
                            setCurrentProfile((prev: any) => ({ ...prev, identity_verified: true }))
                            setStep('payment')
                        }}
                    />
                )}

                {step === 'payment' && (
                    <>
                        {isLoading && (
                            <div className="text-[#a3c98a] text-center py-8">
                                Preparing payment...
                            </div>
                        )}
                        {paymentError && (
                            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300">
                                {paymentError}
                            </div>
                        )}
                        {clientSecret && bookingId && (
                            <Elements
                                stripe={stripePromise}
                                options={{
                                    clientSecret,
                                    appearance: {
                                        theme: 'night',
                                        variables: {
                                            colorPrimary: '#6fcf4a',
                                            colorBackground: '#1a3314',
                                            colorText: '#d4e8c2',
                                            colorDanger: '#ff6b6b',
                                            fontFamily: 'Mona Sans, sans-serif',
                                            borderRadius: '8px',
                                        },
                                    },
                                }}
                            >
                                <PaymentStep
                                    bookingId={bookingId}
                                    subtotal={search.subtotal}
                                />
                            </Elements>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

// ─── Step 1: Driver info ───────────────────────────────────────────────────────

function DriverInfoStep({
                            existingProfile,
                            onComplete,
                        }: {
    existingProfile: any
    onComplete: () => void
}) {
    // Pre-fill from existing profile if they have partial data
    const [form, setForm] = useState({
        fullName: existingProfile?.full_name ?? '',
        dateOfBirth: existingProfile?.date_of_birth ?? '',
        email: existingProfile?.email ?? '',
        phone: existingProfile?.phone ?? '',
        address: existingProfile?.address ?? '',
        city: existingProfile?.city ?? '',
        state: existingProfile?.state ?? '',
        zip: existingProfile?.zip ?? '',
    })
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(prev => ({ ...prev, [field]: e.target.value }))

    const handleSubmit = async () => {
        // Basic validation before hitting the server
        if (!form.fullName || !form.dateOfBirth || !form.phone ||
            !form.address || !form.city || !form.state || !form.zip) {
            setError('Please fill in all fields')
            return
        }

        setSaving(true)
        setError(null)
        try {
            await saveDriverInfo({ data: form })
            onComplete()
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    const inputClass = "w-full bg-[#152110] border border-[#2a4a1e] rounded-lg px-3 py-2.5 text-[#d4e8c2] text-sm placeholder:text-[#3d5c38] focus:outline-none focus:border-[#6fcf4a] transition-colors"
    const labelClass = "block text-xs font-medium text-[#6a9455] mb-1"

    return (
        <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#d4e8c2] mb-1">Driver information</h2>
            <p className="text-[#6a9455] text-sm mb-6">
                Required once for all future bookings.
            </p>

            <div className="space-y-4">
                <div>
                    <label className={labelClass}>Full legal name</label>
                    <input
                        className={inputClass}
                        placeholder="As it appears on your license"
                        value={form.fullName}
                        onChange={update('fullName')}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Date of birth</label>
                        <input
                            type="date"
                            className={inputClass}
                            value={form.dateOfBirth}
                            onChange={update('dateOfBirth')}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Phone number</label>
                        <input
                            className={inputClass}
                            placeholder="(612) 555-0100"
                            value={form.phone}
                            onChange={update('phone')}
                        />
                    </div>
                </div>

                <div>
                    <label className={labelClass}>Street address</label>
                    <input
                        className={inputClass}
                        placeholder="123 Main St"
                        value={form.address}
                        onChange={update('address')}
                    />
                </div>

                <div className="grid grid-cols-5 gap-3">
                    <div className="col-span-2">
                        <label className={labelClass}>City</label>
                        <input
                            className={inputClass}
                            placeholder="Minneapolis"
                            value={form.city}
                            onChange={update('city')}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>State</label>
                        <input
                            className={inputClass}
                            placeholder="MN"
                            maxLength={2}
                            value={form.state}
                            onChange={update('state')}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass}>ZIP code</label>
                        <input
                            className={inputClass}
                            placeholder="55401"
                            maxLength={5}
                            value={form.zip}
                            onChange={update('zip')}
                        />
                    </div>
                </div>
            </div>

            {error && (
                <p className="text-red-400 text-sm mt-4">{error}</p>
            )}

            <button
                onClick={handleSubmit}
                disabled={saving}
                className="mt-6 w-full py-3 bg-[#3a7d2c] hover:bg-[#4a9e38] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
            >
                {saving ? 'Saving...' : 'Continue to ID verification'}
            </button>
        </div>
    )
}

// ─── Step 2: Identity verification ────────────────────────────────────────────

function IdentityStep({
                          carId,
                          search,
                          onComplete,
                      }: {
    carId: string
    search: any
    onComplete: () => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // polling tracks whether we're waiting for the webhook to confirm verification
    const [polling, setPolling] = useState(false)

    const handleStartVerification = async () => {
        setLoading(true)
        setError(null)
        try {
            // Build the return URL — Stripe redirects here after the scan
            // We pass a 'verified=true' param so we know why they came back
            const returnUrl = `${window.location.origin}/checkout/${carId}?${new URLSearchParams({
                ...Object.fromEntries(
                    Object.entries(search).map(([k, v]) => [k, String(v)])
                ),
                verificationReturn: 'true',
            })}`

            const { url } = await createIdentitySession({ data: { returnUrl } })

            // Redirect to Stripe's hosted verification page
            // Stripe handles the camera, document scan, and selfie match
            window.location.href = url!
        } catch (e: any) {
            setError(e.message)
            setLoading(false)
        }
    }

    // When Stripe redirects back, it includes session_id=vi_... in the query.
    // First, finalize on the server by retrieving the session from Stripe.
    // If not present (older sessions), fall back to polling the profile until the identity webhook updates it.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const cameFromStripe = params.get('verificationReturn') === 'true'

        if (!cameFromStripe) return

        let cleaned = false

        const run = async () => {
            setError(null)
            setPolling(true)

            try {
                // Fetch user's profile to get the session ID
                const profile = await getProfile()

                // If webhook already beat us to it, move to next step
                if (profile?.identity_verified) {
                    setPolling(false)
                    if (!cleaned) onComplete()
                    return
                }

                const sessionId = profile?.stripe_identity_session_id
                if (!sessionId) {
                    throw new Error("Could not find your verification session.")
                }

                let attempts = 0
                const maxAttempts = 20 // ~40s

                const interval = setInterval(async () => {
                    if (cleaned) return
                    attempts++

                    try {
                        const res = await finalizeIdentitySession({data: {sessionId}})

                        if ((res as any)?.verified) {
                            clearInterval(interval)
                            setPolling(false)
                            onComplete() // Moves user to payment step
                        } else if (attempts >= maxAttempts) {
                            clearInterval(interval)
                            setPolling(false)
                            setError('Verification is taking longer than expected. Please try again.')
                        }
                    } catch (e) {

                    }
                }, 2000)


            } catch (err: any) {
                if (!cleaned) {
                    setPolling(false)
                    setError(err.message)
                }
            }
        }

        void run()

        // Cleanup when component unmounts
        return () => {
            cleaned = true
        }
    }, [])

    if (polling) {
        return (
            <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-8 text-center">
                <div className="text-3xl mb-4">⏳</div>
                <p className="text-[#d4e8c2] font-semibold">Confirming your verification...</p>
                <p className="text-[#6a9455] text-sm mt-2">This usually takes just a few seconds.</p>
            </div>
        )
    }

    return (
        <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#d4e8c2] mb-1">Verify your identity</h2>
            <p className="text-[#6a9455] text-sm mb-6">
                Required once. You'll need your driver's license and a moment to take a quick selfie.
                Powered by Stripe Identity.
            </p>

            <div className="space-y-3 mb-6">
                {[
                    "Take a photo of your driver's license",
                    'Take a quick selfie to match your photo',
                    'Results confirmed instantly',
                ].map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#2a4a1e] text-[#6fcf4a] flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {i + 1}
                        </div>
                        <p className="text-[#a3c98a] text-sm">{step}</p>
                    </div>
                ))}
            </div>

            {error && (
                <p className="text-red-400 text-sm mb-4">{error}</p>
            )}

            <button
                onClick={handleStartVerification}
                disabled={loading}
                className="w-full py-3 bg-[#3a7d2c] hover:bg-[#4a9e38] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
            >
                {loading ? 'Loading...' : 'Start verification →'}
            </button>
        </div>
    )
}

// ─── Step 3: Payment ───────────────────────────────────────────────────────────

// This component must be a child of <Elements> to access useStripe/useElements
function PaymentStep({
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!stripe || !elements) return

        setProcessing(true)
        setError(null)

        // Tell Stripe Elements to validate and tokenize the card input
        const { error: submitError } = await elements.submit()
        if (submitError) {
            // This catches incomplete form errors before even hitting Stripe's API
            setError(submitError.message ?? 'Please check your card details')
            setProcessing(false)
            return
        }

        // Actually charge the card
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            // 'if_required' means we handle the redirect ourselves for cards
            // that don't need 3D Secure — avoids a full page reload for most users
            redirect: 'if_required',
        })

        if (stripeError) {
            // stripeError.message is user-friendly — things like "Your card was declined"
            // or "Insufficient funds" — safe to show directly to the user
            setError(stripeError.message ?? 'Payment failed. Please try again.')
            setProcessing(false)
            return
        }

        if (paymentIntent?.status === 'succeeded') {
            try {
                // Confirm booking server-side — verifies payment with Stripe
                // before updating booking status to 'confirmed'
                await confirmBooking({
                    data: {
                        bookingId,
                        paymentIntentId: paymentIntent.id,
                    }
                })
                void navigate({
                    to: '/booking-confirmed',
                    search: { bookingId }
                })
            } catch (e: any) {
                // Payment went through but our DB update failed —
                // the webhook will catch this as a backup
                setError('Payment succeeded but booking confirmation had an issue. Please contact us.')
                setProcessing(false)
            }
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-6 mb-4">
                <h2 className="text-lg font-semibold text-[#d4e8c2] mb-4">Payment details</h2>
                {/* PaymentElement renders card input + Apple Pay / Google Pay
                    automatically when the device/browser supports it */}
                <PaymentElement />
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={!stripe || processing}
                className="w-full py-4 bg-[#3a7d2c] hover:bg-[#4a9e38] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-lg transition-colors cursor-pointer"
            >
                {processing ? 'Processing payment...' : `Pay $${subtotal}`}
            </button>
        </form>
    )
}