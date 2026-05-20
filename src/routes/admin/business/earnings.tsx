import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/earnings')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/earnings"!</div>
}
