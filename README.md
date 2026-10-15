# [_rentbluefin.com_](https://rentbluefin.com/), a custom car rental platform for Bluefin Rentals LLC
- Migrated business operations from Turo to a self-hosted solution.
- Architected the full-stack SSR platform with **React 19**, **TypeScript**, **TanStack Start**, and **Tailwind CSS**, deployed on **Railway**, with parallelized route data loading for fast, search-indexable pages. and strong search visibility.                                           
- Custom-built booking system, eliminating Turo's 40% commission on every trip and giving the business full control over pricing, policy, and customer relationships.
- Integrated Stripe end to end: Payment Intents for multi-step checkout, signature-verified webhooks for payment confirmation, and Stripe Identity for automated driver's license verification, with idempotency safeguards against duplicate bookings and charges.
- Built a secure **Supabase/Postgres** backend with Row-Level Security, privilege-separated service clients, and scheduled pg_cron jobs, keeping booking, profile, and payment state consistent.
- Designed availability, pricing, and refund logic as shared server-authoritative modules, so the booking calendar, quoted price, and final charge always agree, eliminating mismatches between what customers see and what they're charged.
- Engineered a time-limited checkout hold system that reserves a car while the guest pays and releases it automatically, restricting payment methods to those that settle within the hold and recovering late payments so no guest is ever charged without a booking,
- Automated booking notifications and legacy reservation syncing through an OAuth **Gmail API** integration, parsing Turo confirmation emails into an admin calendar during the migration.
