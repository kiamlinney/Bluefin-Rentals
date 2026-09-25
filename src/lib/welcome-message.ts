// The message a guest gets when their trip is booked.
//
// Pure and isomorphic on purpose: it's sent as an email from the server and
// shown read-only on the trip page in the browser, and those two have to say
// exactly the same thing. A guest who reads the page and the email side by side
// and finds different pickup instructions has no way to know which is right.

export const WELCOME_SIGNOFF = 'Best, Nick and Jed with Bluefin Rentals.'

export type WelcomeMessage = {
    paragraphs: string[]
    signoff: string
}

export function buildWelcomeMessage({
    guestFirstName,
    lockboxCode,
}: {
    guestFirstName: string
    /**
     * The car's current lockbox code, or null when none is on file.
     *
     * Null drops the code sentences entirely rather than printing a gap or the
     * word "null". A guest who gets the rest of the message and a phone call is
     * fine; a guest told the code is "null" thinks the system is broken.
     */
    lockboxCode: string | null
}): WelcomeMessage {
    const paragraphs = [
        `Thank you for booking with us${guestFirstName ? ` ${guestFirstName}` : ''}.`,
        'We look forward to hosting your upcoming trip!',
        'For pick up, the vehicle will be parked on the street near the pick up address.',
    ]

    if (lockboxCode) {
        paragraphs.push(
            'Once you arrive, unlock the vehicle by entering the 4 digit code into the lock box mounted on the driver side window.',
            `The code to enter is (${lockboxCode})`,
            'Please put the lock box somewhere safe for the duration of your trip.',
        )
    } else {
        // Still tells them where the key is and that a code is coming, so the
        // message stands on its own instead of silently omitting the whole
        // arrival step.
        paragraphs.push(
            'Once you arrive, the vehicle unlocks from the lock box mounted on the driver side window. We will send you the code before your trip starts.',
            'Please put the lock box somewhere safe for the duration of your trip.',
        )
    }

    paragraphs.push(
        "From here, you can complete the check in process and you're good to go!",
        'Feel free to reach out with any further questions.',
    )

    return { paragraphs, signoff: WELCOME_SIGNOFF }
}

/** The message as plain text, for the email's text/plain alternative. */
export function welcomeMessageText(message: WelcomeMessage): string {
    return [...message.paragraphs, '', message.signoff].join('\n')
}
