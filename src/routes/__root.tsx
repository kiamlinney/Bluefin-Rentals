import {
    createRootRouteWithContext,
    Outlet,
    HeadContent,
    Scripts,
    useLocation
} from '@tanstack/react-router'
import Navbar from "../components/Navbar.tsx";
import Footer from "../components/Footer.tsx";
import type { ReactNode } from "react";
import { getUserWithProfile } from "../lib/auth.ts";
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
        
        links: [
            { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
            { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
            { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Mona+Sans:wght@200..900&display=swap' },
        ],
    }),
    loader: async () => {
        const user = await getUserWithProfile();
        return { user };
    },
    component: RootComponent,
    errorComponent: ({ error }: { error: Error }) => {
        return (
            <div className="p-10 border-red-500 border-2 bg-red-50">
                <h1 className="text-red-700 font-bold">Something went wrong!</h1>
                <pre className="text-xs text-ink mt-4 font-mono">{error.message}</pre>
                <button
                    className="mt-4 px-4 py-2 bg-red-600 rounded-xl text-white cursor-pointer"
                    onClick={() => window.location.reload()}
                >
                    Retry
                </button>
            </div>
        )
    },

    notFoundComponent: () => {
        return (
            <div className="min-h-[calc(100svh-3.5rem)] flex items-center justify-center p-4">
                <div className="text-center">
                    <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
                    <p className="text-muted">We couldn't find the page you're looking for.</p>
                    <a href="/" className="secondary-button mt-8 inline-block font-semibold">
                        Return Home
                    </a>
                </div>
            </div>
        )
    }
})

function RootComponent() {
    const { user } = Route.useLoaderData();
    const { pathname } = useLocation();
    // Routes that supply their own chrome and must not get the site Navbar on
    // top of it. /admin has the sidebar shell; /checkout has its own header
    const isBareShell =
        pathname.startsWith("/admin") || pathname.startsWith("/checkout");

    return (
        <RootDocument>
            <div className="flex min-h-svh flex-col">
                {!isBareShell && <Navbar user={user}/>}
                <main className="flex-1">
                    <Outlet />
                </main>
                {!isBareShell && <Footer />}
            </div>
            {/* Devtools disabled to prevent potential overlay intercepting clicks */}
            {null}
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