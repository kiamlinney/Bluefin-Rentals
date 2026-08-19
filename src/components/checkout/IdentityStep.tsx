import { useEffect, useState } from 'react'
import { createIdentitySession, finalizeIdentitySession, getProfile } from '@/lib/db'
import type { CheckoutSearch } from '@/lib/checkout-search.ts'

export function IdentityStep({
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

            // Guard the url before using it. Using `url!` would navigate to the
            // literal string "null" when Stripe returns a session without one,
            // showing a broken page with no error. Throwing surfaces a real
            // message in the catch block instead.
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
        // intervalId is declared in the outer scope so the cleanup below can
        // reach the actual timer handle. Storing it inside the async function
        // would put it out of the cleanup's reach entirely.
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
                                setError('Verification is taking longer than expected. Please try again or contact support.')
                            }
                        }
                    } catch (e: unknown) {
                        // Never swallow these — an empty catch here is what made
                        // a failed finalize look like an indefinite wait.
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
            // Both matter: the flag stops in-flight callbacks from calling
            // setState after unmount, the clearInterval stops the timer itself.
            cancelled = true
            if (intervalId) clearInterval(intervalId)
        }
    }, [])

    if (polling) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
                <div className="text-3xl mb-4">⏳</div>
                <p className="text-gray-900 font-semibold">Confirming your verification...</p>
                <p className="text-gray-500 text-sm mt-2">This usually takes just a few seconds.</p>
            </div>
        )
    }

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-900">Verify your identity</h2>
            <p className="text-gray-500 text-sm mt-1 mb-6">
                Required once for all future bookings. You'll need your driver's license and a
                quick selfie. Powered by Stripe Identity.
            </p>

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                <div className="space-y-4">
                    {[
                        "Take a photo of your driver's license",
                        'Take a quick selfie to match your photo',
                        'Results confirmed instantly',
                    ].map((s, i) => (
                        <div key={i} className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-[#152110] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {i + 1}
                            </div>
                            <p className="text-gray-700 text-sm">{s}</p>
                        </div>
                    ))}
                </div>
            </div>

            {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

            <button
                onClick={handleStartVerification}
                disabled={loading}
                className="mt-6 w-full py-3.5 bg-[#152110] hover:bg-[#1d2f17] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors cursor-pointer"
            >
                {loading ? 'Loading...' : 'Start verification →'}
            </button>
        </div>
    )
}