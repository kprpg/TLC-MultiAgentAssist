import { useEffect, useMemo, useRef, useState } from 'react'
import { app } from '@microsoft/teams-js'
import * as c from '../../../../packages/common/contracts/index.js'
import { NextBestActions } from '../../../shared/next-best-actions.js'
import { MsxOpportunityLink } from '../../../shared/msx-opportunity-link.js'
import { sortMilestones, type MilestoneSort, type SortDirection } from '../../../shared/portfolio-sorting.js'
import { GuidanceWorkspace } from './guidance-workspace.js'
import { MilestoneCard, OpportunityCommentsEditor, StageChange } from './record-actions.js'
import type { TeamsApiClient } from './data-client.js'
import type { WorkingSelection } from './accounts.js'
import type { PortfolioPanes } from './workspace-navigation.js'
import { useResponsiveDisclosure } from './use-responsive-disclosure.js'
import { TeamsMcemStageBoard } from './mcem-stage-board.js'
import { ResizableSplit } from '../../../shared/resizable-split.js'

export type DetailTab = 'overview' | 'guidance' | 'stages'
const tabs: Array<{ id: DetailTab; label: string }> = [{ id: 'overview', label: 'Overview' }, { id: 'guidance', label: 'Guidance' }, { id: 'stages', label: 'MCEM Stages' }]

