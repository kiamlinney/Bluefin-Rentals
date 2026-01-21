import * as React from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
    return (
        <>
            {/* Anything you put HERE (like a Navbar)
          will stay on the screen as you change pages
      */}

            <Outlet />

            {/* This tool helps you debug your routes.
          It only shows up during development.
      */}
            <TanStackRouterDevtools />
        </>
    )
}