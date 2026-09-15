import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'

export const Route = createFileRoute('/policies/privacy')({
    head: () => ({
        meta: seoMeta({
            title: 'Privacy policy | BlueFin Rentals',
            description: 'What data BlueFin Rentals collects and how it is used.',
            path: '/policies/privacy',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/policies/privacy') }],
    }),
    component: PrivacyPolicy,
})

function PrivacyPolicy() {
    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Privacy policy</h2>
            <p className="text-sm text-muted mb-8">Last revised: —</p>
        </article>
    )
}