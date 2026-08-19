import { Check } from 'lucide-react'
import type { Step } from '@/lib/checkout-search.ts'

const STEPS: { id: Step; label: string }[] = [
    { id: 'driver-info', label: 'Your info' },
    { id: 'identity', label: 'Verify ID' },
    { id: 'payment', label: 'Payment' },
]

export function StepIndicator({ current }: { current: Step }) {
    const currentIndex = STEPS.findIndex(s => s.id === current)

    return (
        // Pinned directly beneath the 4rem-tall CheckoutHeader so the customer
        // can always see which of the three steps they're on. Opaque background
        // and a negative inline margin so the form scrolling underneath passes
        // behind it edge to edge rather than beside it.
        <div className="sticky top-16 z-30 bg-white -mx-4 px-4 py-4 mb-4 flex items-center gap-2">
            {STEPS.map((step, i) => {
                const isActive = i === currentIndex
                const isCompleted = i < currentIndex

                return (
                    <div key={step.id} className="flex items-center gap-2">
                        <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                isActive
                                    ? 'bg-[#152110] text-white'
                                    : isCompleted
                                        ? 'bg-[#3a7d2c] text-white'
                                        : 'bg-gray-200 text-gray-500'
                            }`}
                        >
                            {isCompleted ? <Check size={14} strokeWidth={3} /> : i + 1}
                        </div>
                        <span
                            className={`text-xs hidden sm:block ${
                                isActive ? 'font-semibold text-gray-900' : 'text-gray-500'
                            }`}
                        >
                            {step.label}
                        </span>
                        {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-200" />}
                    </div>
                )
            })}
        </div>
    )
}