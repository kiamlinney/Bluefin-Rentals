import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/403')({
    component: () => (
        <div className="p-6">
            <h1 className="mt-12 text-2xl font-semibold">403 — Forbidden</h1>
            <p className="text-muted-foreground">You don’t have access to this page.</p>
        </div>
    ),
})