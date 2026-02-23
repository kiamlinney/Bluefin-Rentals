import {
    createRootRoute,
    Outlet,
    ScrollRestoration,
    HeadContent, // This replaces <Meta />
    Scripts      // This remains, but check its import source
} from '@tanstack/react-router' // Note: These often come from react-router now
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import Navbar from "../components/Navbar.tsx";
import type { ReactNode } from "react";
import '../index.css'

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: 'Bluefin Rentals | Premium Car Sharing' },
        ],
    }),
    component: RootComponent,
})

function RootComponent() {
    return (
        <RootDocument>
            <Navbar />
            <Outlet />
            <TanStackRouterDevtools />
        </RootDocument>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
        <head>
            <HeadContent /> {/* Replaces Meta */}
        </head>
        <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        </body>
        </html>
    )
}