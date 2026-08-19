import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
    getCarById,
    getCarPriceOverrides,
    getProfile,
    createCheckoutSession,
    type PaymentMode,
} from '@/lib/db'
import {
    buildOverrideMap,
    calculateTripPrice,
    wallClockToUtcIso,
} from '@/lib/pricing'
import { resolvePickup, type PickupSelection } from '@/lib/pickup'
import { checkoutSearchSchema, type Step } from '@/lib/checkout-search'
import { CheckoutHeader } from '@/components/checkout/CheckoutHeader'
import { StepIndicator } from '@/components/checkout/StepIndicator'
import { TripSummaryCard } from '@/components/checkout/TripSummaryCard'
import { DriverInfoStep } from '@/components/checkout/DriverInfoStep'
import { IdentityStep } from '@/components/checkout/IdentityStep'
import { PaymentSection } from '@/components/checkout/PaymentSection'

// loadStripe is called once at module level — NOT inside a component.
// If it were inside a component, a new Stripe instance would be created
// on every render, which breaks the Elements context and causes payment
// initialization to restart repeatedly.
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// Stripe's own inputs, themed to match the rest of this page rather than
// Stripe's defaults. Defined at module level so the object identity is stable —
// passing a fresh appearance object on every render remounts the iframe.
const stripeAppearance = {
    theme: 'stripe' as const,
    variables: {
        colorPrimary: '#152110',       // brand green — focus rings, accents
        colorBackground: '#ffffff',
        colorText: '#111827',          // gray-900
        colorTextSecondary: '#6b7280', // gray-500
        colorDanger: '#b91c1c',        // red-700
        fontFamily: 'Mona Sans, ui-sans-serif, system-ui, sans-serif',
        borderRadius: '10px',
        spacingUnit: '4px',
    },
    rules: {
        '.Input': {
            border: '1px solid #d1d5db', // gray-300, same as this page's own inputs
            boxShadow: 'none',
        },
        '.Input:focus': {
            border: '1px solid #152110',
            boxShadow: 'none',
        },
    },
}

export const Route = createFileRoute('/_authed/checkout/$carId')({
    validateSearch: checkoutSearchSchema,
    loader: async ({ params }) => {
        // Promise.all fetches all three in parallel — faster than awaiting
        // sequentially. If any throws, the loader fails and TanStack Router
        // shows the errorComponent rather than rendering a broken checkout.
        //
        // priceOverrides is here so the trip summary can show a real breakdown.
        const [car, profile, priceOverrides] = await Promise.all([
            getCarById({ data: params.carId }),
            getProfile(),
            getCarPriceOverrides({ data: params.carId }),
        ])
        return { car, profile, priceOverrides }
    },
    component: CheckoutPage,
})

// ── Utility: buildDateTime ────────────────────────────────────────────────────
//
// Combines a date string (YYYY-MM-DD or full ISO) with an HH:mm time string
// into a UTC ISO string. Defined outside the component so it's created once
// at module load time, not re-created on every render.
//
// The time is resolved in the business's timezone, not the browser's. A pickup
// slot of "10:00" means 10am at the lot in Saint Paul — booking from California
// used to store that as 10am Pacific, i.e. noon Central, silently shifting the
// reservation two hours and (on late-evening slots) onto the wrong day.

const buildDateTime = (dateInput: string, time: string): string =>
    wallClockToUtcIso(dateInput.slice(0, 10), time)

// ── CheckoutPage ──────────────────────────────────────────────────────────────

