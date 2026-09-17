import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { dataClient } from './data-client.js'
import { onHostMessage } from './bridge.js'
import { formatResponseMarkdown } from './response-markdown.js'
import { suggestedPrompts } from './prompt-catalog.js'
import { sortMilestones, sortOpportunities, type MilestoneSort, type OpportunitySort, type SortDirection } from './sorting.js'
import type {
    AccountView,
    AgentCapability,
    AgentTaskView,
    McemView,
    MilestoneUpdateInput,
    MilestoneView,
    OpportunityView,
    WorkflowDefinitionView,
    WorkflowOutputView,
    WorkflowResultCardView
} from './view-types.js'

type Tab = 'portfolio' | 'plays'
type Loadable<T> = { status: 'idle' | 'loading' | 'error' | 'ready'; data?: T; error?: string }

const CAPABILITIES: Array<{ id: AgentCapability; label: string }> = [
    { id: 'account-pulse', label: 'Account Pulse' },
    { id: 'mcem-coach', label: 'MCEM Coach' },
    { id: 'pursuit-executive', label: 'Pursuit' },
    { id: 'risk-solution-play', label: 'Risk & Play' }
]

// Routes each Play's queue-item guidance handoff to the most relevant agent.
const GUIDANCE_AGENT_BY_WORKFLOW: Readonly<Record<string, AgentCapability>> = {
    'WF-001': 'pursuit-executive',
    'WF-002': 'mcem-coach',
    'WF-003': 'mcem-coach',
    'WF-004': 'pursuit-executive',
    'WF-005': 'mcem-coach',
    'WF-006': 'risk-solution-play',
    'WF-007': 'account-pulse',
    'WF-008': 'risk-solution-play',
    'WF-009': 'account-pulse',
    'WF-010': 'account-pulse',
    'WF-011': 'account-pulse',
    'WF-012': 'mcem-coach'
}

function guidanceAgentFor(workflowId: string): AgentCapability {
    return GUIDANCE_AGENT_BY_WORKFLOW[workflowId] ?? 'mcem-coach'
}

function agentLabel(capability: AgentCapability): string {
    return CAPABILITIES.find((item) => item.id === capability)?.label ?? 'Guidance'
}

function playFailureMessage(status: string): string {
    if (status === 'failed') {
        return 'This play could not complete — the query took too long and timed out, or the data source was temporarily unavailable. Please try again in a moment.'
    }
    if (status === 'cancelled') {
        return 'This play was cancelled before it finished. Please run it again.'
    }
    return `This play could not complete (status: ${status}). Please try again.`
}

const today = (): string => new Date().toISOString().slice(0, 10)

/** Renders agent/guidance markdown identically to the desktop/web hosts; links open evidence. */
function AgentMarkdown({ content }: { content: string }): ReactElement {
    return (
        <div className="agent-response-markdown">
            <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                    a: ({ href, children }) => (
                        <a href={href} onClick={(event) => { event.preventDefault(); if (href) void dataClient.openEvidence(href) }}>{children}</a>
                    )
                }}
            >
                {formatResponseMarkdown(content)}
            </Markdown>
        </div>
    )
}

/** True when the card itself has renderable content; action/exception cards are shown via the Operational queue. */
function cardHasContent(card: WorkflowResultCardView): boolean {
    return Boolean(card.metrics?.length || card.rows?.length || card.items?.length)
}

function ResultCard({ card }: { card: WorkflowResultCardView }): ReactElement | null {
    if (card.metrics && card.metrics.length > 0) {
        return (
            <div className="metric-strip">
                {card.metrics.map((metric) => (
                    <div className="metric" key={metric.label}>
                        <div className="metric-value">{String(metric.value)}</div>
                        <div className="metric-label">{metric.label}</div>
                    </div>
                ))}
            </div>
        )
    }
    if (card.rows && card.rows.length > 0) {
        const columns = card.columns ?? Object.keys(card.rows[0] ?? {})
        return (
            <table className="record-table">
                <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                    {card.rows.map((row, index) => (
                        <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>
                    ))}
                </tbody>
            </table>
        )
    }
    if (card.items && card.items.length > 0) {
        return (
            <ul className="item-list">
                {card.items.map((item, index) => (
                    <li key={index}><strong>{item.title ?? item.label ?? 'Item'}</strong>{item.detail ? ` - ${item.detail}` : ''}</li>
                ))}
            </ul>
        )
    }
    return null
}

