import { useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import type { UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentCapability } from '../../packages/common/contracts/index.js'
import { buildAgentFollowUpPrompt, responseFeedbackPrompt, responseFollowUps } from './agent-follow-up.js'
import { formatResponseMarkdown } from './response-markdown.js'
import { useAgentRun, type AgentInvoke } from './use-agent-run.js'
import { CustomerEmailActions } from './customer-email-actions.js'
import { locateCustomerEmail, type CustomerEmailAction } from './customer-email.js'
import './agent-response.css'

export interface AgentFollowUpContext {
    capability: AgentCapability
    accountId: string
    opportunityId: string
    invoke: AgentInvoke
}

interface AgentResponseProps {
    content: string
    busy?: boolean
    followUp?: AgentFollowUpContext | undefined
    emailAction?: CustomerEmailAction | undefined
    urlTransform?: UrlTransform | undefined
    onOpenEvidence: (url: string) => void | Promise<void>
}

export function AgentResponse({ content, busy = false, followUp, emailAction, urlTransform, onOpenEvidence }: AgentResponseProps) {
    const [linkError, setLinkError] = useState('')
    const formatted = useMemo(() => formatResponseMarkdown(content), [content])
    const email = useMemo(() => busy ? undefined : locateCustomerEmail(content), [content, busy])
    async function openEvidence(url: string) {
        setLinkError('')
        try { await onOpenEvidence(url) }
        catch (error) { setLinkError(error instanceof Error ? error.message : 'The evidence link could not be opened.') }
    }
    const markdown = (value: string) => <div className="agent-response-markdown">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={{
            a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void openEvidence(href) }}>{children}</a>
        }}>{value}</Markdown>
    </div>
    return <>
        {email ? <>
            {markdown(formatted.slice(0, email.end))}
            <CustomerEmailActions key={content} draft={email.draft} emailAction={emailAction} />
            {formatted.slice(email.end).trim() && markdown(formatted.slice(email.end))}
        </> : markdown(formatted)}
        {linkError && <p role="alert">{linkError}</p>}
        {followUp && <AgentFollowUps content={content} busy={busy} followUp={followUp} emailAction={emailAction} urlTransform={urlTransform} onOpenEvidence={onOpenEvidence} />}
    </>
}

function AgentFollowUps({ content, busy = false, followUp, emailAction, urlTransform, onOpenEvidence }: AgentResponseProps & { followUp: AgentFollowUpContext }) {
    const [selected, setSelected] = useState('')
    const [error, setError] = useState('')
    const [replyOpen, setReplyOpen] = useState(false)
    const [feedback, setFeedback] = useState('')
    const { agentResult, agentLoading, agentPhase, runAgent, cancelAgent } = useAgentRun(followUp.invoke)
    const suggestions = responseFollowUps(content)
    const feedbackPrompt = responseFeedbackPrompt(content)

    async function send(suggestion: string) {
        if (busy || agentLoading) return
        setError('')
        try {
            const prompt = buildAgentFollowUpPrompt(content, suggestion)
            setSelected(suggestion)
            await runAgent(followUp.capability, followUp.accountId, followUp.opportunityId, prompt)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The follow-up could not be generated.')
        }
    }

    if (!suggestions.length && !feedbackPrompt) return null
    return <section className="agent-follow-ups" aria-label="Suggested follow-ups">
        <p className="agent-follow-ups-hint">{suggestions.length ? 'Continue with this agent. Selecting a suggestion sends it with the response above.' : 'Reply to the feedback prompt to continue with this agent.'}</p>
        <div className="agent-follow-up-options">
            {suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={busy || agentLoading} aria-label={`Send follow-up: ${suggestion}`} onClick={() => void send(suggestion)}>{suggestion}</button>)}
            {feedbackPrompt && <button type="button" disabled={busy || agentLoading} aria-expanded={replyOpen} onClick={() => setReplyOpen((open) => !open)}>Reply to feedback</button>}
        </div>
        {replyOpen && <form className="agent-feedback-reply" onSubmit={(event) => { event.preventDefault(); if (feedback.trim()) void send(feedback.trim()) }}>
            <label>Reply to the agent<textarea value={feedback} rows={2} onChange={(event) => setFeedback(event.target.value)} /></label>
            <button type="submit" disabled={busy || agentLoading || !feedback.trim()}>Send reply to agent</button>
        </form>}
        {agentLoading && <p role="status">
            {agentPhase === 'streaming' ? 'Receiving follow-up response...' : 'Generating follow-up response...'}
            {' '}<button type="button" onClick={cancelAgent}>Cancel follow-up</button>
        </p>}
        {error && <p role="alert">{error}</p>}
        {agentResult && <article className="agent-follow-up-response" aria-label="Agent follow-up response">
            <header><strong>Follow-up</strong><span>{selected}</span></header>
            <AgentResponse key={agentResult.correlationId} content={agentResult.content} busy={agentLoading || agentResult.agentVersion === 'streaming'} followUp={followUp} emailAction={emailAction} urlTransform={urlTransform} onOpenEvidence={onOpenEvidence} />
        </article>}
    </section>
}
