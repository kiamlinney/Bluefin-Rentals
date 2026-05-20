import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/claims')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/claims"!</div>
}
