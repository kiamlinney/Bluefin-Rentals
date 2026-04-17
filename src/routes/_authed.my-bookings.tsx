import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/my-bookings')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authed/my-bookings"!</div>
}
