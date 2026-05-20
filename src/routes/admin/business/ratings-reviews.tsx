import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/business/ratings-reviews')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/business/ratings-reviews"!</div>
}
