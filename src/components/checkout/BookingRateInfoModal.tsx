import { useEffect } from 'react'
import { CircleCheck, CircleX, X } from 'lucide-react'
import { FREE_CANCELLATION_HOURS } from '@/lib/booking-rate.ts'

// Explains the non-refundable terms. Same modal mechanics as
// src/components/PriceBreakdown.tsx — fixed backdrop, clicks inside stopped
// from reaching it, Escape to close.
//
// Only the non-refundable option offers this; refundable states its one rule
// ("cancel free until X") inline, and a modal to repeat it would be noise.

function Rule({
    when,
    verdict,
    points,
}: {
    when: string
    verdict: string
    points: { ok: boolean; text: string }[]
}) {
    return (
        <div className="grid grid-cols-[9rem_1fr] gap-4 p-4">
            <div>
                <p className="font-bold text-gray-900 text-sm">{when.split('\n')[0]}</p>
                <p className="text-sm text-gray-500">{when.split('\n')[1]}</p>
            </div>
            <div>
                <p className="font-bold text-gray-900 text-sm">{verdict}</p>
                <ul className="mt-2 space-y-1.5">
                    {points.map(({ ok, text }) => (
                        <li key={text} className="flex items-start gap-2 text-sm text-gray-700">
                            {ok ? (
                                <CircleCheck size={16} className="text-[#3a7d2c] flex-shrink-0 mt-0.5" />
                            ) : (
                                <CircleX size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                            )}
                            <span>{text}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

export function BookingRateInfoModal({ onClose }: { onClose: () => void }) {
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose])

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-white text-black rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="booking-rate-info-title"
            >
                <div className="flex justify-end px-4 pt-4">
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="p-1.5 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                        <X size={20} className="text-gray-600" />
                    </button>
                </div>

                <div className="px-6 pb-6 overflow-y-auto">
                    <h2 id="booking-rate-info-title" className="text-2xl font-bold text-gray-900">
                        Non-refundable trips
                    </h2>

                    <p className="mt-4 text-gray-700 leading-relaxed">
                        Non-refundable trips can't be canceled or changed for a refund after{' '}
                        {FREE_CANCELLATION_HOURS} hours of booking — or {FREE_CANCELLATION_HOURS}{' '}
                        hours before pickup, whichever comes first — except in rare cases under our
                        extenuating circumstances policy.
                    </p>

                    {/* Opens in a new tab rather than a <Link>: the point is to
                        read the policy without unmounting a checkout that may
                        already hold a PaymentIntent. */}
                    <a
                        href="/policies/cancellation"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-4 text-[#2a4a1e] font-medium underline hover:no-underline"
                    >
                        Cancellation policy
                    </a>

                    <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 divide-y divide-gray-200">
                        {/* "or before pickup" carries the cap: the free window
                            closes at whichever comes first, so on a trip booked
                            close to its start it can be much shorter than 24h.
                            See effectiveFreeCancellationDeadline. */}
                        <Rule
                            when={`Within\n${FREE_CANCELLATION_HOURS} hours of booking`}
                            verdict="Full refund"
                            points={[
                                { ok: true, text: 'Cancel for a full refund' },
                                { ok: true, text: 'Trip changes allowed' },
                            ]}
                        />
                        <Rule
                            when={`After that,\nor near pickup`}
                            verdict="No refund"
                            points={[
                                { ok: false, text: 'Trip is fully non-refundable' },
                                { ok: true, text: 'Trip changes allowed, without refund' },
                            ]}
                        />
                    </div>

                    <p className="mt-5 text-gray-700">
                        You can extend your trip anytime, subject to availability.
                    </p>
                </div>

                <div className="border-t border-gray-200 px-6 py-4 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-lg bg-[#152110] text-white font-semibold hover:bg-[#1f3018] transition-colors cursor-pointer"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}