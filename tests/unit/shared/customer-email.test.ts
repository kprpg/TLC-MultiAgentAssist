import { describe, expect, it } from 'vitest'
import { customerEmailCopyText, customerEmailHasPlaceholders, extractCustomerEmail, locateCustomerEmail } from '../../../apps/shared/customer-email.js'
import { formatResponseMarkdown } from '../../../apps/shared/response-markdown.js'

const body = 'Dear customer,\n\nPlease confirm the **approval sequence** [O.C1].\n\nRegards,\nAccount team'

describe('customer email extraction', () => {
    it.each(['Subject: Confirming next steps', '**Subject:** Confirming next steps', '**Subject: Confirming next steps**'])('extracts a subject and customer body from %s', (subject) => {
        const draft = extractCustomerEmail(`1. Customer-ready draft\n\n${subject}\n\n${body}\n\n2. Assumptions and missing information\n\nInternal review is required.\n\n3. Feedback prompt\n\nWould you like an executive brief?`)
        expect(draft).toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it('handles heading-free email drafts and an optional Body label', () => {
        expect(extractCustomerEmail(`Subject: Confirming next steps\r\n\r\nBody:\r\n\r\n${body}`))
            .toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it('finds the subject among grouped email headers without using generated recipients', () => {
        expect(extractCustomerEmail(`## Draft email response to customer\n\n**To:** Customer <customer@example.com>\n**Subject:** Confirming next steps\n\n**Body**:\n\n${body}\n\n## Feedback prompt\n\nWould you like a brief?`))
            .toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it('accepts an explicit Subject heading and preserves the body after it', () => {
        expect(extractCustomerEmail(`## Customer-ready draft\n\n### Subject: Confirming next steps\n\n${body}`))
            .toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it.each([
        `Subject: Confirming next steps\n\n${body}`,
        `> **Subject:** Confirming next steps\n>\n${body.split('\n').map((line) => `> ${line}`).join('\n')}`
    ])('recognizes an explicitly requested email follow-up under a generic heading: %s', (draft) => {
        const content = `## Follow-up for the sponsor\n\n${draft}\n\n## Sources\n\nInternal source overview.`
        expect(extractCustomerEmail(content)).toBeUndefined()
        expect(locateCustomerEmail(content, true)?.draft).toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it('recognizes an internal follow-up note within the customer-ready draft section', () => {
        expect(extractCustomerEmail(`## Customer-ready draft requiring human review\n\nRequires human review.\n\n## Internal follow-up note for the account owner\n\nSubject: Confirming next steps\n\n${body}\n\n## Sources\n\nInternal source overview.`))
            .toEqual({ subject: 'Confirming next steps', markdown: body })
    })

    it.each([
        `## Sources\n\nSubject: Evidence field\n\n${body}`,
        `## Feedback prompt\n\nSubject: Suggested subject\n\n${body}`,
        '## Follow-up for the sponsor\n\n```text\nSubject: Code sample\n\nCode body.\n```',
        '## Follow-up for the sponsor\n\nSubject: No body'
    ])('does not use internal sections, code, or empty bodies as a requested email: %s', (content) => {
        expect(locateCustomerEmail(content, true)).toBeUndefined()
    })

    it('keeps customer-facing caveats and evidence in the email rather than inventing certainty', () => {
        const markdown = `${body}\n\nThe approval is not yet confirmed; please review [source](https://example.com/evidence).`
        const draft = extractCustomerEmail(`## Draft e-mail response to customer\n\n**Subject:** Confirming next steps\n\n${markdown}\n\n### Internal reviewer notes\n\nDo not share this note.`)
        expect(draft).toEqual({ subject: 'Confirming next steps', markdown })
    })

    it('retains nested email headings and tables but stops at the next response section', () => {
        const markdown = `${body}\n\n### Next meeting\n\n| Owner | Action |\n| --- | --- |\n| SE | Confirm scope |`
        expect(extractCustomerEmail(`## Customer-ready draft\n\nSubject: Confirming next steps\n\n${markdown}\n\n## Sources\n\nInternal source overview.`))
            .toEqual({ subject: 'Confirming next steps', markdown })
    })

    it('copies plain email text with its subject but no Markdown markup or later agent offers', () => {
        const draft = extractCustomerEmail(`## Customer-ready draft\n\nSubject: Confirming next steps\n\n${body}\n\n## Feedback prompt\n\nWould you like an executive brief?`)
        if (!draft) throw new Error('The email fixture must be recognized.')
        expect(customerEmailCopyText(draft)).toBe('Subject: Confirming next steps\n\nDear customer,\n\nPlease confirm the approval sequence [O.C1].\n\nRegards,\nAccount team')
    })

    it.each([
        '## Summary\n\nThe email has not been drafted.\n\n## Feedback prompt\n\nWould you like me to draft an email?',
        '## Summary\n\nSubject: An internal field value\n\nNot an email draft.',
        '> Subject: Quoted text\n>\n> Quoted body.',
        '```text\nSubject: Code sample\n\nCode body.\n```',
        'Subject: No body',
        '## Customer-ready draft\n\nSubject: No body\n\n## Feedback prompt\n\nWould you like a brief?'
    ])('does not expose email actions for an offer, quoted evidence, code or empty draft: %s', (content) => {
        expect(extractCustomerEmail(content)).toBeUndefined()
    })

    it('extracts a quoted draft under a human-review heading and ignores the reviewer note inside the quote', () => {
        const content = `## Customer-ready draft requiring human review\n\n> Requires human review.\n>\n> **Subject:** Aligning on next steps for SQL PAYGO\n>\n> Hi [Customer Name],\n>\n> I wanted to follow up on our SQL PAYGO discussion.\n>\n> Best,\n> [Seller Name]\n\n## Recommended tailoring before send\n\n- Confirm the timing.`
        const located = locateCustomerEmail(content)
        expect(located?.draft).toEqual({
            subject: 'Aligning on next steps for SQL PAYGO',
            markdown: 'Hi [Customer Name],\n\nI wanted to follow up on our SQL PAYGO discussion.\n\nBest,\n[Seller Name]'
        })
        expect(formatResponseMarkdown(content).slice(located!.end)).toMatch(/^\s*## Recommended tailoring before send/)
        expect(customerEmailHasPlaceholders(located!.draft)).toBe(true)
    })

    it('does not treat evidence references or links as unfinished placeholders', () => {
        expect(customerEmailHasPlaceholders({ subject: 'Update', markdown: 'See [O.C1] and [the evidence](https://example.com/evidence).' })).toBe(false)
    })

    it('splits an unquoted draft before the next section so actions sit with the email', () => {
        const content = `## Customer-ready draft\n\nSubject: Confirming next steps\n\n${body}\n\n## Recommended tailoring\n\nChange the greeting.`
        expect(formatResponseMarkdown(content).slice(locateCustomerEmail(content)!.end)).toMatch(/^## Recommended tailoring/)
    })

    it('never combines two independently headed email drafts', () => {
        expect(extractCustomerEmail(`## Customer-ready draft\n\nSubject: First draft\n\nFirst body.\n\n## Alternative email\n\nSubject: Second draft\n\nSecond body.`))
            .toEqual({ subject: 'First draft', markdown: 'First body.' })
    })
})
