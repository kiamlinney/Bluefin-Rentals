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
            { title: 'Bluefin Rentals' },
        ],
    }),
    loader: async () => {
        const user = await getUser();
        return { user };
    },
    component: RootComponent,
})

function RootComponent() {
    const { user } = Route.useLoaderData();

    return (
        <RootDocument>
            <Navbar user={{user}}/>
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