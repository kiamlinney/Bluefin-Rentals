import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { cn } from '@/lib/utils'
import { seoMeta, CONTACT_EMAIL, INSTAGRAM_URL } from '@/lib/business'
import { submitContactMessage, CONTACT_LIMITS } from '@/lib/contact'

export const Route = createFileRoute('/contact')({
    head: () => ({
        meta: seoMeta({
            title: 'Contact BlueFin Rentals | Saint Paul, MN',
            description:
                'Questions about a rental, pickup, or delivery in the Twin Cities? Get in touch with BlueFin Rentals.',
            path: '/contact',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/contact') }],
    }),
    component: Contact,
})

// The root loader already fetched the signed-in user for the navbar. This reads
// that result instead of fetching it a second time.
const rootApi = getRouteApi('__root__')

function Contact() {
    return (
        <div className="max-w-6xl mx-auto px-6 py-16">
            {/* One column on phones. Two from md up, with the card getting more
                room (2fr : 3fr) */}
            <div className="grid gap-12 md:grid-cols-[2fr_3fr]">
                <div>
                    <h1 className="text-4xl md:text-5xl tracking-tight mb-4">Contact Us</h1>
                    <p className="text-lg text-muted">We will get back to you as soon as we can.</p>
                </div>
                
                <div className="grid gap-10 rounded-2xl border border-line bg-subtle p-8 sm:grid-cols-[3fr_2fr]">
                    <ContactForm />
                    
                    <div>
                        <h2 className="text-2xl mb-2">Contact</h2>
                        
                        <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-muted hover:text-ink hover:underline">
                            {CONTACT_EMAIL}
                        </a>

                        {INSTAGRAM_URL && (
                            <a
                                href={INSTAGRAM_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="BlueFin Rentals on Instagram"
                                className="mt-6 inline-block text-muted hover:text-ink"
                            >
                                <InstagramIcon />
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

type Status = 'idle' | 'sending' | 'sent' | 'error'

const fieldClass =
    'w-full border-0 border-b border-ink bg-transparent px-0 py-2 transition-colors focus:border-brand focus:outline-none'

// ── Draft saving ─────────────────────────────────────────────────────────────
// What's typed is copied to sessionStorage, so a refresh doesn't lose it.
//
// sessionStorage rather than localStorage: it survives a reload of this tab but
// is dropped when the tab closes. A half-written message shouldn't greet
// someone weeks later, or the next person on a shared computer.
//
// Every access is wrapped in try/catch because storage can throw (Safari
// private mode, blocked site data). A failure there should cost the visitor
// their draft, not the whole form.
const DRAFT_KEY = 'bluefin:contact-draft'
const DRAFT_FIELDS = ['name', 'email', 'message'] as const
type Draft = Partial<Record<(typeof DRAFT_FIELDS)[number], string>>

function saveDraft(form: HTMLFormElement) {
    const data = new FormData(form)
    const draft: Draft = {}
    for (const field of DRAFT_FIELDS) draft[field] = String(data.get(field) ?? '')
    try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
        // Storage unavailable: the form still works, just without a saved draft.
    }
}

function restoreDraft(form: HTMLFormElement) {
    let draft: Draft
    try {
        draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}')
    } catch {
        return
    }
    for (const field of DRAFT_FIELDS) {
        const value = draft[field]
        const input = form.elements.namedItem(field)
        // A saved '' is restored too. If the visitor cleared the prefilled name,
        // that's what they wanted.
        if (typeof value === 'string' && (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
            input.value = value
        }
    }
}

function clearDraft() {
    try {
        sessionStorage.removeItem(DRAFT_KEY)
    } catch {
        // Nothing to clear if storage is unavailable.
    }
}

function ContactForm() {
    const { user } = rootApi.useLoaderData()
    const [status, setStatus] = useState<Status>('idle')
    const [error, setError] = useState('')
    const formRef = useRef<HTMLFormElement>(null)

    // Restored in an effect, not by passing the draft as defaultValue. This page
    // is rendered on the server first, and the server can't see
    // sessionStorage. If the first browser render read it, the HTML wouldn't
    // match the server's and React would report a hydration mismatch. Effects
    // run only in the browser, after hydration, so writing the saved values into
    // the fields here is safe. They're uncontrolled, so setting .value directly
    // is the normal way to change them.
    useEffect(() => {
        if (formRef.current) restoreDraft(formRef.current)
    }, [])

    // onSubmit rather than React 19's <form action> + useActionState. React
    // clears a form after an action finishes, including one that failed, so a
    // visitor whose send failed would lose everything they typed. Here the form
    // is never reset. On success it's replaced by the thank-you panel below.
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        // Stops the browser doing a full-page POST to the current URL.
        e.preventDefault()
        
        const form = new FormData(e.currentTarget)

        setStatus('sending')
        setError('')
        try {
            await submitContactMessage({
                data: {
                    name: String(form.get('name') ?? ''),
                    email: String(form.get('email') ?? ''),
                    message: String(form.get('message') ?? ''),
                    website: String(form.get('website') ?? ''),
                },
            })
            // Sent, so the draft has done its job. Leaving it would bring the
            // same message back on the next visit in this tab.
            clearDraft()
            setStatus('sent')
        } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : `Something went wrong. Email us at ${CONTACT_EMAIL}.`)
        }
    }

    const sent = status === 'sent'

    return (
        // The form and the thank-you panel share one grid cell
        // (col-start-1 row-start-1), so they sit on top of each other. After
        // sending, the form turns `invisible` instead of being removed. Invisible
        // elements still take up their space, so the card keeps its height and
        // the footer doesn't jump up. `invisible` also takes the form out of the
        // tab order and away from screen readers, so nobody can reach the hidden
        // fields.
        <div className="grid">
            {sent && (
                // self-start pins the panel to the top of the cell, where it sat
                // before. role="status" makes screen readers announce it.
                <div role="status" className="col-start-1 row-start-1 self-start">
                    <h2 className="text-2xl mb-2">Thanks for reaching out!</h2>
                    <p className="text-muted">We got your message and will reply by email soon.</p>
                </div>
            )}

            <form
                ref={formRef}
                onSubmit={handleSubmit}
                // onChange bubbles up from every field to the form, so one handler
                // here saves the draft no matter which field changed.
                onChange={(e) => saveDraft(e.currentTarget)}
                className={cn('col-start-1 row-start-1 flex flex-col gap-8', sent && 'invisible')}
            >
                {/* Each label's htmlFor matches its input's id. Clicking the label
                    focuses the field, and screen readers read it as the field's name.
                    autoComplete lets browsers fill in saved details. maxLength comes
                    from the same constants the server validates against. */}
                <div>
                    <label htmlFor="contact-name" className="block text-lg">Full Name</label>
                    <input
                        id="contact-name"
                        name="name"
                        required
                        autoComplete="name"
                        maxLength={CONTACT_LIMITS.name}
                        // defaultValue, not value: it sets the starting text and
                        // leaves the field uncontrolled.
                        defaultValue={user?.full_name ?? ''}
                        className={fieldClass}
                    />
                </div>

                <div>
                    <label htmlFor="contact-email" className="block text-lg">Email</label>
                    <input
                        id="contact-email"
                        name="email"
                        // Browser checks the format, and phones show the @ keyboard.
                        type="email"
                        required
                        autoComplete="email"
                        defaultValue={user?.email ?? ''}
                        className={fieldClass}
                    />
                </div>

                <div>
                    <label htmlFor="contact-message" className="block text-lg">Message</label>
                    {/* A textarea, since messages run to several lines. rows={1} plus
                        field-sizing-content starts it as one underlined line like the
                        mockup, then grows it as the visitor types. No JS needed.
                        max-h-60 stops it growing forever, after which it scrolls. */}
                    <textarea
                        id="contact-message"
                        name="message"
                        required
                        rows={1}
                        maxLength={CONTACT_LIMITS.message}
                        className={`${fieldClass} field-sizing-content max-h-60 resize-none`}
                    />
                </div>

                {/* Honeypot. Hidden from sighted users (off-screen), from screen
                    readers (aria-hidden) and from keyboard users (tabIndex -1), so
                    only bots fill it in. It isn't display:none, because some bots
                    skip fields hidden that way. autoComplete="off" stops a browser
                    autofilling it for a real person. */}
                <div aria-hidden="true" className="absolute -left-[9999px]">
                    <label htmlFor="contact-website">Website</label>
                    <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
                </div>

                {/* role="alert" gets the error read out as soon as it appears. */}
                {status === 'error' && (
                    <p role="alert" className="text-sm font-medium text-red-600">{error}</p>
                )}

                <button
                    type="submit"
                    // Disabled while sending, so a double-click can't send twice.
                    disabled={status === 'sending'}
                    className="h-11 rounded-md bg-brand text-on-brand font-medium shadow transition-colors hover:bg-pine-800 cursor-pointer disabled:pointer-events-none disabled:opacity-50"
                >
                    {status === 'sending' ? 'Sending…' : 'Contact Us'}
                </button>
            </form>
        </div>
    )
}

// Inline SVG instead of lucide's <Instagram />: lucide has deprecated its brand
// icons and plans to remove them in v1.0, so an upgrade would break the import.
// Same outline style as lucide, so it matches the other icons on the site.
function InstagramIcon() {
    return (
        <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
    )
}