import { createFileRoute, redirect } from '@tanstack/react-router'

// The old address of an admin's view of a renter. It's the customer page in the
// CRM now; this keeps old links and bookmarks working.
export const Route = createFileRoute('/admin/user/$userId')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/admin/customers/$userId', params: { userId: params.userId } })
    },
})
