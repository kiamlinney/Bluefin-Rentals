import { buildWelcomeMessage } from '@/lib/welcome-message.ts'
import { formatBusinessDate } from '@/lib/dates.ts'
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_PHONE_HREF } from '@/lib/business.ts'
import { TripSection } from './TripSection'

// The welcome message, shown read-only on the trip page.
//
// Built from the same buildWelcomeMessage the email uses, so a guest reading
// the page and the email side by side sees identical instructions. The lockbox
// code comes from the server fresh on every load, which means a rotated code is
// right here even when the emailed one has gone stale.
//
// No compose box: messaging through the site isn't a feature yet, and an input
// that silently goes nowhere is worse than no input. The footer says how to
// actually reach a human.

const SENT_FORMAT = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } as const

export function TripMessages({
    guestFirstName,
    lockboxCode,
    sentAt,
}: {
    guestFirstName: string
    lockboxCode: string | null
    /** When the trip was booked — the message went out with the confirmation. */
    sentAt: string
}) {
    const message = buildWelcomeMessage({ guestFirstName, lockboxCode })

    return (
        <TripSection title="Messages">
            <p className="text-center text-xs font-bold uppercase tracking-wider text-muted py-1">
                {formatBusinessDate(sentAt, SENT_FORMAT)}
            </p>

            <div className="border border-line rounded-xl p-4 bg-subtle">
                {message.paragraphs.map((line, i) => (
                    <p key={i} className="text-ink leading-relaxed">
                        {line}
                    </p>
                ))}
                <p className="text-ink leading-relaxed mt-3">{message.signoff}</p>
            </div>

            {/* Both from BUSINESS constants — see src/lib/business.ts. Typing a
                phone number into a page is how one of them ends up stale. */}
            <p className="text-sm text-muted">
                Need something else?{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-pine-500 hover:underline">
                    Email us
                </a>{' '}
                or call{' '}
                <a href={CONTACT_PHONE_HREF} className="text-pine-500 hover:underline">
                    {CONTACT_PHONE}
                </a>
                .
            </p>
        </TripSection>
    )
}
