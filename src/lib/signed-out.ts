// For loaders of pages behind sign-in (the `_authed` routes).
//
// A signed-out visitor to one of those pages still runs its loader: `_authed`
// renders the sign-in form in place of the page, but TanStack loads the child
// route's data anyway. Every server function those loaders call throws without
// a session, so the page answered HTTP 500 — showing the right form, but logging
// an error on the server for every guest who opened an email link while signed
// out (found 2026-10-08). Each loader now returns SIGNED_OUT first instead.
//
// The page never sees this value: it isn't rendered while signed out, and
// signing in invalidates the router, which re-runs the loader with a session.
// Typed `never` so it doesn't widen what useLoaderData() returns.
//
//   loader: async ({ params, context }) => {
//       if (!context.isLoggedIn) return SIGNED_OUT
//       ...
//   }

export const SIGNED_OUT = null as never
