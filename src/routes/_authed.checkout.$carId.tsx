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

// loadStripe is called once at module level — NOT inside a component.
// If it were inside a component, a new Stripe instance would be created
// on every render, which breaks the Elements context and causes payment
// initialization to restart repeatedly.
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// Zod validates that the URL search params are exactly the right shape
// before the loader or component even runs. If a param is missing or
// the wrong type, TanStack Router throws a structured error immediately.
const checkoutSearchSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    totalDays: z.number(),
    subtotal: z.number(),
    pickupLocation: z.string(),
    // bookingId is optional — only present when resuming an existing
    // pending booking rather than creating a fresh one
    bookingId: z.string().optional(),
})

// Derive the search type from the schema so it's always in sync
type CheckoutSearch = z.infer<typeof checkoutSearchSchema>

export const Route = createFileRoute('/_authed/checkout/$carId')({
    validateSearch: checkoutSearchSchema,
    loader: async ({ params }) => {
        // Promise.all fetches both in parallel — faster than awaiting sequentially.
        // If either throws, the loader fails and TanStack Router shows the
        // errorComponent rather than rendering a broken checkout.
        const [car, profile] = await Promise.all([
            getCarById({ data: params.carId }),
            getProfile(),
        ])
        return { car, profile }
    },
    component: CheckoutPage,
})

// ── Utility: buildDateTime ────────────────────────────────────────────────────
//
// Combines a date string (YYYY-MM-DD or full ISO) with an HH:mm time string
// into a UTC ISO string. Defined outside the component so it's created once
// at module load time, not re-created on every render.

const buildDateTime = (dateInput: string, time: string): string => {
    const yyyyMmDd = dateInput.slice(0, 10)
    const parts = time.split(':')
    const hourStr = String(Number(parts[0] ?? 0)).padStart(2, '0')
    const minuteStr = String(Number(parts[1] ?? 0)).padStart(2, '0')
    const localIso = `${yyyyMmDd}T${hourStr}:${minuteStr}:00`
    const d = new Date(localIso)
    if (isNaN(d.getTime())) throw new Error(`Invalid date/time: ${localIso}`)
    return d.toISOString()
}

// The three sequential checkout steps
type Step = 'driver-info' | 'identity' | 'payment'

// ── CheckoutPage ──────────────────────────────────────────────────────────────

