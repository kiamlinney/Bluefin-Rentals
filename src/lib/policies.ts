// The legal pages and the order they appear in the /policies sidebar.
//
// One list, read by both the sidebar (src/routes/policies.tsx) and the footer,
// so adding a policy is a route file plus one line here.

export type PolicyPage = {
    /** Route path — also the file name under src/routes/policies/. */
    path: string
    /** Sidebar and footer label. */
    label: string
    /** Page heading and <title>. Same as label today; separate because a
     *  heading and a nav label don't have to stay the same thing. */
    title: string
    description: string
}

export const POLICY_PAGES: PolicyPage[] = [
    {
        path: '/policies/terms',
        label: 'Terms of service',
        title: 'Terms of service',
        description: 'The terms governing your use of BlueFin Rentals.',
    },
    {
        path: '/policies/cancellation',
        label: 'Cancellation policy',
        title: 'Cancellation policy',
        description:
            'When a BlueFin Rentals trip can be canceled, and what refund applies.',
    },
    {
        path: '/policies/privacy',
        label: 'Privacy policy',
        title: 'Privacy policy',
        description: 'What data BlueFin Rentals collects and how it is used.',
    },
]