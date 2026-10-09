import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import workflowDescriptionsJson from '../../../../config/workflow-descriptions.json' with { type: 'json' }
import { agentCapabilities } from '../../../../packages/common/types/agent-capabilities.js'
import { dataClient } from './data-client.js'
import { onHostMessage } from './bridge.js'
import { formatResponseMarkdown } from './response-markdown.js'
import { GuidanceAgentTabs } from './guidance-agent-tabs.js'
import { selectGuidancePrompt } from './guidance-prompt-selection.js'
import { RecordTableHeader } from './record-table-header.js'
import { suggestedPrompts } from './prompt-catalog.js'
import { mcemStages } from './mcem-stages.js'
import { NextBestActions } from './next-best-actions.js'
import { PlayRoleOwners } from './play-role-owners.js'
import { groupQueueByOpportunity, highPriorityCount, humanizeResultCard, priorityClass, sectionPlaysByWorkflowNumber, type QueueGroup, type QueueNameResolvers } from './plays-grouping.js'
import { AppHeader } from './app-header.js'
import { CommentsButton } from './comments-button.js'
import { portfolioLayoutClassName } from './portfolio-layout.js'
import { formatMoney, milestoneTooltipContent, opportunityTooltipContent } from './portfolio-record-details.js'
import { RecordTooltip } from './record-tooltip.js'
import { sortMilestones, sortOpportunities, type MilestoneSort, type OpportunitySort, type SortDirection } from './sorting.js'
import { DiscoveryControls, DiscoverySortHeader } from '../../../shared/discovery-controls.js'
import { discoveryCustomers, filterDiscoveryOpportunities, sortDiscoveryOpportunities, toggleDiscoverySort, type DiscoveryFilters, type DiscoverySort } from '../../../shared/discovery.js'
import { filterVisibleMilestones } from '../../../shared/milestone-visibility.js'
import type {
    AccountCandidateView,
    AccountView,
    AgentCapability,
    AgentTaskView,
    DiscoverableOpportunityView,
    McemView,
    MeetingChangeSetProposalView,
    MeetingChangeSetResultView,
    MeetingTranscriptSummaryView,
    MeetingTypeView,
    MilestoneActivityView,
    CreateMilestoneActivityInput,
    MilestoneUpdateInput,
    MilestoneView,
    OpportunityView,
    SeDomainView,
    WorkflowDefinitionView,
    WorkflowOutputView,
    WorkflowResultCardView
} from './view-types.js'

type Tab = 'portfolio' | 'plays' | 'discover'
type Loadable<T> = { status: 'idle' | 'loading' | 'error' | 'ready'; data?: T; error?: string }

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
    return agentCapabilities.find((item) => item.id === capability)?.label ?? 'Guidance'
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

// Play info-tooltip copy is authored in config/workflow-descriptions.json, not in source.
const workflowDescriptions: Readonly<Record<string, { summary: string; reads: string; useIt: string } | undefined>> =
    workflowDescriptionsJson.descriptions

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
                <thead><tr>{columns.map((column) => <th key={column}>{card.columnLabels?.[column] ?? column}</th>)}</tr></thead>
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

function PlayInfoTooltip({ workflowId, name }: { workflowId: string; name: string }): ReactElement | null {
    const [open, setOpen] = useState(false)
    const description = workflowDescriptions[workflowId]
    if (!description) return null
    return (
        <span className="info-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            <button
                type="button"
                className="info-bubble"
                aria-label={`What does "${name}" do?`}
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
            >
                i
            </button>
            {open && (
                <span className="info-popover" role="tooltip">
                    <strong>{name}</strong>
                    <span>{description.summary}</span>
                    <span><em>Reads:</em> {description.reads}</span>
                    <span><em>Use it to:</em> {description.useIt}</span>
                </span>
            )}
        </span>
    )
}

function categoryLabel(category: string): string {
    return category.split('-').map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join(' ')
}

function formatRunTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface CompletedRun {
    runId: string
    workflowId: string
    workflowName: string
    asOf: string
    ranAt: number
    card: WorkflowResultCardView
    queue: WorkflowOutputView['queueItems']
}

type GuidanceEntry = { status: 'loading' | 'ready' | 'error'; title: string; evidenceIds?: string[]; content?: string; error?: string }

