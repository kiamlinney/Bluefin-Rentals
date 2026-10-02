import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { finishChargePayment, finishTripCardUpdate, startTripCardUpdate } from '@/lib/payments'
import { stripeAppearance, stripePromise } from '@/lib/stripe-client'
import { DEPOSIT_PLACE_BEFORE_HOURS, formatDepositAmount } from '@/lib/deposit'
import { DialogError, ModalShell, primaryButtonClass, secondaryButtonClass } from './ModalShell'

// Replacing the card on a trip — usually because the security hold was declined
// and the lockbox code is waiting on it.
//
// The card is saved with a SetupIntent (no charge), then recorded on the booking
// server-side, which also tries the hold right away if the trip is inside its
// window. That attempt is on-session, so if the bank wants the guest to
// authenticate, it happens here, in this dialog, rather than failing and waiting
// six hours for a retry.

export function CardUpdateDialog({
    bookingId,
    onClose,
    onDone,
}: {
    bookingId: string
    onClose: () => void
    onDone: (message: string) => void
}) {
    const [clientSecret, setClientSecret] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const startSetup = () =>
        startTripCardUpdate({ data: bookingId })
            .then(r => setClientSecret(r.clientSecret))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not start the card update.'))

    useEffect(() => {
        void startSetup()
    }, [bookingId])

    // The card was saved but what came after it failed — usually the hold
    // declining. That SetupIntent has already succeeded, and Stripe won't
    // confirm one twice (it surfaced as a "processing error" when a guest
    // typed a second card into the same dialog). So a new one is fetched and
    // the form remounts on it, keeping the message on screen.
    const restartAfterSave = (message: string) => {
        setError(message)
        void startSetup()
    }

    return (
        <ModalShell title="Update your card" onClose={onClose} busy={busy}>
            <p className="text-sm text-muted">
                This card will be saved to your trip and used as the terms describe: the{' '}
                {formatDepositAmount()} security hold placed about {DEPOSIT_PLACE_BEFORE_HOURS} hours
                before pickup, and any extensions, extras or other trip charges. See the{' '}
                <Link to="/policies/terms" target="_blank" className="underline text-pine-500">
                    terms of service
                </Link>.
            </p>

            <DialogError message={error} />

            {!clientSecret && !error && <p className="text-sm text-muted py-6 text-center">Preparing…</p>}

            {clientSecret && (
                // Keyed on the secret: a fresh SetupIntent needs a fresh
                // Elements instance, since Stripe.js won't re-point a mounted one.
                <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
                    <CardForm
                        bookingId={bookingId}
                        onClose={onClose}
                        onDone={onDone}
                        onBusy={setBusy}
                        onStarted={() => setError(null)}
                        onSavedButFailed={restartAfterSave}
                    />
                </Elements>
            )}
        </ModalShell>
    )
}

function CardForm({
    bookingId,
    onClose,
    onDone,
    onBusy,
    onStarted,
    onSavedButFailed,
}: {
    bookingId: string
    onClose: () => void
    onDone: (message: string) => void
    onBusy: (busy: boolean) => void
    onStarted: () => void
    onSavedButFailed: (message: string) => void
}) {
    const stripe = useStripe()
    const elements = useElements()
    const [working, setWorkingState] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const setWorking = (value: boolean) => {
        setWorkingState(value)
        onBusy(value)
    }

    const save = async () => {
        if (!stripe || !elements) return
        setWorking(true)
        setError(null)
        onStarted()
        // Once the SetupIntent succeeds it's spent; any failure after that
        // point needs a new one (see restartAfterSave).
        let saved = false
        try {
            const { error: submitError } = await elements.submit()
            if (submitError) throw new Error(submitError.message ?? 'Check your card details.')

            const { error: setupError, setupIntent } = await stripe.confirmSetup({
                elements,
                redirect: 'if_required',
                confirmParams: { return_url: `${window.location.origin}/trips/${bookingId}` },
            })
            if (setupError) throw new Error(setupError.message ?? 'Your card could not be saved.')
            if (!setupIntent) throw new Error('Your card could not be saved.')
            saved = true

            const { deposit } = await finishTripCardUpdate({ data: { bookingId, setupIntentId: setupIntent.id } })

            if (deposit.state === 'needs-action' && deposit.clientSecret && deposit.chargeId) {
                const { error: actionError } = await stripe.handleNextAction({ clientSecret: deposit.clientSecret })
                await finishChargePayment({ data: { bookingId, chargeId: deposit.chargeId } })
                if (actionError) throw new Error(`Card saved, but the hold wasn't approved: ${actionError.message}`)
                onDone('Card saved and your security hold is placed.')
                return
            }

            switch (deposit.state) {
                case 'placed':
                case 'held':
                    onDone('Card saved and your security hold is placed.')
                    return
                case 'declined':
                    throw new Error(`Card saved, but the hold was declined${deposit.message ? `: ${deposit.message}` : '.'} Try a different card.`)
                default:
                    onDone('Card saved. It will be used for this trip from now on.')
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Something went wrong.'
            setWorking(false)
            if (saved) onSavedButFailed(message)
            else setError(message)
        }
    }

    return (
        <div className="space-y-4">
            <PaymentElement options={{ wallets: { applePay: 'auto', googlePay: 'auto' } }} />
            <DialogError message={error} />
            <div className="flex gap-3 justify-end">
                <button type="button" onClick={onClose} disabled={working} className={secondaryButtonClass}>
                    Cancel
                </button>
                <button type="button" onClick={save} disabled={!stripe || working} className={primaryButtonClass}>
                    {working ? 'Saving…' : 'Save card'}
                </button>
            </div>
        </div>
    )
}