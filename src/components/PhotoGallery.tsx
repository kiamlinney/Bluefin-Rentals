// The car page's full-screen photo gallery: a grid of every photo, and a
// lightbox for one photo at a time with previous/next navigation.
//
// Escape backs out one layer at a time — lightbox to grid, grid to the car
// page — so it always leaves whatever is on top rather than doing nothing.
//
// Rendered as an overlay on top of the car page rather than in place of it, so
// closing the gallery returns the customer to the same scroll position instead
// of the top of a freshly mounted page.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

// A horizontal swipe shorter than this is treated as a tap, not a swipe.
const SWIPE_THRESHOLD_PX = 50

export function PhotoGallery({
    title,
    images,
    onClose,
}: {
    title: string
    /** Full image URLs, in display order. */
    images: string[]
    onClose: () => void
}) {
    // Index of the photo open in the lightbox, or null for the grid.
    const [active, setActive] = useState<number | null>(null)

    const count = images.length
    const step = useCallback(
        (delta: number) => setActive(i => (i === null ? i : (i + delta + count) % count)),
        [count],
    )

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                if (active !== null) setActive(null)
                else onClose()
            } else if (active !== null && e.key === 'ArrowLeft') {
                step(-1)
            } else if (active !== null && e.key === 'ArrowRight') {
                step(1)
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [active, onClose, step])

    // The overlay scrolls on its own; the page underneath must not.
    useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previous
        }
    }, [])

    const touchStartX = useRef<number | null>(null)

    return (
        <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-page">
            <div className="sticky top-0 bg-page py-3 px-4 lg:py-4 lg:px-8 flex justify-between items-center border-b border-line z-10">
                <h2 className="text-lg lg:text-xl font-bold">{title}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close gallery"
                    className="p-2 hover:bg-subtle rounded-full transition-colors cursor-pointer"
                >
                    <X size={24} />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 mx-auto p-4 gap-4 lg:gap-8">
                {images.map((src, index) => (
                    <button
                        key={src}
                        type="button"
                        onClick={() => setActive(index)}
                        aria-label={`Open photo ${index + 1} of ${count}`}
                        className="w-full rounded-xl overflow-hidden bg-subtle shadow-sm cursor-zoom-in"
                    >
                        {/* 5:3 is the photos' own shape (1242×745), so the
                            grid shows each one whole. */}
                        <img
                            src={src}
                            className="w-full h-full object-cover aspect-[5/3]"
                            alt={`${title} - gallery image ${index + 1}`}
                            loading={index < 2 ? 'eager' : 'lazy'}
                            decoding="async"
                        />
                    </button>
                ))}
            </div>

            {active !== null && (
                // A tap on the dark surround closes the lightbox; taps on the
                // photo and the controls stop here instead.
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Photo ${active + 1} of ${count}`}
                    className="fixed inset-0 z-20 flex items-center justify-center bg-black select-none"
                    onClick={() => setActive(null)}
                    onTouchStart={e => {
                        touchStartX.current = e.touches[0]?.clientX ?? null
                    }}
                    onTouchEnd={e => {
                        const start = touchStartX.current
                        touchStartX.current = null
                        const end = e.changedTouches[0]?.clientX
                        if (start === null || end === undefined) return
                        const dx = end - start
                        if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) step(dx < 0 ? 1 : -1)
                    }}
                >
                    <img
                        src={images[active]}
                        alt={`${title} - gallery image ${active + 1}`}
                        className="max-h-[85svh] max-w-full lg:max-w-[85vw] object-contain"
                        onClick={e => e.stopPropagation()}
                    />

                    <div className="absolute top-3 left-4 text-sm font-medium text-white/80">
                        {active + 1} / {count}
                    </div>

                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation()
                            setActive(null)
                        }}
                        aria-label="Close photo"
                        className="absolute top-2 right-2 p-2 rounded-full text-white hover:bg-white/10 cursor-pointer"
                    >
                        <X size={26} />
                    </button>

                    {count > 1 && (
                        <>
                            <button
                                type="button"
                                onClick={e => {
                                    e.stopPropagation()
                                    step(-1)
                                }}
                                aria-label="Previous photo"
                                className="absolute left-2 lg:left-6 top-1/2 -translate-y-1/2 p-2 lg:p-3 rounded-full bg-white/15 text-white hover:bg-white/25 cursor-pointer"
                            >
                                <ChevronLeft size={28} />
                            </button>
                            <button
                                type="button"
                                onClick={e => {
                                    e.stopPropagation()
                                    step(1)
                                }}
                                aria-label="Next photo"
                                className="absolute right-2 lg:right-6 top-1/2 -translate-y-1/2 p-2 lg:p-3 rounded-full bg-white/15 text-white hover:bg-white/25 cursor-pointer"
                            >
                                <ChevronRight size={28} />
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
