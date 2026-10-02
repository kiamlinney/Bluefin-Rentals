// Stripe.js in the browser: one instance, one theme, shared by every page that
// takes a card — checkout, the pay page, updating a trip's card and extending
// a trip.
import { loadStripe } from '@stripe/stripe-js'

// loadStripe is called once at module level — NOT inside a component.
// If it were inside a component, a new Stripe instance would be created
// on every render, which breaks the Elements context and causes payment
// initialization to restart repeatedly.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// Stripe's own inputs, themed to match the rest of the site rather than
// Stripe's defaults. Defined at module level so the object identity is stable —
// passing a fresh appearance object on every render remounts the iframe.
//
// Stripe renders in an iframe and takes literal colours, so these can't use the
// Tailwind tokens. Each is copied from the palette in src/index.css — keep them
// in step if that palette changes.
export const stripeAppearance = {
    theme: 'stripe' as const,
    variables: {
        colorPrimary: '#152110',       // pine-900 / brand — focus rings, accents
        colorBackground: '#ffffff',    // surface
        colorText: '#1f2a1c',          // ink-900 / ink
        colorTextSecondary: '#5d6558', // ink-600 / muted
        colorDanger: '#b91c1c',        // red-700
        fontFamily: 'Mona Sans, ui-sans-serif, system-ui, sans-serif',
        borderRadius: '10px',
        spacingUnit: '4px',
    },
    rules: {
        '.Input': {
            border: '1px solid #dcd7ca', // cream-300 / line, same as the site's own inputs
            boxShadow: 'none',
        },
        '.Input:focus': {
            border: '1px solid #152110',
            boxShadow: 'none',
        },
    },
}