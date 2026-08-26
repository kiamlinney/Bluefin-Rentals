import { useEffect, useState } from 'react'
import { createIdentitySession, finalizeIdentitySession, getProfile } from '@/lib/db'

// Client-side half of the Stripe Identity flow: send the user to Stripe, then
// pick the result back up when they return.
//
// This started life inside src/components/checkout/IdentityStep.tsx and is
// reproduced here because the profile page needs the same two steps with a
// different return URL. IdentityStep still has its own copy — its polling is
// wired into the checkout step machine, so folding it onto this is a separate
// change. If you fix a bug in one, fix it in the other.

// How long to keep asking Stripe for a result before giving up. The webhook
// usually lands first; this is the fallback for when it doesn't.
const POLL_INTERVAL_MS = 2000
const MAX_ATTEMPTS = 20 // 40 seconds

// Marks a URL as "the user is coming back from Stripe". useIdentityReturn only
// does anything when it's present, so a normal page load costs nothing.
export const VERIFICATION_RETURN_PARAM = 'verificationReturn'

// Starts (or resumes) a verification session and redirects to Stripe's hosted
// flow. Never returns normally on success — the page navigates away.
export async function startIdentityVerification(returnUrl: string): Promise<void> {
    const result = await createIdentitySession({ data: { returnUrl } })

    // Guard the url before using it. Using `url!` would navigate to the literal
    // string "null" when Stripe returns a session without one, showing a broken
    // page with no error. Throwing surfaces a real message to the caller.
    if (!result.url) throw new Error('Verification session URL was not returned')
    window.location.href = result.url
}

// Runs on mount. When the URL carries ?verificationReturn=true, resolves whether
// the scan passed and calls onVerified once it has. Returns the UI state so the
// page can show a spinner or an error.
export function useIdentityReturn(onVerified: () => void): {
    polling: boolean
    error: string | null
} {
    const [polling, setPolling] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get(VERIFICATION_RETURN_PARAM) !== 'true') return

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

                // Fast path: the webhook already confirmed verification.
                if (profile?.identity_verified) {
                    if (!cancelled) {
                        setPolling(false)
                        onVerified()
                    }
                    return
                }

                const sessionId = profile?.stripe_identity_session_id
                if (!sessionId) throw new Error('Verification session not found. Please try again.')

                let attempts = 0

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
                                onVerified()
                            }
                        } else if (attempts >= MAX_ATTEMPTS) {
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
                }, POLL_INTERVAL_MS)

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

    return { polling, error }
}