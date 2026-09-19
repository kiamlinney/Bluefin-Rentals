import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { absoluteUrl } from '@/lib/site'
import { carSlug } from '@/lib/slug'
import { POLICY_PAGES } from '@/lib/policies'

// This page is like the table of contents, its job is discovery

type SitemapEntry = { path: string; lastmod?: string | null; changefreq: string; priority: string }

const STATIC_PAGES: SitemapEntry[] = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/fleet', changefreq: 'daily', priority: '0.9' },
    { path: '/reviews', changefreq: 'weekly', priority: '0.7' },
    { path: '/faq', changefreq: 'monthly', priority: '0.6' },
    { path: '/about', changefreq: 'monthly', priority: '0.5' },
    { path: '/contact', changefreq: 'monthly', priority: '0.5' },
    // Legal pages: indexable but low priority — they exist to be found when
    // looked for, not to rank.
    ...POLICY_PAGES.map(({ path }) => ({
        path,
        changefreq: 'yearly',
        priority: '0.3',
    })),
]

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function urlEntry({ path, lastmod, changefreq, priority }: SitemapEntry): string {
    return [
        '  <url>',
        `    <loc>${xmlEscape(absoluteUrl(path))}</loc>`,
        lastmod ? `    <lastmod>${xmlEscape(lastmod.slice(0, 10))}</lastmod>` : null,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
    ]
        .filter(Boolean)
        .join('\n')
}

export const Route = createFileRoute('/sitemap.xml')({
    server: {
        handlers: {
            GET: async () => {
                const supabase = createClient(
                    process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL,
                    import.meta.env.VITE_SUPABASE_ANON_KEY,
                )

                // Anon key on purpose: the sitemap must only ever contain pages a
                // logged-out visitor can open, which is exactly what RLS allows here.
                const { data: cars, error } = await supabase
                    .from('cars')
                    .select('id, year, make, model, updated_at, is_available')
                    .order('id')

                if (error) {
                    console.error('sitemap: failed to load cars', error.message)
                    return new Response('Sitemap unavailable', { status: 500 })
                }

                const carEntries: SitemapEntry[] = (cars ?? [])
                    .filter((car) => car.is_available !== false)
                    .map((car) => ({
                        path: `/fleet/${carSlug(car)}`,
                        lastmod: car.updated_at,
                        changefreq: 'weekly',
                        priority: '0.8',
                    }))

                const body = [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                    ...[...STATIC_PAGES, ...carEntries].map(urlEntry),
                    '</urlset>',
                    '',
                ].join('\n')

                return new Response(body, {
                    headers: {
                        'content-type': 'application/xml; charset=utf-8',
                        'cache-control': 'public, max-age=3600',
                    },
                })
            },
        },
    },
})