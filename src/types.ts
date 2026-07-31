import type { Database } from 'src/lib/database.types.ts'

export type Car = Database['public']['Tables']['cars']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type CarPriceOverride = Database['public']['Tables']['car_price_overrides']['Row']
export type CarBlockedDate = Database['public']['Tables']['car_blocked_dates']['Row']