function PlaysPanel({ runRequest }: { runRequest?: { workflowId: string; token: number } | undefined }): ReactElement {
    const [definitions, setDefinitions] = useState<Loadable<WorkflowDefinitionView[]>>({ status: 'idle' })
    const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set())
    const [runs, setRuns] = useState<CompletedRun[]>([])
    const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined)
    const [selectedPlayId, setSelectedPlayId] = useState<string | undefined>(undefined)
    const [runError, setRunError] = useState<string | undefined>(undefined)
    const [guidanceByItem, setGuidanceByItem] = useState<Record<string, GuidanceEntry>>({})
    const [accountNames, setAccountNames] = useState<Record<string, string>>({})
    const [opportunityIndex, setOpportunityIndex] = useState<Record<string, { name: string; accountId?: string }>>({})
    const [note, setNote] = useState<string | undefined>(undefined)
    const [playQuery, setPlayQuery] = useState('')
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
    const fetchedOppAccounts = useRef<Set<string>>(new Set())
    const handledRunToken = useRef<number | undefined>(undefined)
    const runHeaderRef = useRef<HTMLElement>(null)

    useEffect(() => {
        setDefinitions({ status: 'loading' })
        dataClient.listWorkflowDefinitions()
            .then((data) => setDefinitions({ status: 'ready', data }))
            .catch((error: Error) => setDefinitions({ status: 'error', error: error.message }))
        // Build a portfolio-wide account + opportunity name index so queue groups and record
        // tables can render descriptive labels instead of raw ids, even for milestone/activity
        // items that only carry an opportunity id.
        void (async () => {
            try {
                const accounts = await dataClient.listAccounts(true)
                setAccountNames(Object.fromEntries(accounts.map((account) => [account.id, account.name])))
                accounts.forEach((account) => fetchedOppAccounts.current.add(account.id))
                const results = await Promise.allSettled(accounts.map((account) => dataClient.listOpportunities(account.id)))
                const index: Record<string, { name: string; accountId?: string }> = {}
                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        for (const opportunity of result.value) index[opportunity.id] = { name: opportunity.name, accountId: opportunity.accountId }
                    }
                }
                if (Object.keys(index).length > 0) setOpportunityIndex((previous) => ({ ...previous, ...index }))
            } catch { /* names are best-effort labels for grouping and record tables */ }
        })()
    }, [])

    // Resolve opportunity display names for any accounts referenced by a result but not yet indexed.
    const ensureOpportunityNames = useCallback(async (queue: WorkflowOutputView['queueItems']) => {
        const accountIds = [...new Set(queue.map((item) => item.accountId).filter((id): id is string => Boolean(id)))]
        const toFetch = accountIds.filter((id) => !fetchedOppAccounts.current.has(id))
        if (toFetch.length === 0) return
        toFetch.forEach((id) => fetchedOppAccounts.current.add(id))
        const results = await Promise.allSettled(toFetch.map((id) => dataClient.listOpportunities(id)))
        const additions: Record<string, { name: string; accountId?: string }> = {}
        for (const result of results) {
            if (result.status === 'fulfilled') {
                for (const opportunity of result.value) additions[opportunity.id] = { name: opportunity.name, accountId: opportunity.accountId }
            }
        }
        if (Object.keys(additions).length > 0) setOpportunityIndex((previous) => ({ ...previous, ...additions }))
    }, [])

    const runPlay = useCallback(async (workflowId: string) => {
        if (runningIds.has(workflowId)) return
        setSelectedPlayId(workflowId)
        setRunError(undefined)
        setRunningIds((previous) => new Set(previous).add(workflowId))
        const asOf = today()
        try {
            const view = await dataClient.runWorkflowToCompletion(workflowId, asOf)
            if (view.run.status !== 'completed' || !view.output) {
                setRunError(playFailureMessage(view.run.status))
            } else {
                const workflowName = definitions.data?.find((definition) => definition.id === workflowId)?.name ?? workflowId
                const completed: CompletedRun = {
                    runId: view.run.runId, workflowId, workflowName, asOf, ranAt: Date.now(),
                    card: view.output.card, queue: view.output.queueItems
                }
                setRuns((previous) => [completed, ...previous.filter((run) => run.runId !== completed.runId)].slice(0, 12))
                setSelectedRunId(view.run.runId)
                void ensureOpportunityNames(view.output.queueItems)
            }
        } catch (error) {
            setRunError((error as Error).message)
        } finally {
            setRunningIds((previous) => { const next = new Set(previous); next.delete(workflowId); return next })
        }
    }, [runningIds, definitions, ensureOpportunityNames])

    const sendToGuidance = useCallback(async (runId: string, itemId: string, itemTitle: string, capability: AgentCapability) => {
        const key = `${runId}:${itemId}`
        setGuidanceByItem((previous) => ({ ...previous, [key]: { status: 'loading', title: itemTitle } }))
        try {
            const { handoff, response } = await dataClient.sendQueueItemToGuidance(runId, itemId, capability)
            setGuidanceByItem((previous) => ({ ...previous, [key]: { status: 'ready', title: itemTitle, evidenceIds: handoff.context.evidenceIds, content: response.content } }))
        } catch (error) {
            setGuidanceByItem((previous) => ({ ...previous, [key]: { status: 'error', title: itemTitle, error: (error as Error).message } }))
        }
    }, [])

    const selectPlay = useCallback((workflowId: string) => {
        setSelectedPlayId(workflowId)
        setRunError(undefined)
        setSelectedRunId(runs.find((run) => run.workflowId === workflowId)?.runId)
    }, [runs])

    const selectRun = useCallback((runId: string) => {
        setSelectedRunId(runId)
        const run = runs.find((candidate) => candidate.runId === runId)
        if (run) setSelectedPlayId(run.workflowId)
    }, [runs])

    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups((previous) => ({ ...previous, [key]: !previous[key] }))
    }, [])

    const dismissGuidance = useCallback((key: string) => {
        setGuidanceByItem((previous) => { const next = { ...previous }; delete next[key]; return next })
    }, [])

    useEffect(() => {
        if (runRequest && runRequest.token !== handledRunToken.current) {
            handledRunToken.current = runRequest.token
            void runPlay(runRequest.workflowId)
        }
    }, [runRequest, runPlay])

    const resolvers = useMemo<QueueNameResolvers>(() => ({
        accountName: (id?: string) => (id ? accountNames[id] : undefined),
        opportunityName: (id?: string) => (id ? opportunityIndex[id]?.name : undefined),
        accountForOpportunity: (id?: string) => {
            const accountId = id ? opportunityIndex[id]?.accountId : undefined
            if (!accountId) return undefined
            const name = accountNames[accountId]
            return name ? { id: accountId, name } : { id: accountId }
        }
    }), [accountNames, opportunityIndex])

    const playSections = useMemo(() => {
        const query = playQuery.trim().toLowerCase()
        const matches = (definitions.data ?? []).filter((definition) =>
            query.length === 0 || definition.name.toLowerCase().includes(query) || definition.id.toLowerCase().includes(query))
        return sectionPlaysByWorkflowNumber(matches)
    }, [definitions, playQuery])

    const selectedRun = runs.find((run) => run.runId === selectedRunId)
    const groups = useMemo<QueueGroup[]>(() => (selectedRun ? groupQueueByOpportunity(selectedRun.queue, resolvers) : []), [selectedRun, resolvers])
    const displayCard = useMemo(() => (selectedRun ? humanizeResultCard(selectedRun.card, resolvers) : undefined), [selectedRun, resolvers])

    // Move focus to the run header when a result is shown so screen readers announce the run context.
    useEffect(() => {
        if (selectedRunId) runHeaderRef.current?.focus()
    }, [selectedRunId])

    if (definitions.status === 'loading' || definitions.status === 'idle') return <p className="muted">Loading plays...</p>
    if (definitions.status === 'error') return <p className="error">Could not load plays: {definitions.error}</p>

    return (
        <div className="plays-workbench">
            <section className="plays-rail" aria-label="Plays">
                <div className="plays-rail-search">
                    <input
                        type="search"
                        className="plays-search-input"
                        placeholder="Search plays..."
                        aria-label="Search plays"
                        value={playQuery}
                        onChange={(event) => setPlayQuery(event.target.value)}
                    />
                </div>
                {playSections.length === 0 && <p className="muted">No plays match "{playQuery}".</p>}
                {playSections.map(({ key, category, definitions: defs }) => (
                    <div className="play-category" key={key}>
                        <div className="play-category-title section-heading">{categoryLabel(category)}</div>
                        <ul className="play-list" role="list">
                            {defs.map((definition) => {
                                const isRunning = runningIds.has(definition.id)
                                const isSelected = selectedPlayId === definition.id
                                const lastRun = runs.find((run) => run.workflowId === definition.id)
                                return (
                                    <li key={definition.id} className={`play-row${isSelected ? ' selected' : ''}`}>
                                        <button type="button" className="play-select" aria-pressed={isSelected} onClick={() => selectPlay(definition.id)}>
                                            <span className={`play-status-dot${isRunning ? ' running' : lastRun ? ' done' : ''}`} aria-hidden="true" />
                                            <span className="play-name">{definition.name}</span>
                                            <span className="badge">{definition.id}</span>
                                        </button>
                                        <PlayRoleOwners roles={definition.personaTargets} />
                                        <div className="play-row-actions">
                                            <PlayInfoTooltip workflowId={definition.id} name={definition.name} />
                                            <button className="primary play-run" disabled={isRunning} onClick={() => void runPlay(definition.id)}>
                                                {isRunning ? 'Running...' : lastRun ? 'Re-run' : 'Run'}
                                            </button>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ))}
            </section>
            <section className="plays-results" aria-label="Result">
                {runError && <p className="error results-error">{runError}</p>}
                {note && <p className="muted results-note" role="status">{note}</p>}
                {selectedRun ? (
                    <>
                        <header className="run-header" tabIndex={-1} ref={runHeaderRef}>
                            <div className="run-header-title">
                                <h3>{selectedRun.workflowName}</h3>
                                <span className="badge">{selectedRun.workflowId}</span>
                            </div>
                            <div className="run-header-meta">
                                <span>Portfolio</span>
                                <span aria-hidden="true">&middot;</span>
                                <span>as-of {selectedRun.asOf}</span>
                                <span aria-hidden="true">&middot;</span>
                                <span className="run-status ok">Completed</span>
                                <span aria-hidden="true">&middot;</span>
                                <span>{formatRunTime(selectedRun.ranAt)}</span>
                            </div>
                            <div className="run-metric-strip">
                                <span className="run-metric"><strong>{selectedRun.queue.length}</strong> items</span>
                                <span className="run-metric"><strong>{highPriorityCount(selectedRun.queue)}</strong> high priority</span>
                                <span className="run-metric"><strong>{groups.length}</strong> opportunities</span>
                            </div>
                        </header>
                        {runs.length > 1 && (
                            <div className="run-history" role="tablist" aria-label="Recent runs">
                                {runs.map((run) => (
                                    <button
                                        key={run.runId}
                                        type="button"
                                        role="tab"
                                        aria-selected={run.runId === selectedRunId}
                                        className={`run-tab${run.runId === selectedRunId ? ' active' : ''}`}
                                        onClick={() => selectRun(run.runId)}
                                    >
                                        <span className="run-tab-name">{run.workflowName}</span>
                                        <span className="run-tab-time">{formatRunTime(run.ranAt)}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="results-body">
                            <ResultCard card={displayCard ?? selectedRun.card} />
                            {!cardHasContent(selectedRun.card) && selectedRun.queue.length === 0 && (
                                <p className="muted">This play returned no items for the current scope.</p>
                            )}
                            {selectedRun.queue.length > 0 && (
                                <div className="queue">
                                    <h4>Operational queue</h4>
                                    {groups.map((group) => {
                                        const collapsed = Boolean(collapsedGroups[group.key])
                                        const capability = guidanceAgentFor(selectedRun.workflowId)
                                        const accountKnown = group.accountName !== 'Unassigned account'
                                        const primaryLabel = group.opportunityName ?? (accountKnown ? group.accountName : 'Portfolio-level items')
                                        const showSecondaryAccount = Boolean(group.opportunityName) && accountKnown
                                        return (
                                            <div className="queue-group" key={group.key}>
                                                <button type="button" className="queue-group-header" aria-expanded={!collapsed} onClick={() => toggleGroup(group.key)}>
                                                    <span className="disclosure" aria-hidden="true">{collapsed ? '\u25B8' : '\u25BE'}</span>
                                                    <span className="queue-group-oppty">{primaryLabel}</span>
                                                    {showSecondaryAccount && <span className="queue-group-account">{group.accountName}</span>}
                                                    <span className="badge count">{group.items.length}</span>
                                                </button>
                                                {!collapsed && (
                                                    <ul className="item-list queue-items" role="list">
                                                        {group.items.map((item) => {
                                                            const key = `${selectedRun.runId}:${item.id}`
                                                            const entry = guidanceByItem[key]
                                                            return (
                                                                <li key={item.id} className="queue-item">
                                                                    <div className="queue-item-row">
                                                                        <span className="queue-item-text"><span className={`badge priority ${priorityClass(item.priority)}`}>{item.priority}</span> {item.title}</span>
                                                                        {item.accountId && item.opportunityId && (
                                                                            <button
                                                                                className="send-agent"
                                                                                title={`Send this item to ${agentLabel(capability)}`}
                                                                                disabled={entry?.status === 'loading'}
                                                                                onClick={() => void sendToGuidance(selectedRun.runId, item.id, item.title, capability)}
                                                                            >
                                                                                {entry?.status === 'loading' ? 'Sending...' : `Send to ${agentLabel(capability)}`}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    {entry && (
                                                                        <div className="guidance-drawer">
                                                                            {entry.status === 'loading' && <p className="muted">Preparing {agentLabel(capability)} guidance...</p>}
                                                                            {entry.status === 'error' && <p className="error">{entry.error}</p>}
                                                                            {entry.status === 'ready' && (
                                                                                <>
                                                                                    <div className="guidance-drawer-head">
                                                                                        <h5>{agentLabel(capability)} guidance</h5>
                                                                                        <div className="guidance-drawer-actions">
                                                                                            <ResponseActions title={`${agentLabel(capability)} - ${item.title}`} markdown={entry.content ?? ''} onNote={setNote} />
                                                                                            <button type="button" className="drawer-close" aria-label="Dismiss guidance" onClick={() => dismissGuidance(key)}>&times;</button>
                                                                                        </div>
                                                                                    </div>
                                                                                    {entry.evidenceIds && entry.evidenceIds.length > 0 && (
                                                                                        <p className="muted">Evidence cited: {entry.evidenceIds.join(', ')}</p>
                                                                                    )}
                                                                                    <AgentMarkdown content={entry.content ?? ''} />
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </li>
                                                            )
                                                        })}
                                                    </ul>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="results-empty">
                        <p className="muted">{selectedPlayId ? 'Run this play to see results.' : 'Select a play and choose Run to see results.'}</p>
                        {selectedPlayId && (
                            <button className="primary" disabled={runningIds.has(selectedPlayId)} onClick={() => void runPlay(selectedPlayId)}>
                                {runningIds.has(selectedPlayId) ? 'Running...' : runError ? 'Try again' : 'Run play'}
                            </button>
                        )}
                    </div>
                )}
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

    const label = agentCapabilities.find((item) => item.id === capability)?.label ?? 'Guidance'

    return (
        <div>
            <GuidanceAgentTabs capability={capability} onSelect={setCapability} />
            <div className="prompt-suggestions" aria-label={`${label} suggested prompts`}>
                {suggestedPrompts[capability].map((prompt) => (
                    <button key={prompt} type="button" className="prompt-chip" disabled={agent.status === 'loading'} onClick={() => selectGuidancePrompt(prompt, setTaskPrompt, (selectedPrompt) => void runAgentPrompt(selectedPrompt))}>{prompt}</button>
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

const TASK_CATEGORIES = [
    'Architecture Design Session', 'Assessment', 'Blocker Escalation', 'Briefing', 'Call Back Requested',
    'Consumption Plan', 'Cross Segment', 'Cross Workload', 'Customer Engagement', 'Demo',
    'External (Co-creation of Value)', 'Internal', 'L300+ Demo', 'Negotiate Pricing', 'New Partner Request',
    'PoC/Pilot', 'Post Sales', 'Rapid Prototyping', 'RFP/RFI', 'Solution Whiteboarding', 'Tech Support',
    'Technical Close/Win Plan', 'Technical Workshop', 'Workshop'
] as const
const ACTIVITY_PRIORITIES = ['Low', 'Normal', 'High'] as const
const emptyActivityForm = { subject: '', taskCategory: '', due: '', priority: 'Normal' as 'Low' | 'Normal' | 'High', durationMinutes: '', description: '' }

/** Inline Activities (Tasks) panel for a milestone: list + a Quick-Create Task form. */
function MilestoneActivitiesPanel({ opportunityId, milestoneId, onNote }: { opportunityId: string; milestoneId: string; onNote: (message: string) => void }): ReactElement {
    const [activities, setActivities] = useState<MilestoneActivityView[]>([])
    const [loading, setLoading] = useState(true)
    const [form, setForm] = useState({ ...emptyActivityForm })
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let active = true
        setLoading(true)
        dataClient.listMilestoneActivities(opportunityId, milestoneId)
            .then((data) => { if (active) setActivities(data) })
            .catch((error: unknown) => { if (active) onNote(error instanceof Error ? error.message : 'Could not load activities.') })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [opportunityId, milestoneId, onNote])

    const create = useCallback(async () => {
        if (form.subject.trim().length === 0) return
        setSaving(true)
        try {
            const duration = form.durationMinutes.trim().length > 0 ? Number(form.durationMinutes) : undefined
            const request: CreateMilestoneActivityInput = {
                subject: form.subject.trim(),
                priority: form.priority,
                ...(form.taskCategory ? { taskCategory: form.taskCategory } : {}),
                ...(form.due ? { due: form.due } : {}),
                ...(duration !== undefined && Number.isFinite(duration) ? { durationMinutes: duration } : {}),
                ...(form.description.trim() ? { description: form.description.trim() } : {})
            }
            const created = await dataClient.createMilestoneActivity(opportunityId, milestoneId, request)
            setActivities((current) => [created, ...current])
            setForm({ ...emptyActivityForm })
        } catch (error) {
            onNote(error instanceof Error ? error.message : 'Could not create the task.')
        } finally {
            setSaving(false)
        }
    }, [form, opportunityId, milestoneId, onNote])

    return (
        <div className="milestone-activities-panel">
            <div className="milestone-activities-list" aria-busy={loading}>
                {loading && <span className="muted">Loading activities…</span>}
                {!loading && activities.length === 0 && <span className="muted">No activities yet. Create a task below.</span>}
                {activities.map((activity) => (
                    <div key={activity.id} className="milestone-activity-item">
                        <strong>{activity.subject}</strong>
                        <small>{activity.status}{activity.priority ? ` · ${activity.priority}` : ''}{activity.taskCategory ? ` · ${activity.taskCategory}` : ''}{activity.due ? ` · Due ${activity.due}` : ''}</small>
                    </div>
                ))}
            </div>
            <div className="milestone-activity-form">
                <label>Subject<input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} /></label>
                <label>Task Category<select value={form.taskCategory} onChange={(event) => setForm((current) => ({ ...current, taskCategory: event.target.value }))}><option value="">--Select--</option>{TASK_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                <label>Due<input type="date" value={form.due} onChange={(event) => setForm((current) => ({ ...current, due: event.target.value }))} /></label>
                <label>Priority<select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as 'Low' | 'Normal' | 'High' }))}>{ACTIVITY_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
                <label>Duration (minutes)<input type="number" min={1} value={form.durationMinutes} onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))} /></label>
                <label>Description<textarea rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <button className="primary" disabled={saving || form.subject.trim().length === 0} onClick={() => void create()}>{saving ? 'Creating…' : 'Create task'}</button>
            </div>
        </div>
    )
}

/** Milestones sub-list with sort control and five editable fields per milestone. */
function MilestonesEditor({ opportunityId, currency, milestones, onChanged, onNote }: { opportunityId: string; currency: string; milestones: MilestoneView[]; onChanged: () => void; onNote: (message: string) => void }): ReactElement {
    const [sortBy, setSortBy] = useState<MilestoneSort>('targetDate')
    const [direction, setDirection] = useState<SortDirection>('ascending')
    const [edit, setEdit] = useState<{ milestoneId: string; field: (typeof MILESTONE_FIELDS)[number]['id']; value: string } | undefined>(undefined)
    const [saving, setSaving] = useState(false)
    const [membershipBusyId, setMembershipBusyId] = useState<string | undefined>(undefined)
    const [activitiesForId, setActivitiesForId] = useState<string | undefined>(undefined)

    const sorted = sortMilestones(filterVisibleMilestones(milestones), sortBy, direction)

    const toggleMilestoneTeam = useCallback(async (milestone: MilestoneView) => {
        const joining = milestone.onMilestoneTeam !== true
        if (!joining && !window.confirm(`Remove yourself from the team for milestone "${milestone.name}"? If this is your only membership on the opportunity, the opportunity will leave your Portfolio.`)) return
        setMembershipBusyId(milestone.id)
        try {
            if (joining) await dataClient.joinMilestoneTeam(opportunityId, milestone.id)
            else await dataClient.leaveMilestoneTeam(opportunityId, milestone.id)
            onChanged()
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setMembershipBusyId(undefined)
        }
    }, [opportunityId, onChanged, onNote])

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
            <div className="milestone-table-wrap">
                <table className="record-table milestone-table">
                    <colgroup>
                        <col className="milestone-name-column" />
                        <col className="milestone-stage-column" />
                        <col className="milestone-comments-column" />
                    </colgroup>
                    <RecordTableHeader nameLabel="Milestone name" />
                    <tbody>
                {sorted.map((milestone) => (
                    <Fragment key={milestone.id}>
                        <tr>
                            <td className="milestone-name-cell">
                                <span className="milestone-name-row">
                                    <button
                                        type="button"
                                        className={`milestone-team-toggle ${milestone.onMilestoneTeam ? 'is-member' : ''}`}
                                        disabled={membershipBusyId === milestone.id}
                                        aria-pressed={milestone.onMilestoneTeam === true}
                                        title={milestone.onMilestoneTeam ? 'Remove me from milestone team' : 'Add me to milestone team'}
                                        aria-label={milestone.onMilestoneTeam ? `Remove me from the team for ${milestone.name}` : `Add me to the team for ${milestone.name}`}
                                        onClick={() => void toggleMilestoneTeam(milestone)}
                                    >{membershipBusyId === milestone.id ? '…' : milestone.onMilestoneTeam ? '−' : '+'}</button>
                                    <RecordTooltip {...milestoneTooltipContent(milestone, currency)}>
                                        {(tooltipId) => (
                                            <span className="record-name-trigger" tabIndex={0} aria-describedby={tooltipId}>
                                                <span className="record-name-line">
                                                    <strong>{milestone.name}</strong>
                                                    <span className="record-value">
                                                        {milestone.estimatedMonthlyUsage === undefined ? '-' : formatMoney(milestone.estimatedMonthlyUsage, currency)}
                                                    </span>
                                                </span>
                                            </span>
                                        )}
                                    </RecordTooltip>
                                </span>
                                <span className="milestone-meta">{milestone.targetDate ? `Due ${milestone.targetDate}` : 'No target date'} · {milestone.commitment ?? 'Uncommitted'}</span>
                                <div className="milestone-field-actions">
                                    {MILESTONE_FIELDS.filter((field) => field.id === 'targetDate' || field.id === 'customerCommitment' || field.id === 'riskDetails').map((field) => (
                                        <button key={field.id} className="table-field-button" onClick={() => setEdit({ milestoneId: milestone.id, field: field.id, value: milestoneFieldValue(milestone, field.id) })}>{field.label}</button>
                                    ))}
                                    <button className="table-field-button" aria-expanded={activitiesForId === milestone.id} onClick={() => setActivitiesForId((current) => current === milestone.id ? undefined : milestone.id)}>Activities</button>
                                </div>
                            </td>
                            <td><button className="table-field-button" onClick={() => setEdit({ milestoneId: milestone.id, field: 'status', value: milestone.status })}>{milestone.status}</button></td>
                            <td className="milestone-comments-cell"><CommentsButton title="Milestone comments" onClick={() => setEdit({ milestoneId: milestone.id, field: 'comments', value: milestone.comments ?? '' })} /></td>
                        </tr>
                        {edit && edit.milestoneId === milestone.id && (
                            <tr className="record-editor-row">
                                <td colSpan={3}>
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
                                </td>
                            </tr>
                        )}
                        {activitiesForId === milestone.id && (
                            <tr className="milestone-activities-row">
                                <td colSpan={3}>
                                    <MilestoneActivitiesPanel opportunityId={opportunityId} milestoneId={milestone.id} onNote={onNote} />
                                </td>
                            </tr>
                        )}
                    </Fragment>
                ))}
                        {milestones.length === 0 && <tr><td colSpan={3} className="muted">No milestones.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

/** Toggles membership of `id` in an immutable set (returns a new set). */
function toggleSet(previous: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
}

/** Renders a change-set proposal as Markdown for the Email / Word export actions. */
function meetingProposalToMarkdown(proposal: MeetingChangeSetProposalView, opportunityName: string): string {
    const lines = [`# Meeting signals - ${opportunityName}`, '', `Meeting type: ${proposal.meetingType}`, '', '## Proposed field changes', '', '| Apply | Field | Current | Proposed | MCEM | Confidence |', '| --- | --- | --- | --- | --- | --- |']
    for (const slot of proposal.slots) {
        lines.push(`| ${slot.checkedByDefault && !slot.blocked ? 'yes' : 'review'} | ${slot.label} | ${slot.displayBefore ?? '(empty)'} | ${slot.displayAfter} | ${slot.mcemCriterion} | ${Math.round(slot.confidence * 100)}% |`)
    }
    if (proposal.newMilestones.length > 0) {
        lines.push('', '## New milestones', '')
        for (const milestone of proposal.newMilestones) lines.push(`- ${milestone.name}${milestone.milestoneDate ? ` (${milestone.milestoneDate})` : ''}`)
    }
    if (proposal.unmappedSignals.length > 0) {
        lines.push('', '## Other signals (not injected)', '')
        for (const signal of proposal.unmappedSignals) lines.push(`- ${signal.label}: ${signal.text}`)
    }
    return lines.join('\n')
}

async function readFileIntoContent(event: ChangeEvent<HTMLInputElement>, setContent: (value: string) => void, onNote: (message: string) => void): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    try { setContent(await file.text()) }
    catch (error) { onNote((error as Error).message) }
}

/** Modal approval panel: per-row toggle, milestone multi-select, required reason, all-or-none submit. */
function MeetingReviewModal({ proposal, opportunityName, milestones, onClose, onApplied, onNote }: {
    proposal: MeetingChangeSetProposalView
    opportunityName: string
    milestones: MilestoneView[]
    onClose: () => void
    onApplied: () => void
    onNote: (message: string) => void
}): ReactElement {
    const [checkedSlots, setCheckedSlots] = useState<Set<string>>(() => new Set(proposal.slots.filter((slot) => slot.checkedByDefault && !slot.blocked).map((slot) => slot.slotId)))
    const [checkedNewMilestones, setCheckedNewMilestones] = useState<Set<string>>(() => new Set(proposal.newMilestones.filter((milestone) => milestone.checkedByDefault).map((milestone) => milestone.tempId)))
    const [selectedMilestones, setSelectedMilestones] = useState<Set<string>>(() => new Set(proposal.suggestedMilestoneIds))
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<MeetingChangeSetResultView | undefined>(undefined)

    const approvedCount = checkedSlots.size + checkedNewMilestones.size
    const canSubmit = approvedCount > 0 && reason.trim().length >= 3 && !busy
    const summaryMarkdown = meetingProposalToMarkdown(proposal, opportunityName)

    const submit = useCallback(async () => {
        setBusy(true)
        try {
            const applied = await dataClient.applyMeetingChangeSet(proposal, {
                changeSetId: proposal.changeSetId,
                opportunityId: proposal.opportunityId,
                approvedSlotIds: [...checkedSlots],
                approvedNewMilestoneTempIds: [...checkedNewMilestones],
                selectedMilestoneIds: [...selectedMilestones],
                reason: reason.trim()
            })
            setResult(applied)
            onNote(applied.state === 'applied' ? 'Meeting signals injected.' : 'Change set rolled back (a record changed since review).')
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [proposal, checkedSlots, checkedNewMilestones, selectedMilestones, reason, onNote])

    return (
        <div className="meeting-modal-backdrop" role="dialog" aria-modal="true" aria-label="Review meeting signals">
            <div className="meeting-modal">
                <header className="meeting-modal-header">
                    <div>
                        <h3>Review meeting signals</h3>
                        <p className="muted">{opportunityName} · {proposal.meetingType} meeting · {proposal.slots.length} proposed change{proposal.slots.length === 1 ? '' : 's'}</p>
                    </div>
                    <ResponseActions title={`Meeting signals - ${opportunityName}`} markdown={summaryMarkdown} onNote={onNote} />
                </header>

                {!result && (
                    <div className="meeting-modal-body">
                        <table className="record-table meeting-review-table">
                            <thead><tr><th>Apply</th><th>Field</th><th>Current &rarr; Proposed</th><th>MCEM</th><th>Conf.</th></tr></thead>
                            <tbody>
                                {proposal.slots.map((slot) => (
                                    <tr key={slot.slotId} className={slot.blocked ? 'blocked-row' : ''}>
                                        <td><input type="checkbox" aria-label={`Apply ${slot.label}`} disabled={slot.blocked} checked={checkedSlots.has(slot.slotId)} onChange={() => setCheckedSlots((previous) => toggleSet(previous, slot.slotId))} /></td>
                                        <td>
                                            <strong>{slot.label}</strong>{slot.sensitive && <span className="badge sensitive"> sensitive</span>}
                                            <span className="muted meeting-rationale">{slot.rationale}</span>
                                            {slot.blocked && slot.blockedReason && <span className="error meeting-rationale">{slot.blockedReason}</span>}
                                        </td>
                                        <td><span className="meeting-before">{slot.displayBefore ?? '(empty)'}</span> &rarr; <span className="meeting-after">{slot.displayAfter}</span></td>
                                        <td>{slot.mcemCriterion}</td>
                                        <td>{Math.round(slot.confidence * 100)}%<span className="muted"> · {slot.evidence.length} ref</span></td>
                                    </tr>
                                ))}
                                {proposal.slots.length === 0 && <tr><td colSpan={5} className="muted">No field changes detected in this meeting.</td></tr>}
                            </tbody>
                        </table>

                        {proposal.newMilestones.length > 0 && (
                            <section className="meeting-section">
                                <h4>New milestones</h4>
                                {proposal.newMilestones.map((milestone) => (
                                    <label key={milestone.tempId} className="meeting-check-row">
                                        <input type="checkbox" checked={checkedNewMilestones.has(milestone.tempId)} onChange={() => setCheckedNewMilestones((previous) => toggleSet(previous, milestone.tempId))} />
                                        <span><strong>{milestone.name}</strong>{milestone.milestoneDate ? ` · ${milestone.milestoneDate}` : ''} · {Math.round(milestone.confidence * 100)}%</span>
                                    </label>
                                ))}
                            </section>
                        )}

                        {milestones.length > 0 && (
                            <section className="meeting-section">
                                <h4>Apply milestone changes to</h4>
                                <p className="muted">Toggle the milestones this meeting updates. Milestone-targeted changes apply only to selected rows.</p>
                                {milestones.map((milestone) => (
                                    <label key={milestone.id} className="meeting-check-row">
                                        <input type="checkbox" checked={selectedMilestones.has(milestone.id)} onChange={() => setSelectedMilestones((previous) => toggleSet(previous, milestone.id))} />
                                        <span>{milestone.name} <span className="muted">· {milestone.status}</span></span>
                                    </label>
                                ))}
                            </section>
                        )}

                        {proposal.unmappedSignals.length > 0 && (
                            <section className="meeting-section">
                                <h4>Other signals (not injected)</h4>
                                <ul className="item-list">{proposal.unmappedSignals.map((signal, index) => <li key={index}><strong>{signal.label}:</strong> {signal.text}</li>)}</ul>
                            </section>
                        )}

                        <label className="meeting-reason">Reason (required)
                            <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why these updates (min 3 characters)..." />
                        </label>
                    </div>
                )}

                {result && (
                    <div className="meeting-modal-body">
                        <p className={result.state === 'applied' ? 'success' : 'error'}>
                            {result.state === 'applied' ? 'Applied' : 'Rolled back'} — {result.auditNote}
                        </p>
                        <ul className="item-list meeting-result-list">
                            {result.items.map((item) => (
                                <li key={item.id}>{item.state === 'applied' ? '✅' : item.state === 'conflict' ? '⚠' : '🚫'} {item.detail}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <footer className="meeting-modal-footer actions">
                    {!result && (
                        <>
                            <span className="muted meeting-selected-count">{approvedCount} selected</span>
                            <button className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
                            <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>{busy ? 'Submitting...' : 'Submit (all-or-none)'}</button>
                        </>
                    )}
                    {result && <button className="primary" onClick={() => (result.state === 'applied' ? onApplied() : onClose())}>{result.state === 'applied' ? 'Done' : 'Close'}</button>}
                </footer>
            </div>
        </div>
    )
}

/** Meeting-capture launcher shown in the Overview Milestones header (Teams pick or paste/upload). */
function MeetingCaptureLauncher({ opportunityId, opportunityName, milestones, onApplied, onNote }: {
    opportunityId: string
    opportunityName: string
    milestones: MilestoneView[]
    onApplied: () => void
    onNote: (message: string) => void
}): ReactElement {
    const [open, setOpen] = useState(false)
    const [transcripts, setTranscripts] = useState<MeetingTranscriptSummaryView[]>([])
    const [transcriptId, setTranscriptId] = useState('')
    const [tab, setTab] = useState<'pick' | 'paste'>('pick')
    const [pasteContent, setPasteContent] = useState('')
    const [meetingType, setMeetingType] = useState<MeetingTypeView>('customer')
    const [busy, setBusy] = useState(false)
    const [proposal, setProposal] = useState<MeetingChangeSetProposalView | undefined>(undefined)

    useEffect(() => {
        setOpen(false); setProposal(undefined); setPasteContent(''); setTranscriptId(''); setTab('pick')
        dataClient.listMeetingTranscripts(opportunityId)
            .then((list) => { setTranscripts(list); if (list[0]) setTranscriptId(list[0].id) })
            .catch(() => setTranscripts([]))
    }, [opportunityId])

    const canExtract = tab === 'paste' ? pasteContent.trim().length > 10 : transcriptId.length > 0

    const extract = useCallback(async () => {
        setBusy(true)
        try {
            const next = tab === 'paste'
                ? await dataClient.proposeMeetingFromRaw(opportunityId, pasteContent, meetingType)
                : await dataClient.proposeMeetingFromTranscript(opportunityId, transcriptId)
            setProposal(next)
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [tab, opportunityId, pasteContent, meetingType, transcriptId, onNote])

    return (
        <div className="meeting-launcher">
            <button className="secondary meeting-launch-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Meeting capture</button>
            {open && (
                <div className="meeting-launcher-panel">
                    <div className="meeting-launcher-tabs">
                        <button className={tab === 'pick' ? 'tab active' : 'tab'} onClick={() => setTab('pick')}>Teams meeting</button>
                        <button className={tab === 'paste' ? 'tab active' : 'tab'} onClick={() => setTab('paste')}>Paste / upload</button>
                    </div>
                    {tab === 'pick' && (transcripts.length > 0 ? (
                        <label className="meeting-field">Meeting
                            <select value={transcriptId} onChange={(event) => setTranscriptId(event.target.value)}>
                                {transcripts.map((transcript) => <option key={transcript.id} value={transcript.id}>{transcript.subject} ({transcript.meetingType}, {transcript.segmentCount} lines)</option>)}
                            </select>
                        </label>
                    ) : <p className="muted">No linked meeting transcripts. Use Paste / upload.</p>)}
                    {tab === 'paste' && (
                        <div className="meeting-paste">
                            <label className="meeting-field">Meeting type
                                <select value={meetingType} onChange={(event) => setMeetingType(event.target.value as MeetingTypeView)}>
                                    <option value="customer">Customer</option>
                                    <option value="internal">Internal</option>
                                </select>
                            </label>
                            <input type="file" accept=".vtt,.txt,text/vtt,text/plain" onChange={(event) => void readFileIntoContent(event, setPasteContent, onNote)} />
                            <textarea rows={4} placeholder="Paste a Teams transcript (WebVTT) or 'Speaker: text' lines..." value={pasteContent} onChange={(event) => setPasteContent(event.target.value)} />
                        </div>
                    )}
                    <div className="actions">
                        <button className="secondary" onClick={() => setOpen(false)}>Close</button>
                        <button className="primary" disabled={busy || !canExtract} onClick={() => void extract()}>{busy ? 'Extracting...' : 'Extract & Review'}</button>
                    </div>
                </div>
            )}
            {proposal && (
                <MeetingReviewModal
                    key={proposal.changeSetId}
                    proposal={proposal}
                    opportunityName={opportunityName}
                    milestones={milestones}
                    onClose={() => setProposal(undefined)}
                    onApplied={() => { setProposal(undefined); setOpen(false); onApplied() }}
                    onNote={onNote}
                />
            )}
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
                {mcemStages.map((stage) => {
                    const cards = opportunities.filter((opportunity) => opportunity.recordedStage === stage.id)
                    return (
                        <div key={stage.id} className="stage-column" aria-label={`Stage ${stage.id}: ${stage.name}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(stage.id, event)}>
                            <div className="stage-column-header">
                                <div className="stage-column-heading"><span>Stage {stage.id}</span><span className="badge">{cards.length}</span></div>
                                <strong>{stage.name}</strong>
                                <span className="stage-column-role">{stage.role}</span>
                            </div>
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

function PortfolioPanel({ focus, accountsExpanded, detailsExpanded, actionsExpanded }: {
    focus?: { accountId?: string | undefined; opportunityId?: string | undefined } | undefined
    accountsExpanded: boolean
    detailsExpanded: boolean
    actionsExpanded: boolean
}): ReactElement {
    const [accounts, setAccounts] = useState<Loadable<AccountView[]>>({ status: 'idle' })
    const [accountId, setAccountId] = useState<string | undefined>(undefined)
    const [opportunities, setOpportunities] = useState<OpportunityView[]>([])
    const [opportunityId, setOpportunityId] = useState<string | undefined>(undefined)
    const [milestones, setMilestones] = useState<MilestoneView[]>([])
    const [mcem, setMcem] = useState<Loadable<McemView>>({ status: 'idle' })
    const [sub, setSub] = useState<SubTab>('overview')
    const [note, setNote] = useState<string | undefined>(undefined)
    const [showHiddenAccounts, setShowHiddenAccounts] = useState(false)
    const [showAccountSearch, setShowAccountSearch] = useState(false)
    const [accountMatchBy, setAccountMatchBy] = useState<'name' | 'tpid'>('name')
    const [accountQuery, setAccountQuery] = useState('')
    const [accountCandidates, setAccountCandidates] = useState<AccountCandidateView[]>([])
    const [accountBusy, setAccountBusy] = useState(false)

    const loadAccounts = useCallback(async (includeHidden: boolean) => {
        setAccounts({ status: 'loading' })
        try {
            const data = await dataClient.listAccounts(includeHidden)
            setAccounts({ status: 'ready', data })
            const visible = data.filter((item) => item.visibility !== 'hidden')
            setAccountId((current) => current && visible.some((item) => item.id === current) ? current : visible[0]?.id)
        } catch (error) {
            setAccounts({ status: 'error', error: error instanceof Error ? error.message : 'Could not load accounts.' })
        }
    }, [])

    useEffect(() => {
        void loadAccounts(false)
    }, [loadAccounts])

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

    const searchAccounts = useCallback(async () => {
        setAccountBusy(true)
        setNote(undefined)
        try {
            setAccountCandidates(await dataClient.searchAccounts(accountQuery, accountMatchBy))
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Account search failed.')
        } finally {
            setAccountBusy(false)
        }
    }, [accountMatchBy, accountQuery])

    const addOrUnhideAccount = useCallback(async (candidate: AccountCandidateView) => {
        setAccountBusy(true)
        setNote(undefined)
        try {
            if (candidate.state === 'hidden') await dataClient.setAccountVisibility(candidate.id, 'visible')
            else if (candidate.state === 'not-added') await dataClient.addAccount(candidate.id)
            await loadAccounts(showHiddenAccounts)
            setShowAccountSearch(false)
            setAccountQuery('')
            setAccountCandidates([])
            setAccountId(candidate.id)
            setNote(`${candidate.name} is now available in Portfolio and Discovery. Use Discovery to add its opportunities to your Deal Team working set.`)
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not add account.')
        } finally {
            setAccountBusy(false)
        }
    }, [loadAccounts, showHiddenAccounts])

    const changeAccountVisibility = useCallback(async (item: AccountView, visibility: 'visible' | 'hidden') => {
        if (visibility === 'hidden' && !window.confirm(`Hide ${item.name} from Portfolio, Discovery, Plays, and downstream analysis? Deal Team membership will not change.`)) return
        setAccountBusy(true)
        setNote(undefined)
        try {
            await dataClient.setAccountVisibility(item.id, visibility)
            await loadAccounts(showHiddenAccounts)
            setNote(`${item.name} was ${visibility === 'hidden' ? 'hidden' : 'unhidden'}.`)
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not change account visibility.')
        } finally {
            setAccountBusy(false)
        }
    }, [loadAccounts, showHiddenAccounts])

    if (accounts.status === 'loading' || accounts.status === 'idle') return <p className="muted">Loading portfolio...</p>
    if (accounts.status === 'error') return <p className="error">Could not load accounts: {accounts.error}</p>

    return (
        <div className={portfolioLayoutClassName({ accountsExpanded, detailsExpanded, actionsExpanded })}>
            {accountsExpanded && <section id="portfolio-accounts-panel" className="pane">
                <div className="account-management-header"><h3 className="section-heading">Accounts</h3><div>
                    <button className="secondary" onClick={() => setShowAccountSearch((current) => !current)}>Add customer</button>
                    <button className="link" onClick={() => { const next = !showHiddenAccounts; setShowHiddenAccounts(next); void loadAccounts(next) }}>{showHiddenAccounts ? 'Hide hidden' : 'Show hidden'}</button>
                </div></div>
                {showAccountSearch && <div className="account-search-box">
                    <label>Search by
                        <select value={accountMatchBy} onChange={(event) => { setAccountMatchBy(event.target.value as 'name' | 'tpid'); setAccountCandidates([]) }}>
                            <option value="name">Account name</option>
                            <option value="tpid">TPID</option>
                        </select>
                    </label>
                    <label>{accountMatchBy === 'name' ? 'Account name' : 'TPID'}
                        <input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchAccounts() }} />
                    </label>
                    <button disabled={accountBusy || (accountMatchBy === 'name' ? accountQuery.trim().length < 2 : !accountQuery.trim())} onClick={() => void searchAccounts()}>{accountBusy ? 'Searching...' : 'Search'}</button>
                    <div className="account-candidates">
                        {accountCandidates.map((candidate) => <div key={candidate.id}><span><strong>{candidate.name}</strong><small>{candidate.tpid ? `TPID ${candidate.tpid}` : candidate.segment}</small></span><button disabled={accountBusy || candidate.state === 'visible'} onClick={() => void addOrUnhideAccount(candidate)}>{candidate.state === 'visible' ? 'Already added' : candidate.state === 'hidden' ? 'Unhide' : 'Add'}</button></div>)}
                    </div>
                </div>}
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    {accounts.data?.filter((item) => item.visibility !== 'hidden').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                {showHiddenAccounts && <div className="hidden-account-list">{accounts.data?.filter((item) => item.visibility === 'hidden').map((item) => <div key={item.id}><span>{item.name} <small>Hidden</small></span><button className="link" disabled={accountBusy} onClick={() => void changeAccountVisibility(item, 'visible')}>Unhide</button></div>)}</div>}
                {accountId && <button className="link" disabled={accountBusy} onClick={() => { const item = accounts.data?.find((candidate) => candidate.id === accountId); if (item) void changeAccountVisibility(item, 'hidden') }}>Hide selected customer</button>}
                <h3 className="section-heading">Opportunities</h3>
                {opportunities.length === 0 && <p className="muted">No Deal Team opportunities. Use Discovery to add yourself to an active opportunity.</p>}
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
                <div className="opportunity-table-wrap">
                    <table className="record-table opportunity-table">
                        <colgroup>
                            <col className="opportunity-name-column" />
                            <col className="opportunity-stage-column" />
                            <col className="opportunity-comments-column" />
                        </colgroup>
                        <RecordTableHeader nameLabel="Opportunity name" />
                        <tbody>
                            {sortedOpportunities.map((opportunity) => (
                                <Fragment key={opportunity.id}>
                                    <tr className={opportunity.id === opportunityId ? 'selected' : undefined}>
                                        <td className="opportunity-name-cell">
                                            <RecordTooltip {...opportunityTooltipContent(opportunity)}>
                                                {(tooltipId) => (
                                                    <button className={opportunity.id === opportunityId ? 'link record-link active' : 'link record-link'} aria-describedby={tooltipId} onClick={() => setOpportunityId(opportunity.id)}>
                                                        <span className="record-name-line">
                                                            <span className="record-name-text">{opportunity.name}</span>
                                                            <span className="record-value">{formatMoney(opportunity.value, opportunity.currency)}</span>
                                                        </span>
                                                    </button>
                                                )}
                                            </RecordTooltip>
                                        </td>
                                        <td><span className="badge">Stage {opportunity.recordedStage}</span></td>
                                        <td className="opportunity-comments-cell"><CommentsButton title="Opportunity comments" onClick={() => { setCommentsFor(opportunity.id); setCommentsText(opportunity.comments ?? '') }} /></td>
                                    </tr>
                                    {commentsFor === opportunity.id && (
                                        <tr className="record-editor-row">
                                            <td colSpan={3}>
                                                <div className="record-editor">
                                                    <label>Opportunity comments</label>
                                                    <textarea rows={2} value={commentsText} onChange={(event) => setCommentsText(event.target.value)} />
                                                    <div className="actions">
                                                        <button className="secondary" disabled={savingComments} onClick={() => setCommentsFor(undefined)}>Cancel</button>
                                                        <button className="primary" disabled={savingComments} onClick={() => void saveComments(opportunity.id)}>{savingComments ? 'Saving...' : 'Save'}</button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>}
            {(detailsExpanded || actionsExpanded) && <div className={`portfolio-workbench${detailsExpanded ? '' : ' details-collapsed'}${actionsExpanded ? '' : ' actions-collapsed'}`}>
            {detailsExpanded && <section id="portfolio-details-panel" className="pane portfolio-details-pane">
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
                                <div className="section-heading-row">
                                    <h4 className="section-heading">Milestones</h4>
                                    <MeetingCaptureLauncher opportunityId={selectedOpportunity.id} opportunityName={selectedOpportunity.name} milestones={milestones} onApplied={reloadMilestones} onNote={setNote} />
                                </div>
                                <MilestonesEditor opportunityId={selectedOpportunity.id} currency={selectedOpportunity.currency} milestones={milestones} onChanged={reloadMilestones} onNote={setNote} />
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
            </section>}
            {actionsExpanded && selectedOpportunity && (
                <NextBestActions
                    evaluation={mcem.status === 'ready' ? mcem.data : undefined}
                    loading={mcem.status === 'loading'}
                    error={mcem.status === 'error' ? mcem.error : undefined}
                    onRun={() => void runCoach()}
                />
            )}
            </div>}
        </div>
    )
}

const SE_DOMAINS: ReadonlyArray<{ id: SeDomainView; label: string }> = [
    { id: 'infra', label: 'Infrastructure' },
    { id: 'data', label: 'Data' },
    { id: 'ai-apps', label: 'AI & Apps' },
    { id: 'security', label: 'Security' },
    { id: 'modern-work', label: 'Modern Work' },
    { id: 'biz-apps', label: 'BizApps / Power Platform / D365' },
    { id: 'devices', label: 'Devices / Mixed Reality' },
    { id: 'services', label: 'Services' }
]

/** Discover tab: lists open opportunities for an SE domain with one-click deal-team join. */
function DiscoverPanel(): ReactElement {
    const [domain, setDomain] = useState<SeDomainView>('infra')
    const [refreshVersion, setRefreshVersion] = useState(0)
    const [items, setItems] = useState<Loadable<DiscoverableOpportunityView[]>>({ status: 'idle' })
    const [filters, setFilters] = useState<DiscoveryFilters>({ include: [], exclude: [] })
    const [sort, setSort] = useState<DiscoverySort | null>(null)
    const [joining, setJoining] = useState<string | undefined>(undefined)
    const [note, setNote] = useState<string | undefined>(undefined)
    const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
    const [discoverMilestones, setDiscoverMilestones] = useState<Record<string, MilestoneView[]>>({})
    const [milestonesLoadingId, setMilestonesLoadingId] = useState<string | undefined>(undefined)
    const [milestoneBusyId, setMilestoneBusyId] = useState<string | undefined>(undefined)
    const opportunities = items.data ?? []
    const visibleOpportunities = sortDiscoveryOpportunities(filterDiscoveryOpportunities(opportunities, filters), sort)
    const displayedDiscoverMilestones = (opportunityId: string): MilestoneView[] =>
        filterVisibleMilestones(discoverMilestones[opportunityId] ?? [])

    useEffect(() => {
        let active = true
        setItems({ status: 'loading' })
        dataClient.discoverOpportunities(domain)
            .then((data) => { if (active) setItems({ status: 'ready', data }) })
            .catch((error: unknown) => { if (active) setItems({ status: 'error', error: error instanceof Error ? error.message : 'Discovery failed.' }) })
        return () => { active = false }
    }, [domain, refreshVersion])

    const join = async (opportunityId: string): Promise<void> => {
        setJoining(opportunityId)
        setNote(undefined)
        try {
            const result = await dataClient.joinDealTeam(opportunityId)
            setItems((current) => current.status === 'ready' && current.data
                ? { status: 'ready', data: current.data.map((item) => item.id === opportunityId ? { ...item, onDealTeam: result.onDealTeam } : item) }
                : current)
            setNote(result.alreadyMember ? 'You were already on this deal team.' : 'Added you to the deal team. It now appears in your portfolio.')
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not join the deal team.')
        } finally {
            setJoining(undefined)
        }
    }

    const leave = async (item: DiscoverableOpportunityView): Promise<void> => {
        if (!window.confirm(`Remove yourself from the Deal Team for "${item.name}"? It will be removed from Portfolio and downstream analysis.`)) return
        setJoining(item.id)
        setNote(undefined)
        try {
            const result = await dataClient.leaveDealTeam(item.id)
            setItems((current) => current.status === 'ready' && current.data
                ? { status: 'ready', data: current.data.map((candidate) => candidate.id === item.id ? { ...candidate, onDealTeam: result.onDealTeam } : candidate) }
                : current)
            setNote(result.alreadyAbsent ? 'You were already absent from this Deal Team.' : 'Removed you from the Deal Team and downstream working set.')
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not leave the Deal Team.')
        } finally {
            setJoining(undefined)
        }
    }

    const toggleExpand = async (opportunityId: string): Promise<void> => {
        if (expandedId === opportunityId) { setExpandedId(undefined); return }
        setExpandedId(opportunityId)
        if (discoverMilestones[opportunityId]) return
        setMilestonesLoadingId(opportunityId)
        try {
            const data = await dataClient.listDiscoverableMilestones(opportunityId)
            setDiscoverMilestones((current) => ({ ...current, [opportunityId]: data }))
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not load milestones.')
        } finally {
            setMilestonesLoadingId(undefined)
        }
    }

    const toggleMilestone = async (opportunityId: string, milestone: MilestoneView): Promise<void> => {
        const joiningMilestone = milestone.onMilestoneTeam !== true
        if (!joiningMilestone && !window.confirm(`Remove yourself from the team for milestone "${milestone.name}"? If this is your only membership on the opportunity, the opportunity will leave your Portfolio.`)) return
        setMilestoneBusyId(milestone.id)
        setNote(undefined)
        try {
            if (joiningMilestone) await dataClient.joinMilestoneTeam(opportunityId, milestone.id)
            else await dataClient.leaveMilestoneTeam(opportunityId, milestone.id)
            setDiscoverMilestones((current) => ({
                ...current,
                [opportunityId]: (current[opportunityId] ?? []).map((item) => item.id === milestone.id ? { ...item, onMilestoneTeam: joiningMilestone } : item)
            }))
            setNote(joiningMilestone ? 'Added you to the milestone team. The opportunity now appears in your portfolio.' : 'Removed you from the milestone team.')
        } catch (error) {
            setNote(error instanceof Error ? error.message : 'Could not update the milestone team.')
        } finally {
            setMilestoneBusyId(undefined)
        }
    }

    return (
        <section className="discover-panel" aria-label="Discover opportunities">
            <header className="discover-header">
                <h2>Discover opportunities</h2>
                <p>Review all active opportunities for visible accounts and add or remove yourself from the Deal Team — or expand an opportunity to join a milestone team without joining the Deal Team. Deal Team or milestone-team membership brings an opportunity into Portfolio.</p>
                <div className="discover-domain-toolbar">
                    <nav className="tabs" role="tablist" aria-label="Solution Engineer domain">
                        {SE_DOMAINS.map((option) => (
                            <button key={option.id} role="tab" aria-selected={domain === option.id} className={domain === option.id ? 'tab active' : 'tab'} onClick={() => setDomain(option.id)}>{option.label}</button>
                        ))}
                    </nav>
                    <button className="secondary" disabled={items.status === 'loading'} onClick={() => setRefreshVersion((version) => version + 1)}>Refresh</button>
                </div>
            </header>
            <DiscoveryControls customers={discoveryCustomers(opportunities)} filters={filters} onChange={setFilters} visibleCount={visibleOpportunities.length} totalCount={opportunities.length} loading={items.status === 'idle' || items.status === 'loading'} />
            {note && <p className="discover-note" role="status">{note}</p>}
            {items.status === 'loading' && <p>Loading opportunities…</p>}
            {items.status === 'error' && <p className="error-text">{items.error}</p>}
            {items.status === 'ready' && items.data && items.data.length === 0 && <p>No active opportunities were found for this domain.</p>}
            {items.status === 'ready' && opportunities.length > 0 && visibleOpportunities.length === 0 && <p role="status">No opportunities match your customer filters. Clear filters to show all customers.</p>}
            {items.status === 'ready' && visibleOpportunities.length > 0 && (
                <div className="opportunity-table-wrap">
                    <table className="record-table" aria-label="Discovered opportunities">
                        <thead><tr><th scope="col">Opportunity</th><DiscoverySortHeader column="account" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} /><th scope="col">Technical capability</th><DiscoverySortHeader column="stage" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} /><DiscoverySortHeader column="action" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} /></tr></thead>
                        <tbody>
                            {visibleOpportunities.map((item) => (
                                <Fragment key={item.id}>
                                <tr>
                                    <td><span className="discover-name-cell">
                                        <button className="discover-expand" aria-expanded={expandedId === item.id} aria-label={`${expandedId === item.id ? 'Hide' : 'Show'} milestones for ${item.name}`} title={expandedId === item.id ? 'Hide milestones' : 'Show milestones'} onClick={() => void toggleExpand(item.id)}>{expandedId === item.id ? '▾' : '▸'}</button>
                                        <strong>{item.name}</strong>
                                    </span></td>
                                    <td>{item.accountName ?? '-'}</td>
                                    <td>{item.technicalCapability ?? '-'}</td>
                                    <td>{item.recordedStage}</td>
                                    <td>
                                        {item.onDealTeam
                                            ? <span className="deal-team-actions"><span className="deal-team-joined">On deal team</span><button className="link danger-link" disabled={joining === item.id} onClick={() => void leave(item)}>{joining === item.id ? 'Removing…' : 'Remove me'}</button></span>
                                            : <button className="tab" disabled={joining === item.id} onClick={() => void join(item.id)}>{joining === item.id ? 'Adding…' : 'Add me'}</button>}
                                    </td>
                                </tr>
                                {expandedId === item.id && (
                                    <tr className="discover-milestones-row" aria-label={`${item.name} milestones`}>
                                        <td colSpan={5}>
                                            {milestonesLoadingId === item.id && <span className="muted">Loading milestones…</span>}
                                            {milestonesLoadingId !== item.id && displayedDiscoverMilestones(item.id).length === 0 && <span className="muted">No milestones found for this opportunity.</span>}
                                            {displayedDiscoverMilestones(item.id).map((milestone) => (
                                                <div key={milestone.id} className="discover-milestone-item">
                                                    <button
                                                        type="button"
                                                        className={`milestone-team-toggle ${milestone.onMilestoneTeam ? 'is-member' : ''}`}
                                                        disabled={milestoneBusyId === milestone.id}
                                                        aria-pressed={milestone.onMilestoneTeam === true}
                                                        title={milestone.onMilestoneTeam ? 'Remove me from milestone team' : 'Add me to milestone team'}
                                                        aria-label={milestone.onMilestoneTeam ? `Remove me from the team for ${milestone.name}` : `Add me to the team for ${milestone.name}`}
                                                        onClick={() => void toggleMilestone(item.id, milestone)}
                                                    >{milestoneBusyId === milestone.id ? '…' : milestone.onMilestoneTeam ? '−' : '+'}</button>
                                                    <span><strong>{milestone.name}</strong> · {milestone.status}{milestone.targetDate ? ` · ${milestone.targetDate}` : ''}</span>
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

export function App(): ReactElement {
    const [tab, setTab] = useState<Tab>('portfolio')
    const [mode, setMode] = useState<'sample' | 'live'>(() => (document.getElementById('root')?.dataset.mode as 'sample' | 'live') ?? 'sample')
    const [focus, setFocus] = useState<{ accountId?: string | undefined; opportunityId?: string | undefined } | undefined>(undefined)
    const [runRequest, setRunRequest] = useState<{ workflowId: string; token: number } | undefined>(undefined)
    const [accountsExpanded, setAccountsExpanded] = useState(true)
    const [detailsExpanded, setDetailsExpanded] = useState(true)
    const [actionsExpanded, setActionsExpanded] = useState(true)

    useEffect(() => {
        onHostMessage((message) => {
            if (message.kind === 'event') setMode(message.payload.mode)
            else if (message.kind === 'focus') { setTab('portfolio'); setFocus({ accountId: message.accountId, opportunityId: message.opportunityId }) }
            else if (message.kind === 'runPlay') { setTab('plays'); setRunRequest({ workflowId: message.workflowId, token: message.token }) }
        })
    }, [])

    return (
        <div className="app">
            <AppHeader
                tab={tab}
                mode={mode}
                accountsExpanded={accountsExpanded}
                detailsExpanded={detailsExpanded}
                actionsExpanded={actionsExpanded}
                onSelectTab={setTab}
                onToggleAccounts={() => setAccountsExpanded((current) => !current)}
                onToggleDetails={() => setDetailsExpanded((current) => !current)}
                onToggleActions={() => setActionsExpanded((current) => !current)}
                onOpenIssue={dataClient.openEvidence}
            />
            <main className={`app-body${tab === 'plays' ? ' app-body--plays' : ''}`}>
                {tab === 'portfolio' ? (
                    <PortfolioPanel focus={focus} accountsExpanded={accountsExpanded} detailsExpanded={detailsExpanded} actionsExpanded={actionsExpanded} />
                ) : tab === 'discover' ? <DiscoverPanel /> : <PlaysPanel runRequest={runRequest} />}
            </main>
        </div>
    )
}
