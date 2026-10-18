import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import * as c from '../../../../packages/common/contracts/index.js'
import { seDomainDefinitions, seDomainIds, seDomainSchema, type SeDomainId } from '../../../../packages/common/configuration/se-domains.js'
import { AddCustomerButton, type CustomerAccount, type CustomerSearchClient } from '../../../shared/add-customer.js'
import { NewWorkspace, type CreationClient } from '../../../shared/record-creation/new-workspace.js'
import { suggestedPrompts } from '../../../shared/prompt-catalog.js'
import type { TeamsApiClient, ReviewAction } from './data-client.js'
import { AgentResultView } from './result-view.js'
import { formatResponseMarkdown } from '../../../shared/response-markdown.js'

export interface WorkingSelection { account: c.Account; opportunity: c.Opportunity }
function customerView(account: c.Account): CustomerAccount {
  return { id: account.id, name: account.name, segment: account.segment, ...(account.tpid === undefined ? {} : { tpid: account.tpid }) }
}
export function AccountsWorkspace({ client, mode, selection, onSelect, review, preferredAccountId, boundAccountId }: {
  client: TeamsApiClient; mode: 'sample' | 'live'; selection: WorkingSelection | null
  onSelect(selection: WorkingSelection | null): void; review: ReviewAction
  preferredAccountId?: string; boundAccountId?: string
}) {
  const [accounts, setAccounts] = useState<c.Account[]>([])
  const [accountId, setAccountId] = useState(selection?.account.id ?? preferredAccountId ?? '')
  const [opportunities, setOpportunities] = useState<c.Opportunity[]>([])
  const [milestones, setMilestones] = useState<c.Milestone[]>([])
  const [notes, setNotes] = useState(selection?.opportunity.comments ?? '')
  const [tab, setTab] = useState<'portfolio' | 'discovery' | 'new'>('portfolio')
  const [domain, setDomain] = useState<SeDomainId>('infra')
  const [discovery, setDiscovery] = useState<c.DiscoverableOpportunity[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    client.operation('listAccounts', {}, z.array(c.accountSchema), controller.signal).then((items) => {
      const scoped = boundAccountId ? items.filter((item) => item.id === boundAccountId) : items
      setAccounts(scoped)
      setAccountId((current) => scoped.some((entry) => entry.id === current) ? current : scoped[0]?.id ?? '')
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, revision, boundAccountId])
  useEffect(() => { if (preferredAccountId) setAccountId(preferredAccountId) }, [preferredAccountId])
  useEffect(() => {
    if (!accountId) return
    const controller = new AbortController()
    client.operation('listOpportunities', { accountId }, z.array(c.opportunitySchema), controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setOpportunities(items)
      const account = accounts.find((item) => item.id === accountId)
      const opportunity = items.find((item) => item.id === selection?.opportunity.id) ?? items[0]
      onSelect(account && opportunity ? { account, opportunity } : null)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, accountId, accounts, revision])
  useEffect(() => {
    setNotes(selection?.opportunity.comments ?? '')
    if (!selection) { setMilestones([]); return }
    const controller = new AbortController()
    client.operation('listMilestones', { opportunityId: selection.opportunity.id }, z.array(c.milestoneSchema), controller.signal)
      .then(setMilestones).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, selection?.opportunity.id, revision])
  useEffect(() => {
    if (tab !== 'discovery') return
    const controller = new AbortController()
    client.operation('discoverOpportunities', { domain }, z.array(c.discoverableOpportunitySchema), controller.signal)
      .then(setDiscovery).catch((cause: unknown) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [client, tab, domain, revision])

  async function mutate(operation: string, input: Record<string, unknown>) {
    setError('')
    const receipt = await review(operation, input)
    if (receipt.state !== 'confirmed') throw new Error('The action outcome is unconfirmed. Do not repeat it. Open Activity.')
    setRevision((value) => value + 1)
    return receipt.result
  }
  const searchClient = useMemo<CustomerSearchClient>(() => ({
    getDataMode: async () => mode,
    searchAccounts: async (input) => (await client.operation('searchAccounts', input, z.array(c.accountCandidateSchema))).map((entry) => ({ ...customerView(entry), state: entry.state })),
    addAccount: async (id) => customerView(c.accountSchema.parse(await mutate('addAccount', { accountId: id }))),
    setAccountVisibility: async (id, visibility) => customerView(c.accountSchema.parse(await mutate('setAccountVisibility', { accountId: id, visibility })))
  }), [client, mode, review])
  const creationClient = useMemo<CreationClient>(() => ({
    listAccounts: async () => (await client.operation('listAccounts', {}, z.array(c.accountSchema))).map((entry) => ({
      id: entry.id, name: entry.name, ...(entry.visibility === undefined ? {} : { visibility: entry.visibility })
    })),
    getRecordCreationCatalog: (id) => client.operation('getRecordCreationCatalog', { contractVersion: c.contractVersion, accountId: id }, c.recordCreationCatalogSchema),
    previewRecordCreation: (target, draft) => client.operation('previewRecordCreation', { contractVersion: c.contractVersion, target, draft }, c.recordCreationPreviewSchema),
    commitRecordCreation: async (preview) => c.recordCreationResultSchema.parse(await mutate('commitRecordCreation', {
      contractVersion: c.contractVersion, preview, expectedDigest: preview.digest, confirmed: true
    })),
    exportRecordCreationDraft: (preview) => client.operation('exportRecordCreationDraft', {
      contractVersion: c.contractVersion, preview, expectedDigest: preview.digest, confirmed: true
    }, c.recordCreationDraftResultSchema)
  }), [client, review])
  async function action(operation: string, input: Record<string, unknown>) {
    try { await mutate(operation, input) } catch (cause) { setError(String(cause)) }
  }
  return <section>
    <div className="section-heading"><h1>Accounts and opportunities</h1>
      <AddCustomerButton client={searchClient} dataMode={mode} onAdded={(account) => { setAccountId(account.id); setRevision((value) => value + 1) }} />
    </div>
    <div className="toolbar" role="group" aria-label="Account workspace">
      <button type="button" className={tab === 'portfolio' ? 'selected' : ''} onClick={() => setTab('portfolio')}>Portfolio</button>
      <button type="button" className={tab === 'discovery' ? 'selected' : ''} onClick={() => setTab('discovery')}>Discovery</button>
      <button type="button" className={tab === 'new' ? 'selected' : ''} onClick={() => setTab('new')}>New / draft</button>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>Refresh sources</button>
    </div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {tab === 'new' ? <div className="panel"><p>{mode === 'live' ? 'Live record creation stays disabled. Export a reviewed draft.' : 'Creation changes the sample SQLite store only.'}</p><NewWorkspace client={creationClient} /></div>
      : tab === 'discovery' ? <div className="panel">
        <label className="field">Solution Engineer domain<select value={domain} onChange={(event) => setDomain(seDomainSchema.parse(event.target.value))}>
          {seDomainIds.map((id) => <option key={id} value={id}>{seDomainDefinitions[id].label}</option>)}
        </select></label>
        <p>Adding an account is separate from joining an opportunity Deal Team or milestone team.</p>
        <ul className="record-list">{discovery.map((entry) => <li key={entry.id}><strong>{entry.name}</strong><span>{entry.accountName}</span>
          <button type="button" onClick={() => { void action(entry.onDealTeam ? 'leaveDealTeam' : 'joinDealTeam', { opportunityId: entry.id, ...(entry.onDealTeam ? {} : { domain }) }) }}>{entry.onDealTeam ? 'Review leaving Deal Team' : 'Review joining Deal Team'}</button>
        </li>)}</ul>
        {!discovery.length && <p>No eligible opportunities for this source scope and domain.</p>}
      </div> : <>
        <div className="scope-selectors panel">
          <label className="field">Customer account<select aria-label="Customer account" value={accountId} disabled={Boolean(boundAccountId)} onChange={(event) => { onSelect(null); setAccountId(event.target.value) }}>
            <option value="">Choose an account</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="field">Opportunity<select aria-label="Opportunity" value={selection?.opportunity.id ?? ''} onChange={(event) => {
            const account = accounts.find((item) => item.id === accountId)
            const opportunity = opportunities.find((item) => item.id === event.target.value)
            onSelect(account && opportunity ? { account, opportunity } : null)
          }}>
            <option value="">Choose an opportunity</option>{opportunities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        </div>
        {selection ? <div className="workspace-grid">
          <section className="panel"><h2>{selection.opportunity.name}</h2>
            <p className="muted">{selection.account.name} | Recorded MCEM stage {selection.opportunity.recordedStage} | {mode === 'sample' ? 'Sanitized SQLite sample' : 'Delegated MSX data'}</p>
            <AgentWorkspace client={client} selection={selection} />
            <details className="source-editor"><summary>Opportunity notes and reviewed updates</summary>
              <label className="field">Opportunity notes<textarea aria-label="Opportunity notes" value={notes} maxLength={30_000} onChange={(event) => setNotes(event.target.value)} /></label>
              <button type="button" onClick={() => { void action('updateOpportunity', { opportunityId: selection.opportunity.id, update: { comments: notes } }) }}>Review opportunity update</button>
              <StageChange selection={selection} onAction={action} />
            </details>
          </section>
          <aside className="panel"><h2>Milestones</h2>
            {milestones.map((item) => <MilestoneCard key={item.id} milestone={item} onAction={action} />)}
            {!milestones.length && <p>No milestones are visible in this scope.</p>}
          </aside>
        </div> : <p className="panel">Choose an accessible account and opportunity. An account may be visible without any eligible Portfolio opportunities.</p>}
      </>}
  </section>
}

function AgentWorkspace({ client, selection }: { client: TeamsApiClient; selection: WorkingSelection }) {
  const [capability, setCapability] = useState<c.AgentCapability>('account-pulse')
  const [prompt, setPrompt] = useState(suggestedPrompts['account-pulse'][0] ?? '')
  const [result, setResult] = useState<c.AgentTaskResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recipients, setRecipients] = useState('')
  useEffect(() => { setResult(null); setError('') }, [selection.opportunity.id])
  async function run() {
    setBusy(true); setError('')
    try {
      setResult(await client.operation('runAgentTask', {
        contractVersion: c.contractVersion, capability, accountId: selection.account.id, opportunityId: selection.opportunity.id, prompt
      }, c.agentTaskResponseSchema))
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  async function exportResult(email: boolean) {
    if (!result) return
    setError('')
    try {
      const common = {
        contractVersion: c.contractVersion, responseTitle: `TLC guidance - ${selection.opportunity.name}`,
        responseMarkdown: formatResponseMarkdown(result.content)
      }
      if (email) {
        const draft = c.emailComposeRequestSchema.parse({
          ...common, recipients: recipients.split(/[;,]/).map((item) => item.trim()).filter(Boolean), subject: common.responseTitle
        })
        await client.download('documents/email', { opportunityId: selection.opportunity.id, draft }, 'TLC-reviewed-draft.eml')
      } else {
        const document = c.exportResponseRequestSchema.parse({ ...common, generatedAt: result.generatedAt })
        await client.download('documents/export', { opportunityId: selection.opportunity.id, document }, 'TLC-response.docx')
      }
    } catch (cause) { setError(String(cause)) }
  }
  return <div>
    <label className="field">Guidance capability<select value={capability} onChange={(event) => {
      const next = c.agentCapabilitySchema.parse(event.target.value)
      setCapability(next); setPrompt(suggestedPrompts[next][0] ?? ''); setResult(null)
    }}>{Object.keys(suggestedPrompts).map((item) => <option key={item} value={item}>{item.replaceAll('-', ' ')}</option>)}</select></label>
    <div className="starter-prompts">{suggestedPrompts[capability].slice(0, 4).map((item) => <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div>
    <label className="field">Ask TLC<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1000} /></label>
    <button type="button" className="primary" disabled={busy || prompt.trim().length < 3} onClick={() => { void run() }}>{busy ? 'Grounding response...' : 'Run guidance'}</button>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {result && <><AgentResultView result={result} /><div className="toolbar">
      <button type="button" onClick={() => { void exportResult(false) }}>Export Word</button>
      <label className="field">Email draft recipients<input type="text" value={recipients} placeholder="reviewer@example.com" onChange={(event) => setRecipients(event.target.value)} /></label>
      <button type="button" disabled={!recipients.trim()} onClick={() => { void exportResult(true) }}>Download unsent email draft</button>
    </div></>}
  </div>
}

function MilestoneCard({ milestone, onAction }: { milestone: c.Milestone; onAction(operation: string, input: Record<string, unknown>): Promise<void> }) {
  const [status, setStatus] = useState(milestone.status)
  const [subject, setSubject] = useState('')
  const [risk, setRisk] = useState(milestone.riskDetails ?? '')
  const [commitment, setCommitment] = useState(milestone.commitment ?? '')
  const [date, setDate] = useState(milestone.targetDate ?? '')
  const [comments, setComments] = useState(milestone.comments ?? '')
  const changes = {
    ...(status !== milestone.status ? { status } : {}),
    ...(risk !== (milestone.riskDetails ?? '') ? { riskDetails: risk } : {}),
    ...(commitment && commitment !== milestone.commitment ? { customerCommitment: commitment } : {}),
    ...(date && date !== milestone.targetDate ? { targetDate: date } : {}),
    ...(comments !== (milestone.comments ?? '') ? { comments } : {})
  }
  return <article className="milestone-card"><h3>{milestone.name}</h3><p>{milestone.status}{milestone.targetDate ? ` | ${milestone.targetDate}` : ''}</p>
    <details><summary>Reviewed milestone actions</summary>
      <label className="field">Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
        {c.milestoneStatusSchema.options.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <button type="button" onClick={() => { void onAction('updateMilestone', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, update: { status } }) }}>Review status update</button>
      <label className="field">Milestone risk details<textarea aria-label="Milestone risk details" value={risk} maxLength={30_000} onChange={(event) => setRisk(event.target.value)} /></label>
      <label className="field">Customer commitment<select value={commitment} onChange={(event) => setCommitment(event.target.value)}>
        <option value="">Choose a verified commitment</option>{c.customerCommitmentSchema.options.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="field">Milestone target date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label className="field">Milestone comments<textarea value={comments} maxLength={30_000} onChange={(event) => setComments(event.target.value)} /></label>
      <button type="button" disabled={!Object.keys(changes).length} onClick={() => { void onAction('updateMilestone', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, update: changes }) }}>Review milestone fields</button>
      <button type="button" onClick={() => { void onAction(milestone.onMilestoneTeam ? 'leaveMilestoneTeam' : 'joinMilestoneTeam', { opportunityId: milestone.opportunityId, milestoneId: milestone.id }) }}>{milestone.onMilestoneTeam ? 'Review leaving milestone team' : 'Review joining milestone team'}</button>
      <label className="field">New task subject<input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} /></label>
      <button type="button" disabled={!subject.trim()} onClick={() => { void onAction('createMilestoneActivity', { opportunityId: milestone.opportunityId, milestoneId: milestone.id, request: { subject } }) }}>Review new task</button>
    </details>
  </article>
}

function StageChange({ selection, onAction }: { selection: WorkingSelection; onAction(operation: string, input: Record<string, unknown>): Promise<void> }) {
  const [target, setTarget] = useState(selection.opportunity.recordedStage > 1 ? selection.opportunity.recordedStage - 1 : 2)
  const [reason, setReason] = useState('')
  const choices = [selection.opportunity.recordedStage - 1, selection.opportunity.recordedStage + 1].filter((stage) => stage >= 1 && stage <= 5)
  useEffect(() => {
    setTarget(selection.opportunity.recordedStage > 1 ? selection.opportunity.recordedStage - 1 : 2)
    setReason('')
  }, [selection.opportunity.id, selection.opportunity.recordedStage])
  return <section className="stage-editor"><h3>Reviewed MCEM stage transition</h3>
    <p>Stage changes remain adjacent; unmet exit criteria and recycling require a business reason.</p>
    <label className="field">Target MCEM stage<select aria-label="Target MCEM stage" value={target} onChange={(event) => setTarget(Number(event.target.value))}>
      {choices.map((stage) => <option key={stage} value={stage}>Stage {stage}</option>)}
    </select></label>
    <label className="field">Stage change reason<textarea aria-label="Stage change reason" value={reason} minLength={10} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
    <button type="button" disabled={reason.trim().length < 10} onClick={() => { void onAction('transitionOpportunityStage', {
      contractVersion: c.contractVersion, accountId: selection.account.id, opportunityId: selection.opportunity.id, targetStage: target, reason
    }) }}>Review MCEM stage change</button>
  </section>
}
