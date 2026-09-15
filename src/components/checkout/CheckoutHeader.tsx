import { useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

// The checkout's own header bar. The site Navbar is suppressed on /checkout
// (see src/routes/__root.tsx) so this is the only chrome on the page — the
// point being that once someone is entering card details there is nowhere
// else to click off to.
export function CheckoutHeader({ carId }: { carId: string }) {
    const router = useRouter()
    const navigate = useNavigate()

    const handleBack = () => {
        // history.back() rather than a plain navigate: the car page holds the
        // customer's dates, times and pickup choice in its own search params,
        // and going back through history restores all of it. Navigating to the
        // route fresh would drop them back on an empty picker.
        //
        // The length check covers arriving here directly — a bookmarked or
        // pasted checkout link has no history entry to return to.
        if (window.history.length > 1) {
            router.history.back()
        } else {
            // Only the id is on hand here; the route redirects to the slug.
            void navigate({ to: '/fleet/$carSlug', params: { carSlug: carId } })
        }
    }

    return (
        <header className="sticky top-0 z-50 h-16 bg-surface border-b border-line">
            <div className="relative h-full max-w-6xl mx-auto px-4 flex items-center">
                <button
                    type="button"
                    onClick={handleBack}
                    aria-label="Back"
                    className="p-2 -ml-2 rounded-full text-ink hover:bg-subtle transition-colors cursor-pointer"
                >
                    <ArrowLeft size={20} />
                </button>
                {/* Absolutely positioned so the title is centred on the page,
                    not on the space left over beside the back button. */}
                <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-bold text-ink">
                    Checkout
                </h1>
            </div>
        </header>
    )
}