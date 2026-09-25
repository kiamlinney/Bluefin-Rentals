// The empty state for a guest with no upcoming trips.
//
// Inline SVG on the palette tokens rather than an image in public/: it themes
// with the rest of the site, costs no extra request, and needs no asset
// pipeline for a drawing this simple. public/ currently holds three files and
// is better kept that way.
export function NoTripsIllustration({ className = '' }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 240 120"
            role="img"
            aria-label="An empty road"
            className={className}
        >
            {/* Ground */}
            <ellipse cx="120" cy="104" rx="92" ry="8" className="fill-cream-200" />

            {/* Road dashes, receding */}
            <g className="stroke-cream-200" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="112" x2="44" y2="112" />
                <line x1="58" y1="112" x2="84" y2="112" />
                <line x1="98" y1="112" x2="124" y2="112" />
                <line x1="138" y1="112" x2="164" y2="112" />
                <line x1="178" y1="112" x2="204" y2="112" />
            </g>

            {/* Car body */}
            <path
                d="M52 92 L58 70 Q60 63 68 63 L150 63 Q159 63 164 69 L182 88 Q186 92 186 96 L186 92 Z"
                className="fill-pine-500"
            />
            <path
                d="M58 92 L63 74 Q64 69 70 69 L148 69 Q154 69 158 74 L174 90 Z"
                className="fill-pine-500 opacity-70"
            />

            {/* Windows */}
            <path d="M74 68 L71 84 L104 84 L104 68 Z" className="fill-cream-50" />
            <path d="M110 68 L110 84 L146 84 L133 69 Q131 68 128 68 Z" className="fill-cream-50" />

            {/* Wheels */}
            <circle cx="84" cy="92" r="13" className="fill-ink-900" />
            <circle cx="84" cy="92" r="5" className="fill-cream-50" />
            <circle cx="158" cy="92" r="13" className="fill-ink-900" />
            <circle cx="158" cy="92" r="5" className="fill-cream-50" />
        </svg>
    )
}
