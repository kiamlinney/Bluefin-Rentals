import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/performance')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/performance"!</div>
}
