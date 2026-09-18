// The email the owners get when someone submits the /contact form.
//
// Lives apart from contact.ts for the same reason booking-email.ts lives apart
// from db.ts: contact.ts is imported by a browser page, and only its server
// function body is stripped from the client build. Keeping the template and the
// Gmail import here means nothing server-only is reachable from the page

import { sendEmail } from './email'
import { ADMIN_RECIPIENT, escapeHtml, paragraph, section, shell, INK } from './email-template'

export type ContactMessage = {
    name: string
    email: string
    message: string
}

function buildHtml({ name, email, message }: ContactMessage): string {
    // Everything the visitor typed is escaped before it touches the HTML.
    // Otherwise a message containing "<img src=...>" or a fake link would render
    // as real markup in the inbox. Newlines are converted *after* escaping, so the
    // only <br> tags in the output are ones we added.
    const body = escapeHtml(message).replace(/\r?\n/g, '<br>')

    const bodyRows = `
    <tr><td align="center" style="padding:28px 24px 0;text-align:center">
        <h1 style="margin:0 0 16px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${INK};text-align:center">New message from ${escapeHtml(name)}</h1>
        ${paragraph('Sent from the contact form. Reply to this email to answer them directly.')}
    </td></tr>
    <tr><td style="padding:8px 24px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section('From', `${escapeHtml(name)}<br><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`)}
            ${section('Message', '')}
        </table>
        <!-- Not inside section(): that centres its text, which is fine for a
             name but hard to read for a paragraph-long message. -->
        <div style="font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${INK};text-align:left">${body}</div>
    </td></tr>`

    return shell({ bodyRows, footerNote: 'You received this because someone used the contact form on the site.' })
}

// The plain-text part. Nothing is escaped here: it's rendered as text, never
// parsed as HTML.
function buildText({ name, email, message }: ContactMessage): string {
    return [`New message from ${name} <${email}>`, '', message].join('\n')
}

/** Throws if Gmail rejects the send; the caller decides what the visitor sees. */
export async function sendContactMessage(msg: ContactMessage): Promise<void> {
    await sendEmail({
        to: ADMIN_RECIPIENT,
        // Reply goes to the visitor, not back to our own sending address.
        replyTo: msg.email,
        // Includes the name so the inbox list shows who wrote, not just "Contact form".
        subject: `Contact form: ${msg.name}`,
        html: buildHtml(msg),
        text: buildText(msg),
    })
}