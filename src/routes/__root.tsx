import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import Navbar from "../components/Navbar.tsx";

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
    return (
        <>
            {/* Anything you put HERE (like a Navbar)
             will stay on the screen as you change pages */}
            <Navbar />

            <Outlet />

            {/* This tool helps you debug your routes.
             It only shows up during development.*/}
            <TanStackRouterDevtools />
        </>
    )
}

/*
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

const RootLayout = () => (
  <>
    <div className="p-2 flex gap-2">
      <Link to="/" className="[&.active]:font-bold">
        Home
      </Link>{' '}
      <Link to="/about" className="[&.active]:font-bold">
        About
      </Link>
    </div>
    <hr />
    <Outlet />
    <TanStackRouterDevtools />
  </>
)

export const Route = createRootRoute({ component: RootLayout })
 */