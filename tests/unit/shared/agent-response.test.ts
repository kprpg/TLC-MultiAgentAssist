import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentResponse } from '../../../apps/shared/agent-response.js'

const offer = 'Would you like me to convert this into an email?'
const content = `1. Summary\n\n**Budget:** Unconfirmed [O.C1].\n\n2. Recommended actions\n\n- Owner role: ATS\n\n3. Feedback prompt\n\n${offer}`
const followUp = { capability: 'account-pulse' as const, accountId: 'account', opportunityId: 'opportunity', invoke: vi.fn() }

describe('shared AgentResponse', () => {
    it('offers E-mail and Copy on a completed customer email without preparing or sending automatically', () => {
        const compose = vi.fn()
        const markup = renderToStaticMarkup(createElement(AgentResponse, {
            content: '## Customer-ready draft\n\n**Subject:** Confirming next steps\n\nPlease confirm the approval sequence.',
            emailAction: { kind: 'host', compose }, onOpenEvidence: vi.fn()
        }))
        expect(markup).toContain('aria-label="Customer email draft actions"')
        expect(markup).toContain('>E-mail</button>')
        expect(markup).toContain('>Copy</button>')
        expect(markup).toContain('Nothing is sent automatically.')
        expect(compose).not.toHaveBeenCalled()
    })

    it('places E-mail and Copy immediately after a quoted customer draft and before later review sections', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, {
            content: '## Customer-ready draft requiring human review\n\n> Requires human review.\n>\n> **Subject:** Aligning next steps\n>\n> Hi [Customer Name],\n\n## Recommended tailoring before send\n\nConfirm timing.',
            emailAction: { kind: 'host', compose: vi.fn() }, onOpenEvidence: vi.fn()
        }))
        const actions = markup.indexOf('Customer email draft actions')
        expect(markup.indexOf('Hi [Customer Name],')).toBeLessThan(actions)
        expect(actions).toBeLessThan(markup.indexOf('Recommended tailoring before send'))
        expect(markup).toContain('Replace the bracketed placeholders')
    })

    it('does not allow sharing a partially streamed customer email', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, {
            content: '## Customer-ready draft\n\nSubject: Confirming next steps\n\nIncomplete text.',
            busy: true, emailAction: { kind: 'host', compose: vi.fn() }, onOpenEvidence: vi.fn()
        }))
        expect(markup).not.toContain('Customer email draft actions')
    })

    it('renders sections, bold labels, and an accessible sendable offer without sending automatically', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, { content, followUp, onOpenEvidence: vi.fn() }))
        expect(markup).toContain('<h2>Summary</h2>')
        expect(markup).toContain('<strong>Budget:</strong>')
        expect(markup).toContain('<strong>Owner role:</strong>')
        expect(markup).toContain(`aria-label="Send follow-up: ${offer}"`)
        expect(markup).toContain('Selecting a suggestion sends it with the response above.')
        expect(followUp.invoke).not.toHaveBeenCalled()
    })

    it('disables follow-ups while the response is in progress', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, { content, busy: true, followUp, onOpenEvidence: vi.fn() }))
        expect(markup).toContain(`disabled="" aria-label="Send follow-up: ${offer}"`)
    })

    it('makes generic feedback prompts replyable without choosing an answer for the user', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, {
            content: 'Summary\n\nGrounded findings.\n\nFeedback prompt\n\nWhich area should we prioritize next?',
            followUp, onOpenEvidence: vi.fn()
        }))
        expect(markup).toContain('Reply to feedback')
        expect(markup).not.toContain('aria-label="Send follow-up:')
    })

    it('keeps unsafe HTML and URLs out of response rendering', () => {
        const markup = renderToStaticMarkup(createElement(AgentResponse, {
            content: '<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n[Evidence](https://example.com/evidence)',
            onOpenEvidence: vi.fn()
        }))
        expect(markup).not.toContain('<script>')
        expect(markup).not.toContain('href="javascript:')
        expect(markup).toContain('href="https://example.com/evidence"')
    })
})
