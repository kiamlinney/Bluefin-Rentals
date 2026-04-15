import {
    createRootRouteWithContext,
    Outlet,
    HeadContent,
    Scripts
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import Navbar from "../components/Navbar.tsx";
import type { ReactNode } from "react";
import { getUser } from "../lib/auth.ts";
import '../index.css'

interface MyRouterContext {
    user: any | null
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: 'Bluefin Rentals | Local Car Renting Saint Paul' },
            { name: 'description', content: 'Rent premium vehicles in Minneapolis-Saint Paul with BlueFin Rentals. Avoid unnecessary fees.'}
        ],
    }),
    loader: async () => {
        const user = await getUser();
        return { user };
    },
    component: RootComponent,
    errorComponent: ({ error }: { error: Error }) => {
        return (
            <div className="p-10 border-red-500 border-2 bg-red-50">
                <h1 className="text-red-700 font-bold">Something went wrong!</h1>
                <pre className="text-xs mt-4 font-mono">{error.message}</pre>
                <button
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded"
                    onClick={() => window.location.reload()}
                >
                    Retry
                </button>
            </div>
        )
    },

    notFoundComponent: () => {
        return (
            <div className="min-h-screen bg-[#152110] flex items-center justify-center text-white p-4">
                <div className="text-center">
                    <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
                    <p className="text-[#a3c98a]">We couldn't find the page you're looking for.</p>
                    <a href="/" className="mt-8 inline-block px-6 py-3 bg-[#3a7d2c] text-white rounded-xl">
                        Return Home
                    </a>
                </div>
            </div>
        )
    }
})

function RootComponent() {
    const { user } = Route.useLoaderData();

    return (
        <RootDocument>
            <Navbar user={user}/>
            <Outlet />
            <TanStackRouterDevtools />
        </RootDocument>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head><HeadContent /></head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    )
}