/** Builds a rich markdown document from an MCEM evaluation for export/email. */
function mcemToMarkdown(data: McemView, opportunityName: string): string {
    const criteria = data.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** - ${criterion.rationale}`).join('\n')
    const recommendations = data.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join('\n')
    const missing = data.missingData.length > 0
        ? data.missingData.map((item) => `- ${item}`).join('\n')
        : '- No criterion evidence is missing; all current-stage exit criteria are supported.'
    return [
        '## Summary', '', data.summary, '',
        '## Context used', '', `**Opportunity:** ${opportunityName}`, `**Recorded / evidence-based stage:** ${data.recordedStage} / ${data.evidenceBasedStage} (${data.state})`, '',
        '## Exit criteria', '', criteria, '',
        '## Recommended actions', '', '| Owner | Action | Confidence |', '| --- | --- | --- |', recommendations, '',
        '## Missing information', '', missing
    ].join('\n')
}

function PlaysPanel({ runRequest }: { runRequest?: { workflowId: string; token: number } | undefined }): ReactElement {
    const [definitions, setDefinitions] = useState<Loadable<WorkflowDefinitionView[]>>({ status: 'idle' })
    const [running, setRunning] = useState<string | undefined>(undefined)
    const [output, setOutput] = useState<{ runId: string; workflowId: string; card: WorkflowResultCardView; queue: WorkflowOutputView['queueItems'] } | undefined>(undefined)
    const [runError, setRunError] = useState<string | undefined>(undefined)
    const [guidance, setGuidance] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; itemId?: string; title?: string; evidenceIds?: string[]; content?: string; error?: string }>({ status: 'idle' })

    useEffect(() => {
        setDefinitions({ status: 'loading' })
        dataClient.listWorkflowDefinitions()
            .then((data) => setDefinitions({ status: 'ready', data }))
            .catch((error: Error) => setDefinitions({ status: 'error', error: error.message }))
    }, [])

    const runPlay = useCallback(async (workflowId: string) => {
        setRunning(workflowId)
        setRunError(undefined)
        setOutput(undefined)
        setGuidance({ status: 'idle' })
        try {
            const view = await dataClient.runWorkflowToCompletion(workflowId, today())
            if (view.run.status !== 'completed' || !view.output) {
                setRunError(playFailureMessage(view.run.status))
            } else {
                setOutput({ runId: view.run.runId, workflowId, card: view.output.card, queue: view.output.queueItems })
            }
        } catch (error) {
            setRunError((error as Error).message)
        } finally {
            setRunning(undefined)
        }
    }, [])

    const sendToGuidance = useCallback(async (runId: string, itemId: string, itemTitle: string, capability: AgentCapability) => {
        setGuidance({ status: 'loading', itemId, title: itemTitle })
        try {
            const { handoff, response } = await dataClient.sendQueueItemToGuidance(runId, itemId, capability)
            setGuidance({ status: 'ready', itemId, title: itemTitle, evidenceIds: handoff.context.evidenceIds, content: response.content })
        } catch (error) {
            setGuidance({ status: 'error', itemId, title: itemTitle, error: (error as Error).message })
        }
    }, [])

    useEffect(() => {
        if (runRequest) void runPlay(runRequest.workflowId)
    }, [runRequest?.token, runRequest, runPlay])

    if (definitions.status === 'loading' || definitions.status === 'idle') return <p className="muted">Loading plays...</p>
    if (definitions.status === 'error') return <p className="error">Could not load plays: {definitions.error}</p>

    return (
        <div className="split">
            <section className="pane">
                <h3>Plays</h3>
                <ul className="play-list">
                    {definitions.data?.map((definition) => (
                        <li key={definition.id}>
                            <div className="play-head">
                                <span className="play-name">{definition.name}</span>
                                <span className="badge">{definition.id}</span>
                            </div>
                            <div className="play-meta muted">{definition.personaTargets.join(', ')}</div>
                            <button className="primary" disabled={running !== undefined} onClick={() => void runPlay(definition.id)}>
                                {running === definition.id ? 'Running...' : 'Run'}
                            </button>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="pane">
                <h3>Result</h3>
                {runError && <p className="error">{runError}</p>}
                {!output && !runError && <p className="muted">Run a play to see results.</p>}
                {output && ((current: { runId: string; workflowId: string; card: WorkflowResultCardView; queue: WorkflowOutputView['queueItems'] }) => (
                    <div>
                        <h4>{definitions.data?.find((definition) => definition.id === current.workflowId)?.name ?? current.workflowId}</h4>
                        <ResultCard card={current.card} />
                        {!cardHasContent(current.card) && current.queue.length === 0 && (
                            <p className="muted">This play returned no items for the current scope.</p>
                        )}
                        {current.queue.length > 0 && (
                            <div className="queue">
                                <h4>Operational queue</h4>
                                <ul className="item-list">
                                    {current.queue.map((item) => (
                                        <li key={item.id}>
                                            <span className="badge">{item.priority}</span> {item.title}
                                            {item.accountId && item.opportunityId && (
                                                <button className="link" disabled={guidance.status === 'loading'} onClick={() => void sendToGuidance(current.runId, item.id, item.title, guidanceAgentFor(current.workflowId))}>
                                                    {guidance.status === 'loading' && guidance.itemId === item.id ? ' Sending...' : ` Send to ${agentLabel(guidanceAgentFor(current.workflowId))}`}
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {guidance.status === 'error' && <p className="error">{guidance.error}</p>}
                        {guidance.status === 'ready' && (
                            <div className="mcem">
                                <h4>Guidance for: {guidance.title}</h4>
                                <p className="muted">Evidence cited: {(guidance.evidenceIds ?? []).join(', ')}</p>
                                <AgentMarkdown content={guidance.content ?? ''} />
                            </div>
                        )}
                    </div>
                ))(output)}
            </section>
        </div>
    )
}


/** Top-of-response action toolbar with styled Email (.eml draft) and Word (.docx export) buttons. */
function ResponseActions({ title, markdown, onNote }: { title: string; markdown: string; onNote: (message: string) => void }): ReactElement {
    const onEmail = async (): Promise<void> => {
        onNote('Opening email draft...')
        try { await dataClient.composeEmail(title, title, markdown); onNote('Email draft opened in your mail client.') }
        catch (error) { onNote((error as Error).message) }
    }
    const onExport = async (): Promise<void> => {
        onNote('Exporting...')
        try { const result = await dataClient.exportContent(title, markdown); onNote(result.saved ? 'Exported to the selected file.' : 'Export cancelled.') }
        catch (error) { onNote((error as Error).message) }
    }
    return (
        <div className="response-actions">
            <button className="action-button email" onClick={() => void onEmail()}>Email</button>
            <button className="action-button word" onClick={() => void onExport()}>Word</button>
        </div>
    )
}

/** Guidance sub-tab: agent selector, per-agent suggested prompts, a composer with Send, and the response. */
function GuidancePane({ accountId, opportunityId, opportunityName, onNote }: { accountId: string; opportunityId: string; opportunityName: string; onNote: (message: string) => void }): ReactElement {
    const [capability, setCapability] = useState<AgentCapability>('account-pulse')
    const [taskPrompt, setTaskPrompt] = useState('')
    const [agent, setAgent] = useState<Loadable<AgentTaskView>>({ status: 'idle' })

    useEffect(() => { setAgent({ status: 'idle' }); setTaskPrompt('') }, [capability, opportunityId])

    const runAgentPrompt = useCallback(async (prompt?: string) => {
        const finalPrompt = (prompt ?? taskPrompt).trim()
        if (finalPrompt.length < 3) return
        setAgent({ status: 'loading' })
        try {
            setAgent({ status: 'ready', data: await dataClient.runAgentTask(capability, accountId, opportunityId, finalPrompt) })
        } catch (error) {
            setAgent({ status: 'error', error: (error as Error).message })
        }
    }, [capability, accountId, opportunityId, taskPrompt])

    const label = CAPABILITIES.find((item) => item.id === capability)?.label ?? 'Guidance'

    return (
        <div>
            <div className="agent-tabs" role="tablist">
                {CAPABILITIES.map((item) => (
                    <button key={item.id} role="tab" aria-selected={capability === item.id} className={capability === item.id ? 'tab active' : 'tab'} onClick={() => setCapability(item.id)}>{item.label}</button>
                ))}
            </div>
            <div className="prompt-suggestions" aria-label={`${label} suggested prompts`}>
                {suggestedPrompts[capability].map((prompt) => (
                    <button key={prompt} type="button" className="prompt-chip" disabled={agent.status === 'loading'} onClick={() => void runAgentPrompt(prompt)}>{prompt}</button>
                ))}
            </div>
            <div className="agent-composer">
                <textarea aria-label="Agent task" placeholder="Ask a different question..." rows={2} value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} />
                <button className="primary" disabled={agent.status === 'loading' || taskPrompt.trim().length < 3} onClick={() => void runAgentPrompt()}>{agent.status === 'loading' ? 'Analyzing...' : 'Send'}</button>
            </div>
            {agent.status === 'loading' && <p className="muted">Running {label}...</p>}
            {agent.status === 'error' && <p className="error">{agent.error}</p>}
            {agent.status === 'ready' && agent.data && ((data: AgentTaskView) => (
                <article className="agent-response">
                    <header className="agent-response-header">
                        <span className="eyebrow">{label}</span>
                        <ResponseActions title={`Guidance - ${opportunityName}`} markdown={data.content} onNote={onNote} />
                    </header>
                    <AgentMarkdown content={data.content} />
                </article>
            ))(agent.data)}
            {agent.status === 'idle' && <p className="muted">Choose a suggested prompt or ask a different question.</p>}
        </div>
    )
}

/** MCEM Stage Management sub-tab: shows recorded vs evidence-based stage and moves to an adjacent stage. */
function StagesPane({ accountId, opportunity, onStageChanged, onNote }: { accountId: string; opportunity: OpportunityView; onStageChanged: () => void; onNote: (message: string) => void }): ReactElement {
    const [evaluation, setEvaluation] = useState<Loadable<McemView>>({ status: 'idle' })
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        setEvaluation({ status: 'loading' })
        try { setEvaluation({ status: 'ready', data: await dataClient.runMcemCoach(accountId, opportunity.id) }) }
        catch (error) { setEvaluation({ status: 'error', error: (error as Error).message }) }
    }, [accountId, opportunity.id])

    useEffect(() => { void load() }, [load])

    const move = useCallback(async (targetStage: number) => {
        setBusy(true)
        try {
            const result = await dataClient.transitionOpportunityStage(accountId, opportunity.id, targetStage, reason.trim() || undefined)
            onNote(`Stage moved ${result.previousStage} -> ${result.targetStage} (${result.disposition}).`)
            setReason('')
            onStageChanged()
            await load()
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [accountId, opportunity.id, reason, onStageChanged, load])

    const recorded = opportunity.recordedStage
    const evidenceStage = evaluation.status === 'ready' && evaluation.data ? String(evaluation.data.evidenceBasedStage) : '—'
    return (
        <div>
            <div className="stage-band">
                <div><span className="muted">Recorded in MSX</span><strong>Stage {recorded}</strong></div>
                <span className="stage-arrow">-&gt;</span>
                <div><span className="muted">Evidence supports</span><strong>Stage {evidenceStage}</strong></div>
            </div>
            {evaluation.status === 'loading' && <p className="muted">Evaluating exit criteria...</p>}
            {evaluation.status === 'error' && <p className="error">{evaluation.error}</p>}
            {evaluation.status === 'ready' && evaluation.data && (
                <div>
                    <p><strong>{evaluation.data.summary}</strong></p>
                    <ul className="item-list">
                        {evaluation.data.criteria.map((criterion) => (
                            <li key={criterion.id}><span className={`status status-${criterion.status}`}>{criterion.status}</span> {criterion.label}</li>
                        ))}
                    </ul>
                </div>
            )}
            <h4>Change stage</h4>
            <p className="muted">A reason is required to recycle, or to advance with open criteria.</p>
            <div className="agent-composer">
                <textarea aria-label="Stage change reason" placeholder="Reason for the stage change..." rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            <div className="actions">
                <button className="secondary" disabled={busy || recorded <= 1} onClick={() => void move(recorded - 1)}>Recycle to Stage {recorded - 1}</button>
                <button className="primary" disabled={busy || recorded >= 5} onClick={() => void move(recorded + 1)}>Advance to Stage {recorded + 1}</button>
            </div>
        </div>
    )
}

const MILESTONE_STATUS_OPTIONS = ['On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled', 'Lost to Competitor', 'Hygiene/Duplicate']
const COMMITMENT_OPTIONS = ['Uncommitted', 'Committed']
const MILESTONE_FIELDS: Array<{ id: 'status' | 'targetDate' | 'customerCommitment' | 'riskDetails' | 'comments'; label: string }> = [
    { id: 'status', label: 'Status' },
    { id: 'targetDate', label: 'Target date' },
    { id: 'customerCommitment', label: 'Commitment' },
    { id: 'riskDetails', label: 'Risk' },
    { id: 'comments', label: 'Comments' }
]

function milestoneFieldValue(milestone: MilestoneView, field: (typeof MILESTONE_FIELDS)[number]['id']): string {
    if (field === 'status') return milestone.status
    if (field === 'targetDate') return milestone.targetDate ?? ''
    if (field === 'customerCommitment') return milestone.commitment === 'Committed' ? 'Committed' : 'Uncommitted'
    if (field === 'riskDetails') return milestone.riskDetails ?? ''
    return milestone.comments ?? ''
}

/** Milestones sub-list with sort control and five editable fields per milestone. */
function MilestonesEditor({ opportunityId, milestones, onChanged, onNote }: { opportunityId: string; milestones: MilestoneView[]; onChanged: () => void; onNote: (message: string) => void }): ReactElement {
    const [sortBy, setSortBy] = useState<MilestoneSort>('targetDate')
    const [direction, setDirection] = useState<SortDirection>('ascending')
    const [edit, setEdit] = useState<{ milestoneId: string; field: (typeof MILESTONE_FIELDS)[number]['id']; value: string } | undefined>(undefined)
    const [saving, setSaving] = useState(false)

    const sorted = sortMilestones(milestones, sortBy, direction)

    const save = useCallback(async () => {
        if (!edit) return
        setSaving(true)
        try {
            const update: MilestoneUpdateInput =
                edit.field === 'status' ? { status: edit.value }
                    : edit.field === 'targetDate' ? { targetDate: edit.value }
                        : edit.field === 'customerCommitment' ? { customerCommitment: edit.value }
                            : edit.field === 'riskDetails' ? { riskDetails: edit.value }
                                : { comments: edit.value }
            await dataClient.updateMilestone(opportunityId, edit.milestoneId, update)
            setEdit(undefined)
            onChanged()
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setSaving(false)
        }
    }, [edit, opportunityId, onChanged, onNote])

    return (
        <div>
            <div className="list-toolbar">
                <label>Sort
                    <select value={sortBy} onChange={(event) => setSortBy(event.target.value as MilestoneSort)}>
                        <option value="targetDate">Est. Date</option>
                        <option value="estimatedMonthlyUsage">Est. Monthly Usage</option>
                        <option value="commitment">Customer Commitment</option>
                        <option value="status">Status</option>
                    </select>
                </label>
                <button className="link" onClick={() => setDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}>{direction === 'ascending' ? 'Asc' : 'Desc'}</button>
            </div>
            <ul className="item-list">
                {sorted.map((milestone) => (
                    <li key={milestone.id} className="milestone-row">
                        <div><strong>{milestone.name}</strong> - {milestone.status}{milestone.targetDate ? ` (due ${milestone.targetDate})` : ''}{milestone.commitment ? ` - ${milestone.commitment}` : ''}</div>
                        <div className="field-buttons">
                            {MILESTONE_FIELDS.map((field) => (
                                <button key={field.id} className="chip-button" onClick={() => setEdit({ milestoneId: milestone.id, field: field.id, value: milestoneFieldValue(milestone, field.id) })}>{field.label}</button>
                            ))}
                        </div>
                        {edit && edit.milestoneId === milestone.id && (
                            <div className="record-editor">
                                <label>{MILESTONE_FIELDS.find((field) => field.id === edit.field)?.label}</label>
                                {edit.field === 'status' && (
                                    <select value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>{MILESTONE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                                )}
                                {edit.field === 'customerCommitment' && (
                                    <select value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>{COMMITMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                                )}
                                {edit.field === 'targetDate' && (
                                    <input type="date" value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
                                )}
                                {(edit.field === 'riskDetails' || edit.field === 'comments') && (
                                    <textarea rows={2} value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
                                )}
                                <div className="actions">
                                    <button className="secondary" disabled={saving} onClick={() => setEdit(undefined)}>Cancel</button>
                                    <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Save'}</button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
                {milestones.length === 0 && <li className="muted">No milestones.</li>}
            </ul>
        </div>
    )
}

/** MCEM board: five stage columns with draggable opportunity cards and a reason-gated move. */
function StageBoard({ accountId, opportunities, onChanged, onNote }: { accountId: string; opportunities: OpportunityView[]; onChanged: () => void; onNote: (message: string) => void }): ReactElement {
    const [pending, setPending] = useState<{ opportunityId: string; opportunityName: string; targetStage: number } | undefined>(undefined)
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)

    const handleDrop = (targetStage: number, event: DragEvent): void => {
        event.preventDefault()
        const opportunityId = event.dataTransfer.getData('text/plain')
        const opportunity = opportunities.find((item) => item.id === opportunityId)
        if (!opportunity || opportunity.recordedStage === targetStage) return
        if (Math.abs(targetStage - opportunity.recordedStage) !== 1) { onNote('Stage moves must be to an adjacent stage.'); return }
        setPending({ opportunityId, opportunityName: opportunity.name, targetStage })
        setReason('')
    }

    const confirm = useCallback(async () => {
        if (!pending) return
        setBusy(true)
        try {
            const result = await dataClient.transitionOpportunityStage(accountId, pending.opportunityId, pending.targetStage, reason.trim() || undefined)
            onNote(`Moved ${pending.opportunityName} to Stage ${result.targetStage} (${result.disposition}).`)
            setPending(undefined)
            setReason('')
            onChanged()
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [pending, accountId, reason, onChanged, onNote])

    return (
        <div>
            <p className="muted">Drag an opportunity card to an adjacent stage.</p>
            <div className="stage-board">
                {[1, 2, 3, 4, 5].map((stage) => {
                    const cards = opportunities.filter((opportunity) => opportunity.recordedStage === stage)
                    return (
                        <div key={stage} className="stage-column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(stage, event)}>
                            <div className="stage-column-header">Stage {stage} <span className="badge">{cards.length}</span></div>
                            {cards.map((opportunity) => (
                                <div key={opportunity.id} className="stage-card" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', opportunity.id)}>
                                    <strong>{opportunity.name}</strong>
                                    <span className="muted">{opportunity.owner ?? 'Unassigned'}</span>
                                </div>
                            ))}
                            {cards.length === 0 && <p className="muted empty-col">-</p>}
                        </div>
                    )
                })}
            </div>
            {pending && (
                <div className="record-editor">
                    <p>Move <strong>{pending.opportunityName}</strong> to Stage {pending.targetStage}?</p>
                    <p className="muted">A reason is required to recycle, or to advance with open criteria.</p>
                    <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for the stage change..." />
                    <div className="actions">
                        <button className="secondary" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
                        <button className="primary" disabled={busy} onClick={() => void confirm()}>Confirm move</button>
                    </div>
                </div>
            )}
        </div>
    )
}

type SubTab = 'overview' | 'guidance' | 'stages'

function PortfolioPanel({ focus }: { focus?: { accountId?: string | undefined; opportunityId?: string | undefined } | undefined }): ReactElement {
    const [accounts, setAccounts] = useState<Loadable<AccountView[]>>({ status: 'idle' })
    const [accountId, setAccountId] = useState<string | undefined>(undefined)
    const [opportunities, setOpportunities] = useState<OpportunityView[]>([])
    const [opportunityId, setOpportunityId] = useState<string | undefined>(undefined)
    const [milestones, setMilestones] = useState<MilestoneView[]>([])
    const [mcem, setMcem] = useState<Loadable<McemView>>({ status: 'idle' })
    const [sub, setSub] = useState<SubTab>('overview')
    const [note, setNote] = useState<string | undefined>(undefined)

    useEffect(() => {
        setAccounts({ status: 'loading' })
        dataClient.listAccounts()
            .then((data) => { setAccounts({ status: 'ready', data }); if (data[0]) setAccountId(data[0].id) })
            .catch((error: Error) => setAccounts({ status: 'error', error: error.message }))
    }, [])

    useEffect(() => {
        if (focus?.accountId) setAccountId(focus.accountId)
    }, [focus?.accountId])

    const loadOpportunities = useCallback((preferredId?: string) => {
        if (!accountId) return
        dataClient.listOpportunities(accountId).then((data) => {
            setOpportunities(data)
            setOpportunityId((current) => (preferredId && data.some((item) => item.id === preferredId))
                ? preferredId
                : (current && data.some((item) => item.id === current)) ? current : data[0]?.id)
        }).catch(() => setOpportunities([]))
    }, [accountId])

    useEffect(() => { loadOpportunities(focus?.opportunityId) }, [loadOpportunities, focus?.opportunityId])

    useEffect(() => {
        if (!opportunityId) { setMilestones([]); return }
        dataClient.listMilestones(opportunityId).then(setMilestones).catch(() => setMilestones([]))
        setMcem({ status: 'idle' })
        setNote(undefined)
    }, [opportunityId])

    const selectedOpportunity = useMemo(
        () => opportunities.find((opportunity) => opportunity.id === opportunityId),
        [opportunities, opportunityId]
    )

    const runCoach = useCallback(async () => {
        if (!selectedOpportunity) return
        setMcem({ status: 'loading' })
        try {
            setMcem({ status: 'ready', data: await dataClient.runMcemCoach(selectedOpportunity.accountId, selectedOpportunity.id) })
        } catch (error) {
            setMcem({ status: 'error', error: (error as Error).message })
        }
    }, [selectedOpportunity])

    const openEvidence = useCallback(async (url: string) => {
        setNote('Opening evidence...')
        try { await dataClient.openEvidence(url); setNote('Opened evidence in your browser.') }
        catch (error) { setNote((error as Error).message) }
    }, [])

    const reloadMilestones = useCallback(() => {
        if (!opportunityId) return
        dataClient.listMilestones(opportunityId).then(setMilestones).catch(() => { /* keep prior */ })
    }, [opportunityId])

    const [opportunitySort, setOpportunitySort] = useState<OpportunitySort>('closeDate')
    const [opportunityDirection, setOpportunityDirection] = useState<SortDirection>('ascending')
    const [commentsFor, setCommentsFor] = useState<string | undefined>(undefined)
    const [commentsText, setCommentsText] = useState('')
    const [savingComments, setSavingComments] = useState(false)
    const sortedOpportunities = sortOpportunities(opportunities, opportunitySort, opportunityDirection)

    const saveComments = useCallback(async (id: string) => {
        setSavingComments(true)
        try {
            await dataClient.updateOpportunity(id, commentsText)
            setNote('Opportunity comments saved.')
            setCommentsFor(undefined)
            loadOpportunities(id)
        } catch (error) {
            setNote((error as Error).message)
        } finally {
            setSavingComments(false)
        }
    }, [commentsText, loadOpportunities])

    if (accounts.status === 'loading' || accounts.status === 'idle') return <p className="muted">Loading portfolio...</p>
    if (accounts.status === 'error') return <p className="error">Could not load accounts: {accounts.error}</p>

    return (
        <div className="split">
            <section className="pane">
                <h3>Accounts</h3>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    {accounts.data?.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                <h3>Opportunities</h3>
                <div className="list-toolbar">
                    <label>Sort
                        <select value={opportunitySort} onChange={(event) => setOpportunitySort(event.target.value as OpportunitySort)}>
                            <option value="closeDate">Close Date</option>
                            <option value="stage">Stage</option>
                            <option value="value">$ Value</option>
                        </select>
                    </label>
                    <button className="link" onClick={() => setOpportunityDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}>{opportunityDirection === 'ascending' ? 'Asc' : 'Desc'}</button>
                </div>
                <ul className="opp-list">
                    {sortedOpportunities.map((opportunity) => (
                        <li key={opportunity.id}>
                            <div className="opp-row">
                                <button className={opportunity.id === opportunityId ? 'link active' : 'link'} onClick={() => setOpportunityId(opportunity.id)}>
                                    {opportunity.name}
                                </button>
                                <span className="badge">Stage {opportunity.recordedStage}</span>
                                <button className="chip-button" title="Opportunity comments" onClick={() => { setCommentsFor(opportunity.id); setCommentsText(opportunity.comments ?? '') }}>Comments</button>
                            </div>
                            {commentsFor === opportunity.id && (
                                <div className="record-editor">
                                    <label>Opportunity comments</label>
                                    <textarea rows={2} value={commentsText} onChange={(event) => setCommentsText(event.target.value)} />
                                    <div className="actions">
                                        <button className="secondary" disabled={savingComments} onClick={() => setCommentsFor(undefined)}>Cancel</button>
                                        <button className="primary" disabled={savingComments} onClick={() => void saveComments(opportunity.id)}>{savingComments ? 'Saving...' : 'Save'}</button>
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
            <section className="pane">
                {selectedOpportunity ? (
                    <div>
                        <h3>{selectedOpportunity.name}</h3>
                        <p className="muted">Owner: {selectedOpportunity.owner ?? 'Account team'} - Stage {selectedOpportunity.recordedStage} - Close: {selectedOpportunity.closeDate}</p>
                        <nav className="subtabs" role="tablist">
                            <button role="tab" aria-selected={sub === 'overview'} className={sub === 'overview' ? 'tab active' : 'tab'} onClick={() => setSub('overview')}>Overview</button>
                            <button role="tab" aria-selected={sub === 'guidance'} className={sub === 'guidance' ? 'tab active' : 'tab'} onClick={() => setSub('guidance')}>Guidance</button>
                            <button role="tab" aria-selected={sub === 'stages'} className={sub === 'stages' ? 'tab active' : 'tab'} onClick={() => setSub('stages')}>MCEM Stages</button>
                        </nav>
                        {sub === 'overview' && (
                            <div>
                                <h4>Milestones</h4>
                                <MilestonesEditor opportunityId={selectedOpportunity.id} milestones={milestones} onChanged={reloadMilestones} onNote={setNote} />
                                <div className="actions">
                                    <button className="primary" onClick={() => void runCoach()}>Run MCEM Coach</button>
                                </div>
                                {mcem.status === 'loading' && <p className="muted">Evaluating MCEM stage...</p>}
                                {mcem.status === 'error' && <p className="error">{mcem.error}</p>}
                                {mcem.status === 'ready' && mcem.data && ((data: McemView) => (
                                    <article className="agent-response">
                                        <header className="agent-response-header">
                                            <span className="eyebrow">MCEM Coach</span>
                                            <ResponseActions title={`MCEM Coach - ${selectedOpportunity.name}`} markdown={mcemToMarkdown(data, selectedOpportunity.name)} onNote={setNote} />
                                        </header>
                                        <p><strong>{data.summary}</strong></p>
                                        <p className="muted">Recorded stage {data.recordedStage} - evidence-based stage {data.evidenceBasedStage} ({data.state})</p>
                                        <ul className="item-list">
                                            {data.criteria.map((criterion) => (
                                                <li key={criterion.id}><span className={`status status-${criterion.status}`}>{criterion.status}</span> {criterion.label} - {criterion.rationale}</li>
                                            ))}
                                        </ul>
                                        {data.evidence && data.evidence.length > 0 && (
                                            <ul className="item-list">
                                                {data.evidence.map((item) => (
                                                    <li key={item.id}>
                                                        {item.title} <span className="badge">{item.source}</span>
                                                        {item.url && <button className="link" onClick={() => void openEvidence(item.url as string)}> Open</button>}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </article>
                                ))(mcem.data)}
                            </div>
                        )}
                        {sub === 'guidance' && (
                            <GuidancePane accountId={selectedOpportunity.accountId} opportunityId={selectedOpportunity.id} opportunityName={selectedOpportunity.name} onNote={setNote} />
                        )}
                        {sub === 'stages' && (
                            <div>
                                <StageBoard accountId={selectedOpportunity.accountId} opportunities={opportunities} onChanged={() => loadOpportunities(selectedOpportunity.id)} onNote={setNote} />
                                <StagesPane accountId={selectedOpportunity.accountId} opportunity={selectedOpportunity} onStageChanged={() => loadOpportunities(selectedOpportunity.id)} onNote={setNote} />
                            </div>
                        )}
                        {note && <p className="muted">{note}</p>}
                    </div>
                ) : <p className="muted">Select an opportunity.</p>}
            </section>
        </div>
    )
}

export function App(): ReactElement {
    const [tab, setTab] = useState<Tab>('portfolio')
    const [mode, setMode] = useState<'sample' | 'live'>(() => (document.getElementById('root')?.dataset.mode as 'sample' | 'live') ?? 'sample')
    const [focus, setFocus] = useState<{ accountId?: string | undefined; opportunityId?: string | undefined } | undefined>(undefined)
    const [runRequest, setRunRequest] = useState<{ workflowId: string; token: number } | undefined>(undefined)

    useEffect(() => {
        onHostMessage((message) => {
            if (message.kind === 'event') setMode(message.payload.mode)
            else if (message.kind === 'focus') { setTab('portfolio'); setFocus({ accountId: message.accountId, opportunityId: message.opportunityId }) }
            else if (message.kind === 'runPlay') { setTab('plays'); setRunRequest({ workflowId: message.workflowId, token: message.token }) }
        })
    }, [])

    return (
        <div className="app">
            <header className="app-header">
                <div className="brand">TLC Assist</div>
                <nav className="tabs">
                    <button className={tab === 'portfolio' ? 'tab active' : 'tab'} onClick={() => setTab('portfolio')}>Portfolio</button>
                    <button className={tab === 'plays' ? 'tab active' : 'tab'} onClick={() => setTab('plays')}>Plays</button>
                </nav>
                <span className={`mode-badge mode-${mode}`}>{mode === 'live' ? 'Live' : 'Sample'}</span>
            </header>
            <main className="app-body">
                {tab === 'portfolio' ? <PortfolioPanel focus={focus} /> : <PlaysPanel runRequest={runRequest} />}
            </main>
        </div>
    )
}
