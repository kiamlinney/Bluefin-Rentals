import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/tax-information')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/tax-information"!</div>
}
