import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { POLICY_PAGES } from '@/lib/policies.ts'

// Layout route for the legal pages, mirroring src/routes/admin.tsx: a shell
// with its own navigation and an <Outlet /> for the page itself. Unlike admin
// it's public, so it keeps the site Navbar and Footer from __root.tsx.

export const Route = createFileRoute('/policies')({
    beforeLoad: ({ location }) => {
        // A bare /policies has no content of its own — send it to terms
        if (location.pathname === '/policies' || location.pathname === '/policies/') {
            throw redirect({ to: '/policies/terms' })
        }
    },
    component: PoliciesLayout,
})

function PoliciesLayout() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-16">
            <h1 className="text-4xl md:text-5xl tracking-tight">Legal matters</h1>
            <hr className="my-8 border-line" />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 items-start">
                <div className="min-w-0">
                    <Outlet />
                </div>

                {/* Sticky on the page's own scroll — these documents are long
                    and the nav shouldn't scroll away from them. */}
                <aside className="lg:sticky lg:top-24 rounded-2xl border border-line bg-surface p-6">
                    <h2 className="text-lg font-bold mb-4">Terms and policies</h2>
                    <nav>
                        <ul className="space-y-1">
                            {POLICY_PAGES.map(({ path, label }) => (
                                <li key={path}>
                                    <Link
                                        to={path}
                                        className="block rounded-lg px-3 py-2 transition-colors"
                                        
                                        activeProps={{ className: 'bg-subtle text-ink font-medium' }}
                                        inactiveProps={{ className: 'text-muted hover:bg-subtle' }}
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </aside>
            </div>
        </div>
    )
}