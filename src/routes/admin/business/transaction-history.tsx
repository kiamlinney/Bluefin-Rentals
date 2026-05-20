import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/transaction-history')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/transaction-history"!</div>
}
