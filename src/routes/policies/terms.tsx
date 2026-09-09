import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'

export const Route = createFileRoute('/policies/terms')({
    head: () => ({
        meta: seoMeta({
            title: 'Terms of service | BlueFin Rentals',
            description: 'The terms governing your use of BlueFin Rentals.',
            path: '/policies/terms',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/policies/terms') }],
    }),
    component: TermsOfService,
})

function TermsOfService() {
    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Terms of service</h2>
            <p className="text-sm text-gray-400 mb-8">Last revised: —</p>
        </article>
    )
}