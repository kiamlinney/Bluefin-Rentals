import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/profile')({
    component: ProfilePage,
})

function ProfilePage() {
    return (
        <div className="p-16 text-center">
            <h1 className="text-3xl font-bold">Your Private Profile</h1>
            <p className="mt-4">Only logged-in users can see this</p>
        </div>
    )
}