async function openOpportunityInBrowser(url: string): Promise<void> {
  if (app.isInitialized()) {
    await app.openLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function OpportunityWorkbench({ client, selection, opportunities, milestones, panes, tab, onTabChange, onSelectOpportunity, onAction, onMeeting, onDraftChange }: {
  client: TeamsApiClient; selection: WorkingSelection; opportunities: c.Opportunity[]; milestones: c.Milestone[]; panes: PortfolioPanes
  tab: DetailTab; onTabChange(tab: DetailTab): void; onSelectOpportunity(id: string): void
  onAction(operation: string, input: Record<string, unknown>): Promise<void>
  onMeeting(): void; onDraftChange(): void
}) {
  const [evaluation, setEvaluation] = useState<c.McemResponse>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<MilestoneSort>('targetDate')
  const [direction, setDirection] = useState<SortDirection>('ascending')
  const sortedMilestones = useMemo(() => sortMilestones(milestones, sort, direction), [milestones, sort, direction])
  const request = useRef<AbortController | null>(null)
  const actionDisclosure = useResponsiveDisclosure(1200, panes.actionsExpanded)
  useEffect(() => () => request.current?.abort(), [])
  async function runCoach() {
    if (busy) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      const result = await client.operation('runMcemCoach', {
        contractVersion: c.contractVersion, accountId: selection.account.id,
        opportunityId: selection.opportunity.id, prompt: 'Review stage readiness and role-owned next best actions.'
      }, c.mcemResponseSchema, controller.signal)
      if (!controller.signal.aborted) setEvaluation(result)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function openEvidence(url: string) {
    try {
      if (new URL(url).protocol !== 'https:') throw new Error('Only HTTPS evidence links can be opened.')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (cause) { setError(String(cause)) }
  }
  return <ResizableSplit className="opportunity-workbench" label="opportunity details panel" controls="portfolio-details-panel"
    defaultRatio={2 / 3} minFirst={320} minSecond={240} firstVisible={panes.detailsExpanded} secondVisible={panes.actionsExpanded}>
    <section id="portfolio-details-panel" className="pane opportunity-details pane-scroll" hidden={!panes.detailsExpanded} aria-label="Opportunity details">
      <header className="opportunity-heading"><h2><MsxOpportunityLink opportunity={selection.opportunity} onOpen={openOpportunityInBrowser} onError={setError} /></h2>
        <p className="muted">{selection.account.name} | Owner: {selection.opportunity.owner ?? 'Account team'} | Stage {selection.opportunity.recordedStage} | Close: {selection.opportunity.closeDate}</p>
      </header>
      <nav className="detail-tabs" role="tablist" aria-label="Opportunity sections">
        {tabs.map((item, index) => <button key={item.id} id={`detail-tab-${item.id}`} role="tab" type="button"
          aria-selected={tab === item.id} aria-controls={`detail-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
          onClick={() => onTabChange(item.id)} onKeyDown={(event) => {
            const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined
            if (next) { event.preventDefault(); onTabChange(next.id); document.getElementById(`detail-tab-${next.id}`)?.focus() }
          }}>{item.label}</button>)}
      </nav>
      <div onChangeCapture={(event) => { if (event.target instanceof Element && event.target.closest('.field')) onDraftChange() }}>
        <section id="detail-overview" role="tabpanel" aria-labelledby="detail-tab-overview" hidden={tab !== 'overview'}>
          <div className="section-heading"><h3>Milestones</h3><button type="button" onClick={onMeeting}>Meeting capture</button></div>
          <div className="toolbar"><label>Sort milestones<select value={sort} onChange={(event) => {
            const value = event.target.value
            if (value === 'targetDate' || value === 'status' || value === 'estimatedMonthlyUsage' || value === 'commitment') setSort(value)
          }}><option value="targetDate">Est. Date</option><option value="estimatedMonthlyUsage">Value</option><option value="commitment">Commitment</option><option value="status">Status</option></select></label>
            <button type="button" onClick={() => setDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}>{direction === 'ascending' ? 'Asc' : 'Desc'}</button></div>
          {sortedMilestones.map((item) => <MilestoneCard key={`${item.id}:${JSON.stringify(item)}`} client={client} milestone={item} onAction={onAction} />)}
          {!milestones.length && <p>No milestones are visible in this scope.</p>}
          <details className="source-editor"><summary>Opportunity notes and reviewed updates</summary>
            <OpportunityCommentsEditor opportunity={selection.opportunity} onAction={onAction} onDraftChange={onDraftChange} />
            {tab !== 'stages' && <StageChange selection={selection} onAction={onAction} />}
          </details>
        </section>
        <section id="detail-guidance" role="tabpanel" aria-labelledby="detail-tab-guidance" hidden={tab !== 'guidance'}>
          <GuidanceWorkspace client={client} selection={selection} />
        </section>
        <section id="detail-stages" role="tabpanel" aria-labelledby="detail-tab-stages" hidden={tab !== 'stages'}>
          {tab === 'stages' && <TeamsMcemStageBoard accountName={selection.account.name} opportunities={opportunities} selectedId={selection.opportunity.id}
            evaluation={evaluation} onSelect={onSelectOpportunity} />}
          <h3>Stage readiness</h3>
          <p>Recorded stage {selection.opportunity.recordedStage}{evaluation ? ` | Evidence-based stage ${evaluation.evidenceBasedStage} | ${evaluation.state}` : ' | Run MCEM Coach to evaluate the current evidence.'}</p>
          <button type="button" className="primary" disabled={busy} onClick={() => { void runCoach() }}>{busy ? 'Evaluating...' : 'Run MCEM Coach'}</button>
          {evaluation && <><p>{evaluation.summary}</p><p className="muted">Source checked {new Date(evaluation.generatedAt).toLocaleString()} - {evaluation.mode}</p>
            <ul className="criteria-list">{evaluation.criteria.map((criterion) => <li key={criterion.id}><strong>{criterion.status}: {criterion.label}</strong><p>{criterion.rationale}</p><small>Evidence: {criterion.evidenceIds.join(', ') || 'Not available'}</small></li>)}</ul>
            {evaluation.missingData.length > 0 && <p className="warning">Missing information: {evaluation.missingData.join('; ')}</p>}
          </>}
          {tab === 'stages' && <StageChange selection={selection} onAction={onAction} />}
        </section>
      </div>
      {busy && <p role="status">Evaluating current MCEM evidence...</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
    </section>
    <details className="recommendations-region pane-scroll" ref={actionDisclosure} open hidden={!panes.actionsExpanded}><summary className="pane-disclosure-toggle">Next Best Actions and evidence</summary>
      <NextBestActions evaluation={evaluation} loading={busy} error={error || undefined} onRun={() => { void runCoach() }} onOpenEvidence={openEvidence} />
      {evaluation && <p className="muted">Checked {new Date(evaluation.generatedAt).toLocaleString()} - {evaluation.state}</p>}
    </details>
  </ResizableSplit>
}