function CheckoutPage() {
    const { car, profile: initialProfile } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const search = Route.useSearch()

    // currentProfile is kept in local state so that completing steps 1 and 2
    // can optimistically update the profile without a full page reload or
    // re-loader. This avoids a round-trip to Supabase between steps.
    const [currentProfile, setCurrentProfile] = useState(initialProfile)

    // Determine the starting step based on what the user has already completed.
    // This is a function (not a value) because useState accepts a lazy initializer:
    // React calls it once on mount and never again, which is what we want.
    const getInitialStep = (): Step => {
        if (currentProfile?.identity_verified) return 'payment'
        if (currentProfile?.full_name) return 'identity'
        return 'driver-info'
    }

    const [step, setStep] = useState<Step>(getInitialStep)

    // Hard server-side guard backup: even if client-side state says 'payment',
    // if identity_verified is false the user is kicked back to the identity step.
    // The real guard is in createCheckoutSession on the server, which checks
    // identity_verified before creating the PaymentIntent — this is just a UI
    // safety net to prevent showing the payment form to unverified users.
    useEffect(() => {
        if (step === 'payment' && !currentProfile?.identity_verified) {
            setStep('identity')
        }
    }, [step, currentProfile])

    const [clientSecret, setClientSecret] = useState<string | null>(null)
    const [bookingId, setBookingId] = useState<string | null>(null)
    const [paymentError, setPaymentError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // hasInitialized prevents double-invocation from React Strict Mode.
    // In development, React deliberately calls effects twice to surface bugs.
    // Without this ref, two PaymentIntents and two pending booking rows would
    // be created. The ref persists across re-renders without causing them.
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
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : 'Failed to initialize payment'
                setPaymentError(message)
            } finally {
                setIsLoading(false)
            }
        }
        void init()
    }, [step])

    const startDate = new Date(search.startDate).toLocaleDateString()
    const endDate = new Date(search.endDate).toLocaleDateString()

    return (
        <div className="min-h-screen bg-[#152110] py-12">
            <div className="max-w-2xl mx-auto px-4">

                {/* Step progress indicator */}
                <div className="mt-6 flex items-center gap-2 mb-8">
                    {(['driver-info', 'identity', 'payment'] as Step[]).map((s, i) => {
                        const isActive = step === s
                        const isCompleted =
                            (s === 'driver-info' && (step === 'identity' || step === 'payment')) ||
                            (s === 'identity' && step === 'payment')
                        return (
                            <div key={s} className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                    isActive
                                        ? 'bg-gray-800 text-gray-200'
                                        : isCompleted
                                            ? 'bg-gray-400 text-white'
                                            : 'bg-gray-200/40 text-gray-500'
                                }`}>
                                    {i + 1}
                                </div>
                                <span className={`text-xs hidden sm:block ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                                    {s === 'driver-info' ? 'Your info' : s === 'identity' ? 'Verify ID' : 'Payment'}
                                </span>
                                {i < 2 && <div className="w-8 h-px bg-gray-700" />}
                            </div>
                        )
                    })}
                </div>

                {/* Trip summary card — visible on all steps */}
                <div className="bg-gray-200 border border-gray-400 rounded-2xl p-5 mb-6">
                    <div className="flex gap-4 items-center">
                        <img
                            src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/main.PNG`}
                            alt={`${car.year} ${car.make} ${car.model}`}
                            className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900">{car.year} {car.make} {car.model}</p>
                            <p className="text-gray-700 text-sm mt-0.5">
                                {startDate}, {search.startTime} → {endDate}, {search.endTime}
                            </p>
                            <p className="text-gray-600 text-xs mt-0.5">{search.pickupLocation}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                            <p className="font-bold text-gray-900 text-lg">${search.subtotal}</p>
                            <p className="text-gray-500 text-xs">total</p>
                        </div>
                    </div>
                </div>

                {/* ── Step content ─────────────────────────────────────────── */}

                {step === 'driver-info' && (
                    <DriverInfoStep
                        existingProfile={currentProfile}
                        onComplete={() => {
                            // Optimistically update local state so getInitialStep()
                            // sees a full_name and doesn't restart from step 1
                            setCurrentProfile(prev => ({ ...prev, full_name: 'Saved' } as typeof prev))
                            setStep('identity')
                        }}
                    />
                )}

                {step === 'identity' && (
                    <IdentityStep
                        carId={carId}
                        search={search}
                        onComplete={() => {
                            // Optimistically mark verified so the hard guard
                            // (useEffect above) doesn't kick us back to identity
                            setCurrentProfile(prev => ({ ...prev, identity_verified: true } as typeof prev))
                            setStep('payment')
                        }}
                    />
                )}

                {step === 'payment' && (
                    <>
                        {isLoading && (
                            <div className="text-gray-400 text-center py-8 text-sm">
                                Preparing payment...
                            </div>
                        )}
                        {paymentError && (
                            <div className="bg-red-100 border border-red-400 rounded-xl p-4 text-red-800 text-sm">
                                {paymentError}
                            </div>
                        )}
                        {clientSecret && bookingId && (
                            // The Elements provider gives useStripe() and useElements()
                            // access to the initialized Stripe instance and PaymentElement.
                            // clientSecret ties these Elements to the specific PaymentIntent
                            // created for this booking — never reuse a clientSecret across
                            // different payment attempts.
                            <Elements
                                stripe={stripePromise}
                                options={{
                                    clientSecret,
                                    appearance: {
                                        // ── FIX: theme: 'stripe' is the correct choice for a
                                        // light-colored card background (bg-gray-200 = #e5e7eb).
                                        // 'flat' removes borders between input fields, making them
                                        // hard to visually distinguish. 'stripe' provides clean
                                        // bordered inputs that work well on light backgrounds.
                                        theme: 'stripe',
                                        variables: {
                                            colorPrimary: '#1f2937',      // gray-800 — matches buttons
                                            colorBackground: '#e5e7eb',   // gray-200 — matches card bg
                                            colorText: '#1f2937',         // gray-800 — primary text
                                            colorTextSecondary: '#6b7280', // gray-500 — secondary text
                                            colorDanger: '#b91c1c',       // red-700 — error state
                                            fontFamily: 'Mona Sans, ui-sans-serif, system-ui, sans-serif',
                                            borderRadius: '8px',
                                            spacingUnit: '4px',
                                        },
                                        rules: {
                                            // Give input fields a visible border so they're
                                            // clearly interactive on the gray card background
                                            '.Input': {
                                                border: '1px solid #9ca3af',
                                                boxShadow: 'none',
                                            },
                                            '.Input:focus': {
                                                border: '1px solid #1f2937',
                                                boxShadow: 'none',
                                            },
                                        },
                                    },
                                }}
                            >
                                <PaymentStep
                                    bookingId={bookingId}
                                    subtotal={search.subtotal}
                                    carId={carId}
                                />
                            </Elements>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

// ─── Step 1: Driver info ──────────────────────────────────────────────────────

function DriverInfoStep({
                            existingProfile,
                            onComplete,
                        }: {
    existingProfile: Awaited<ReturnType<typeof getProfile>>
    onComplete: () => void
}) {
    const [form, setForm] = useState({
        fullName:    existingProfile?.full_name    ?? '',
        dateOfBirth: existingProfile?.date_of_birth ?? '',
        email:       existingProfile?.email        ?? '',
        phone:       existingProfile?.phone        ?? '',
        address:     existingProfile?.address      ?? '',
        city:        existingProfile?.city         ?? '',
        state:       existingProfile?.state        ?? '',
        zip:         existingProfile?.zip          ?? '',
    })
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // Returns a change handler for any field — avoids writing one per input
    const update = (field: keyof typeof form) =>
        (e: React.ChangeEvent<HTMLInputElement>) =>
            setForm(prev => ({ ...prev, [field]: e.target.value }))

    const handleSubmit = async () => {
        const required = ['fullName', 'dateOfBirth', 'phone', 'address', 'city', 'state', 'zip'] as const
        if (required.some(f => !form[f]?.trim())) {
            setError('Please fill in all required fields')
            return
        }
        setSaving(true)
        setError(null)
        try {
            await saveDriverInfo({ data: form })
            onComplete()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to save information')
        } finally {
            setSaving(false)
        }
    }

    const inputClass = "w-full bg-gray-100 border border-gray-400 rounded-lg px-3 py-2.5 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-700 transition-colors"
    const labelClass = "block text-xs font-medium text-gray-700 mb-1"

    return (
        <div className="bg-gray-200 border border-gray-400 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Driver information</h2>
            <p className="text-gray-600 text-sm mb-6">Required once for all future bookings.</p>

            <div className="space-y-4">
                <div>
                    <label className={labelClass}>Full legal name</label>
                    <input className={inputClass} placeholder="As it appears on your license"
                           value={form.fullName} onChange={update('fullName')} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Date of birth</label>
                        <input type="date" className={inputClass}
                               value={form.dateOfBirth} onChange={update('dateOfBirth')} />
                    </div>
                    <div>
                        <label className={labelClass}>Phone number</label>
                        <input className={inputClass} placeholder="(612) 555-0100"
                               value={form.phone} onChange={update('phone')} />
                    </div>
                </div>

                <div>
                    <label className={labelClass}>Street address</label>
                    <input className={inputClass} placeholder="123 Main St"
                           value={form.address} onChange={update('address')} />
                </div>

                <div className="grid grid-cols-5 gap-3">
                    <div className="col-span-2">
                        <label className={labelClass}>City</label>
                        <input className={inputClass} placeholder="Minneapolis"
                               value={form.city} onChange={update('city')} />
                    </div>
                    <div>
                        <label className={labelClass}>State</label>
                        <input className={inputClass} placeholder="MN" maxLength={2}
                               value={form.state} onChange={update('state')} />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass}>ZIP code</label>
                        <input className={inputClass} placeholder="55401" maxLength={5}
                               value={form.zip} onChange={update('zip')} />
                    </div>
                </div>
            </div>

            {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

            <button
                onClick={handleSubmit}
                disabled={saving}
                className="mt-6 w-full py-3 bg-gray-800 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-gray-100 font-semibold rounded-xl transition-colors"
            >
                {saving ? 'Saving...' : 'Continue to ID verification'}
            </button>
        </div>
    )
}

// ─── Step 2: Identity verification ───────────────────────────────────────────

function IdentityStep({
                          carId,
                          search,
                          onComplete,
                      }: {
    carId: string
    search: CheckoutSearch
    onComplete: () => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [polling, setPolling] = useState(false)

    const handleStartVerification = async () => {
        setLoading(true)
        setError(null)
        try {
            // Build the return URL with all current search params preserved so
            // the user lands back on the same checkout state after the scan.
            // verificationReturn=true signals to the useEffect below that we've
            // come back from Stripe and should begin polling for the result.
            const params = new URLSearchParams(
                Object.fromEntries(
                    Object.entries(search).map(([k, v]) => [k, String(v)])
                )
            )
            params.set('verificationReturn', 'true')
            const returnUrl = `${window.location.origin}/checkout/${carId}?${params.toString()}`

            const result = await createIdentitySession({ data: { returnUrl } })

            // ── FIX: guard the url before using it ────────────────────────────
            // The old code used url! (non-null assertion). If Stripe returns a
            // session without a url, that navigates to the literal string "null",
            // showing a broken page with no error. Now we throw explicitly so the
            // catch block shows the user a real error message instead.
            if (!result.url) throw new Error('Verification session URL was not returned')
            window.location.href = result.url
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start verification')
            setLoading(false)
        }
    }

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('verificationReturn') !== 'true') return

        let cancelled = false
        // ── FIX: store intervalId so it can be cleared on unmount ────────────
        // The old code stored the interval in a local variable inside the
        // async function, so the cleanup return could never reach it.
        // Now intervalId is declared in the outer scope so the cleanup can
        // call clearInterval on the actual timer handle.
        let intervalId: ReturnType<typeof setInterval> | null = null

        const run = async () => {
            setError(null)
            setPolling(true)

            try {
                const profile = await getProfile()

                // Fast path: webhook already confirmed verification
                if (profile?.identity_verified) {
                    if (!cancelled) {
                        setPolling(false)
                        onComplete()
                    }
                    return
                }

                const sessionId = profile?.stripe_identity_session_id
                if (!sessionId) throw new Error('Verification session not found. Please try again.')

                let attempts = 0
                const maxAttempts = 20 // 40 seconds at 2s intervals

                intervalId = setInterval(async () => {
                    if (cancelled) {
                        if (intervalId) clearInterval(intervalId)
                        return
                    }
                    attempts++

                    try {
                        const res = await finalizeIdentitySession({ data: { sessionId } })
                        if ((res as { verified?: boolean })?.verified) {
                            if (intervalId) clearInterval(intervalId)
                            if (!cancelled) {
                                setPolling(false)
                                onComplete()
                            }
                        } else if (attempts >= maxAttempts) {
                            if (intervalId) clearInterval(intervalId)
                            if (!cancelled) {
                                setPolling(false)
                                // ── FIX: show a specific error instead of the generic message ──
                                // The old catch block was empty (swallowing errors silently).
                                // Now maxAttempts shows the user something actionable.
                                setError('Verification is taking longer than expected. Please try again or contact support.')
                            }
                        }
                    } catch (e: unknown) {
                        // ── FIX: removed the empty catch block ────────────────────────────
                        // Previously errors from finalizeIdentitySession were completely
                        // silenced. Now they surface as actionable error messages.
                        if (intervalId) clearInterval(intervalId)
                        if (!cancelled) {
                            setPolling(false)
                            setError(e instanceof Error ? e.message : 'Verification check failed. Please try again.')
                        }
                    }
                }, 2000)

            } catch (e: unknown) {
                if (!cancelled) {
                    setPolling(false)
                    setError(e instanceof Error ? e.message : 'An error occurred during verification')
                }
            }
        }

        void run()

        return () => {
            // ── FIX: proper cleanup clears the interval AND sets the cancel flag ──
            // The old cleanup only set cleaned=true but could never reach the
            // interval handle (it was in a nested async scope). Now both are cleared
            // so no network calls fire after unmount.
            cancelled = true
            if (intervalId) clearInterval(intervalId)
        }
    }, [])

    if (polling) {
        return (
            <div className="bg-gray-200 border border-gray-400 rounded-2xl p-8 text-center">
                <div className="text-3xl mb-4">⏳</div>
                <p className="text-gray-900 font-semibold">Confirming your verification...</p>
                <p className="text-gray-600 text-sm mt-2">This usually takes just a few seconds.</p>
            </div>
        )
    }

    return (
        <div className="bg-gray-200 border border-gray-400 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Verify your identity</h2>
            <p className="text-gray-600 text-sm mb-6">
                Required once for all future bookings. You'll need your driver's license and a quick selfie.
                Powered by Stripe Identity.
            </p>
            <div className="space-y-3 mb-6">
                {[
                    "Take a photo of your driver's license",
                    'Take a quick selfie to match your photo',
                    'Results confirmed instantly',
                ].map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-gray-800 text-gray-100 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {i + 1}
                        </div>
                        <p className="text-gray-700 text-sm">{s}</p>
                    </div>
                ))}
            </div>
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button
                onClick={handleStartVerification}
                disabled={loading}
                className="w-full py-3 bg-gray-800 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-gray-100 font-semibold rounded-xl transition-colors"
            >
                {loading ? 'Loading...' : 'Start verification →'}
            </button>
        </div>
    )
}

// ─── Step 3: Payment ──────────────────────────────────────────────────────────
//
// Must be a child of <Elements> — useStripe() and useElements() only work
// inside the Elements provider tree.

function PaymentStep({
                         bookingId,
                         subtotal,
                         carId,
                     }: {
    bookingId: string
    subtotal: number
    carId: string
}) {
    const stripe = useStripe()
    const elements = useElements()
    const navigate = useNavigate()
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)

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
        //
        // ── FIX: added return_url ──────────────────────────────────────────────
        // The old code had no return_url. For cards that DO require a redirect
        // for 3DS authentication (some European cards, Amex in certain banks),
        // Stripe needs a URL to return the user to. Without it, those payments
        // fail silently with no error shown. The booking-confirmed page handles
        // checking the PaymentIntent status on arrival.
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

        // ── FIX: added this else block — this was the root cause of "stuck on processing"
        //
        // WHAT WAS WRONG:
        // The old gray-theme version added `fields: { billingDetails: { name: 'never',
        // email: 'never', address: 'never', phone: 'never' } }` to PaymentElement options.
        // Setting a field to 'never' tells Stripe "I will provide this data myself in
        // confirmPayment's confirmParams" — but confirmPayment was never passed those details.
        // Stripe received a payment with suppressed billing fields and no substitute data,
        // causing it to return a paymentIntent with status !== 'succeeded' but WITHOUT setting
        // stripeError. Since there was no else clause, the button stayed stuck on
        // "Processing payment..." permanently with no error shown and no way out.
        //
        // THE FIX:
        // 1. The `fields.billingDetails: 'never'` settings have been completely removed from
        //    PaymentElement below — Stripe now collects what it needs in its own UI.
        // 2. This else clause handles any non-succeeded status that slips through, giving
        //    the user an actionable error and resetting the button.
        //
        // Possible statuses that reach here: 'requires_action' (3DS not completed inline),
        // 'requires_confirmation', 'processing' (bank processing). In production these are
        // rare with redirect: 'if_required', but they must be handled gracefully.
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
            <div className="bg-gray-200 border border-gray-400 rounded-2xl p-6 mb-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment details</h2>

                {/*
                    PaymentElement renders the card input form styled using the
                    appearance config passed to <Elements> above.

                    ── FIX: removed fields.billingDetails: 'never' settings ──────────────
                    Those settings were the root cause of the broken payment.
                    Setting billingDetails fields to 'never' tells Stripe not to collect
                    them in the UI — but then you MUST provide them yourself in confirmPayment's
                    confirmParams.payment_method_data.billing_details. The old code didn't,
                    causing Stripe to silently fail and return a non-succeeded paymentIntent
                    with no stripeError, resulting in the infinite "Processing payment..." state.

                    ── FIX: removed layout: 'accordion' ────────────────────────────────────
                    'accordion' layout enables Stripe Link's "Save my information for faster
                    checkout" promotional section, which is what you saw in the screenshot.
                    The default 'tabs' layout (used when no layout option is set) does not
                    display the Link signup section. To permanently suppress Link across all
                    layouts, go to Stripe Dashboard → Settings → Payment methods → Link and
                    disable it at the account level.

                    wallets: applePay/googlePay 'auto' shows Apple Pay / Google Pay buttons
                    automatically when the device and browser support them. This is the
                    recommended setting — showing wallet options increases conversion.
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

            {error && (
                <div className="bg-red-100 border border-red-400 rounded-xl p-4 mb-4 text-red-800 text-sm">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={!stripe || processing}
                className="w-full py-4 bg-gray-800 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-gray-100 font-bold rounded-xl text-lg transition-colors cursor-pointer"
            >
                {processing ? 'Processing payment...' : `Pay $${subtotal}`}
            </button>

            <p className="text-center text-gray-500 text-xs mt-3">
                Secured by Stripe
            </p>
        </form>
    )
}