import { CalendarDays, Car, CarFront, LineChart, Users } from 'lucide-react'

export type AdminNavItem = {
    label: string
    path?: string
    icon?: React.ComponentType<{ size?: number; className?: string }>
    children?: {
        label: string
        path: string
        icon?: React.ComponentType<{ size?: number; className?: string }>
    }[]
}

export const adminNav: AdminNavItem[] = [
    { label: 'Calendar', path: '/admin/calendar', icon: CalendarDays },
    {
        label: 'Trips',
        icon: Car,
        children: [
            { label: 'Booked', path: '/admin/trips/booked'},
            { label: 'History', path: '/admin/trips/history'},
        ],
    },
    {
        label: 'Vehicles',
        icon: CarFront,
        children: [
            { label: 'All vehicles', path: '/admin/vehicles'},
            { label: 'Pricing', path: '/admin/pricing'},
        ],
    },
    { label: 'Customers', path: '/admin/customers', icon: Users },
    {
        label: 'Business',
        icon: LineChart,
        children: [
           // { label: 'Earnings', path: '/admin/business/earnings'},
            { label: 'Ratings & reviews', path: '/admin/business/ratings-reviews'},
            { label: 'Tax information', path: '/admin/business/tax-information'},
           // { label: 'Transaction History', path: '/admin/business/transaction-history'},
        ],
    },
]