function CheckoutPage() {
    const { car, profile: initialProfile, priceOverrides } = Route.useLoaderData()
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

    // Which family of payment methods the Element offers. This lives up here
    // rather than inside PaymentStep because changing it changes the
    // PaymentIntent — see createCheckoutSession — so the client secret has to be
    // fetched again and <Elements> remounted with it.
    const [paymentMode, setPaymentMode] = useState<PaymentMode>('card')

    // ── The itemised quote behind the summary card ────────────────────────────
    //
    // Rebuilt here from the same inputs the server uses, not read off the URL.
    // The pickup selection is reconstructed from the structured search params
    // and resolved through the same table src/lib/db.ts re-resolves against, and
    // calculateTripPrice is literally the function the server runs — so the
    // itemisation shown here is the arithmetic that produces the charge.
    //
    // This mirrors the car page (src/routes/fleet/$carId.tsx), which quotes the
    // same trip the same way; the two must not be allowed to drift.
    const pickupSelection = useMemo<PickupSelection>(() => {
        if (search.pickupKind === 'listed' && search.pickupId) {
            return { kind: 'listed', id: search.pickupId }
        }
        if (search.pickupKind === 'delivery' && search.pickupAddress) {
            return { kind: 'delivery', address: search.pickupAddress }
        }
        return { kind: 'home' }
    }, [search.pickupKind, search.pickupId, search.pickupAddress])

    const resolvedPickup = useMemo(() => resolvePickup(pickupSelection), [pickupSelection])

    const overrides = useMemo(() => buildOverrideMap(priceOverrides), [priceOverrides])

    const quote = useMemo(() => calculateTripPrice({
        startDate: search.startDate.slice(0, 10),
        startTime: search.startTime,
        endDate: search.endDate.slice(0, 10),
        endTime: search.endTime,
        // Postgres `numeric` can arrive as a string depending on how PostgREST
        // serializes it — Number() keeps the arithmetic from concatenating.
        basePricePerDay: Number(car.price_per_day),
        overrides,
        pickupFee: resolvedPickup.fee,
        pickupFeeLabel: resolvedPickup.feeLabel,
    }), [search.startDate, search.startTime, search.endDate, search.endTime, car.price_per_day, overrides, resolvedPickup])

    // The price the server actually charged. createCheckoutSession recomputes the
    // real total and returns it, and that's the number shown everywhere once it
    // arrives. Before then the local quote stands in — computed from the same
    // override rows the server reads, unlike search.subtotal, which is only a
    // hint travelling through an address bar the customer can edit.
    const [serverTotal, setServerTotal] = useState<number | null>(null)
    const displayTotal = serverTotal ?? quote.total

    // Prevents double-invocation from React Strict Mode. In development, React
    // deliberately calls effects twice to surface bugs; without a guard, two
    // PaymentIntents and two pending booking rows would be created. The ref
    // persists across re-renders without causing them.
    //
    // It stores the mode it ran for rather than a bare boolean, so switching
    // between Pay now and Pay over time still refetches — the same protection,
    // one notch less blunt.
    const initializedFor = useRef<PaymentMode | null>(null)

    useEffect(() => {
        if (step !== 'payment' || initializedFor.current === paymentMode) return
        initializedFor.current = paymentMode

        const init = async () => {
            setIsLoading(true)
            // Drop the previous secret first: it belongs to an intent that
            // allows the other set of methods, and leaving it mounted would show
            // the old form for as long as the request takes.
            setClientSecret(null)
            setPaymentError(null)
            try {
                const result = await createCheckoutSession({
                    data: {
                        carId,
                        startTime: buildDateTime(search.startDate, search.startTime),
                        endTime: buildDateTime(search.endDate, search.endTime),
                        // The wall-clock range is sent alongside the ISO instants
                        // because pricing is keyed by calendar date — an instant's
                        // date depends on whose timezone reads it, and the server's
                        // may not be the customer's.
                        startDateLocal: search.startDate.slice(0, 10),
                        startTimeLocal: search.startTime,
                        endDateLocal: search.endDate.slice(0, 10),
                        endTimeLocal: search.endTime,
                        totalPrice: search.subtotal,
                        pickupLocation: search.pickupLocation,
                        pickupKind: search.pickupKind,
                        pickupId: search.pickupId,
                        pickupAddress: search.pickupAddress,
                        bookingId: search.bookingId,
                        paymentMode,
                    }
                })
                setClientSecret(result.clientSecret)
                setBookingId(result.bookingId)
                setServerTotal(result.totalPrice)
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : 'Failed to initialize payment'
                setPaymentError(message)
            } finally {
                setIsLoading(false)
            }
        }
        void init()
    }, [step, paymentMode])

    return (
        // bg-white overrides the site-wide dark green on <body> (src/index.css).
        // Checkout is deliberately its own surface: no marketing chrome, nothing
        // to click off to, green demoted from background to accent.
        <div className="min-h-screen bg-white text-gray-900">
            <CheckoutHeader carId={carId} />

            <div className="max-w-6xl mx-auto px-4 py-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">

                {/* ── Left: the steps, scrolling with the page ─────────────── */}
                <div className="order-2 lg:order-1 min-w-0">
                    <StepIndicator current={step} />

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
                        <PaymentSection
                            stripePromise={stripePromise}
                            appearance={stripeAppearance}
                            isLoading={isLoading}
                            paymentError={paymentError}
                            clientSecret={clientSecret}
                            bookingId={bookingId}
                            total={displayTotal}
                            paymentMode={paymentMode}
                            onPaymentModeChange={setPaymentMode}
                        />
                    )}
                </div>

                {/* ── Right: the summary, pinned ───────────────────────────── */}
                {/* Sticky on the page's own scroll rather than an independently
                    scrolling pane: same result (summary stays, form moves under
                    it) without nesting a scroll container that fights the page
                    on touch devices. Above the form on mobile, where a pinned
                    card would eat the viewport. */}
                <aside className="order-1 lg:order-2 lg:sticky lg:top-20">
                    <TripSummaryCard
                        car={car}
                        carId={carId}
                        search={search}
                        quote={quote}
                        total={displayTotal}
                    />
                </aside>
            </div>
        </div>
    )
}