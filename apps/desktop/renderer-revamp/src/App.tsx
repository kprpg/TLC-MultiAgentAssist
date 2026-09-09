import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, FluentProvider, Input, Menu, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, MessageBar, Spinner, Textarea, Tooltip, webDarkTheme, webLightTheme } from '@fluentui/react-components'
import {
  Apps20Regular,
  ArrowDownload20Regular,
  ArrowClockwise20Regular,
  Building20Regular,
  CheckmarkCircle20Filled,
  ChevronDown20Regular,
  ChevronDoubleLeft20Regular,
  ChevronDoubleRight20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  ClipboardTaskListLtr20Regular,
  Dismiss20Regular,
  Home20Regular,
  Lightbulb20Regular,
  List20Regular,
  Mail20Regular,
  MoreHorizontal20Regular,
  PanelRight20Regular,
  Person20Regular,
  Power20Regular,
  Search20Regular,
  ArrowSort20Regular,
  Sparkle20Regular,
  Warning20Filled
} from '@fluentui/react-icons'
import type { Account, AgentCapability, AgentTaskResponse, CustomerCommitment, McemResponse, Milestone, MilestoneStatus, MilestoneUpdate, Opportunity } from '../../../../packages/common/index.js'
import { addMsxOpportunityLink, contractVersion } from '../../../../packages/common/index.js'
import { createDataClient, stageOwner, type RevampDataClient } from './data-client.js'
import { suggestedPrompts } from './prompt-catalog.js'
import { formatResponseMarkdown } from './response-markdown.js'
import { sortOpportunities, type OpportunitySort } from './opportunity-sort.js'
import { sortMilestones, type MilestoneSort } from './milestone-sort.js'

type Shell = 'desktop' | 'web'
type CenterTab = 'msx' | 'guidance' | 'stages'
type Blade = 'accounts' | 'opportunities' | 'actions'
type SearchResult =
  | { type: 'account'; account: Account }
  | { type: 'opportunity'; account: Account; opportunity: Opportunity }

type BladeWidths = Record<Blade, number>
type MilestoneField = 'status' | 'riskDetails' | 'targetDate' | 'customerCommitment' | 'comments'
type MilestoneEdit = { milestoneId: string; field: MilestoneField; value: string }
type PendingStageMove = { opportunity: Opportunity; targetStage: number; evaluation: McemResponse }

const mcemStages = [
  { id: 1, name: 'Listen & Consult', role: 'Account Executive' },
  { id: 2, name: 'Inspire & Design', role: 'Specialist / SSP' },
  { id: 3, name: 'Empower & Achieve', role: 'Solution Engineer' },
  { id: 4, name: 'Realize Value', role: 'Cloud Solution Architect' },
  { id: 5, name: 'Manage & Optimize', role: 'CSAM' }
] as const

const bladeWidthStorageKey = 'tlc.blade-widths.v1'
const defaultBladeWidths: BladeWidths = { accounts: 230, opportunities: 320, actions: 310 }
const bladeWidthLimits: Record<Blade, { min: number; max: number }> = {
  accounts: { min: 180, max: 420 },
  opportunities: { min: 220, max: 500 },
  actions: { min: 240, max: 520 }
}

const capabilities: { id: AgentCapability; label: string }[] = [
  { id: 'account-pulse', label: 'Account Pulse' },
  { id: 'mcem-coach', label: 'MCEM Coach' },
  { id: 'pursuit-executive', label: 'Pursuit' },
  { id: 'risk-solution-play', label: 'Risk & Play' }
]

const milestoneStatuses: MilestoneStatus[] = ['On Track', 'At Risk', 'Blocked', 'Completed', 'Cancelled', 'Lost to Competitor', 'Hygiene/Duplicate']
const customerCommitments: CustomerCommitment[] = ['Uncommitted', 'Committed']
const milestoneFieldLabels: Record<MilestoneField, string> = {
  status: 'Milestone Status',
  riskDetails: 'Risk/Blocker Details',
  targetDate: 'Milestone Est Date',
  customerCommitment: 'Customer Commitment',
  comments: 'Milestone Comments'
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function stageStatus(result: McemResponse): 'advance' | 'aligned' | 'gap' {
  if (result.evidenceBasedStage > result.recordedStage) return 'advance'
  if (result.evidenceBasedStage === result.recordedStage) return 'aligned'
  return 'gap'
}

function BladeHeader({ title, subtitle, collapsed, refreshing, actions, onRefresh, onToggle, onClose }: { title: string; subtitle?: string; collapsed: boolean; refreshing: boolean; actions?: React.ReactNode; onRefresh(): void; onToggle(): void; onClose?: () => void }) {
  return <header className="blade-header">
    {!collapsed && <div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>}
    <div className="blade-header-actions">
      {!collapsed && actions}
      {!collapsed && <Button appearance="subtle" className="icon-button" disabled={refreshing} icon={<ArrowClockwise20Regular />} onClick={onRefresh} aria-label={`Refresh ${title}`} title={`Refresh ${title}`} />}
      <Button
        appearance="subtle"
        className="icon-button desktop-only"
        icon={collapsed ? <ChevronDoubleRight20Regular /> : <ChevronDoubleLeft20Regular />}
        onClick={onToggle}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title} blade header`}
        title={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      />
      {onClose && !collapsed && <Button appearance="subtle" className="icon-button" icon={<Dismiss20Regular />} onClick={onClose} aria-label={`Close ${title}`} title={`Close ${title}`} />}
    </div>
  </header>
}

function loadBladeWidths(): BladeWidths {
  try {
    const stored = JSON.parse(localStorage.getItem(bladeWidthStorageKey) ?? '{}') as Partial<BladeWidths>
    return Object.fromEntries(Object.entries(defaultBladeWidths).map(([blade, defaultWidth]) => {
      const key = blade as Blade
      const width = stored[key]
      const { min, max } = bladeWidthLimits[key]
      return [key, typeof width === 'number' && Number.isFinite(width) ? Math.min(max, Math.max(min, width)) : defaultWidth]
    })) as BladeWidths
  } catch {
    return defaultBladeWidths
  }
}

function BladeResizeHandle({ blade, label, edge, width, onResize }: { blade: Blade; label: string; edge: 'start' | 'end'; width: number; onResize(width: number): void }) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const limits = bladeWidthLimits[blade]

  function resize(nextWidth: number) {
    onResize(Math.min(limits.max, Math.max(limits.min, nextWidth)))
  }

  function finishResize(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    document.body.classList.remove('resizing-blade')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div
    className={`blade-resize-handle ${edge}`}
    role="separator"
    aria-label={`Resize ${label}`}
    aria-orientation="vertical"
    aria-valuemin={limits.min}
    aria-valuemax={limits.max}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    title={`Drag to resize ${label}. Double-click to reset.`}
    onDoubleClick={() => resize(defaultBladeWidths[blade])}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const dividerDelta = event.key === 'ArrowRight' ? 10 : -10
      resize(width + (edge === 'end' ? dividerDelta : -dividerDelta))
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.classList.add('resizing-blade')
      event.preventDefault()
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      const dividerDelta = event.clientX - drag.current.startX
      resize(drag.current.startWidth + (edge === 'end' ? dividerDelta : -dividerDelta))
    }}
    onPointerUp={finishResize}
    onPointerCancel={finishResize}
  />
}

function App({ shell, client }: { shell: Shell; client: RevampDataClient }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [opportunitySort, setOpportunitySort] = useState<OpportunitySort>('closeDate')
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [milestoneSort, setMilestoneSort] = useState<MilestoneSort>('targetDate')
  const [account, setAccount] = useState<Account | null>(null)
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [result, setResult] = useState<McemResponse | null>(null)
  const [centerTab, setCenterTab] = useState<CenterTab>('msx')
  const [capability, setCapability] = useState<AgentCapability>('account-pulse')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [agentResult, setAgentResult] = useState<AgentTaskResponse | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [shareStatus, setShareStatus] = useState<'ready' | 'running' | 'success' | 'error'>('ready')
  const [shareMessage, setShareMessage] = useState('')
  const [collapsed, setCollapsed] = useState<Set<Blade>>(new Set())
  const [bladeWidths, setBladeWidths] = useState<BladeWidths>(loadBladeWidths)
  const [actionsOpen, setActionsOpen] = useState(true)
  const [mobileBlade, setMobileBlade] = useState<Blade | 'center'>('accounts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpportunities, setSearchOpportunities] = useState<Opportunity[]>([])
  const [searchLoading, setSearchLoading] = useState(true)
  const [exiting, setExiting] = useState(false)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)
  const [milestoneEdit, setMilestoneEdit] = useState<MilestoneEdit | null>(null)
  const [opportunityCommentsOpen, setOpportunityCommentsOpen] = useState(false)
  const [opportunityComments, setOpportunityComments] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [boardEvaluations, setBoardEvaluations] = useState<Record<string, McemResponse>>({})
  const [boardLoading, setBoardLoading] = useState(false)
  const [pendingStageMove, setPendingStageMove] = useState<PendingStageMove | null>(null)
  const [stageMoveReason, setStageMoveReason] = useState('')
  const [stageMoveSaving, setStageMoveSaving] = useState(false)
  const sortedOpportunities = sortOpportunities(opportunities, opportunitySort)
  const sortedMilestones = sortMilestones(milestones, milestoneSort)

  useEffect(() => {
    void client.listAccounts().then(async (items) => {
      setAccounts(items)
      setLoading(false)
      const portfolio = await Promise.all(items.map((item) => client.listOpportunities(item.id)))
      setSearchOpportunities(portfolio.flat())
    }).catch(handleError).finally(() => {
      setLoading(false)
      setSearchLoading(false)
    })
  }, [client])

  useEffect(() => {
    localStorage.setItem(bladeWidthStorageKey, JSON.stringify(bladeWidths))
  }, [bladeWidths])

  function handleError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
  }

  function startMilestoneEdit(milestone: Milestone, field: MilestoneField) {
    const value = field === 'customerCommitment' ? milestone.commitment ?? 'Uncommitted' : milestone[field] ?? ''
    setError('')
    setMilestoneEdit({ milestoneId: milestone.id, field, value })
  }

  async function saveMilestoneEdit() {
    if (!opportunity || !milestoneEdit) return
    const { milestoneId, field, value } = milestoneEdit
    let update: MilestoneUpdate
    switch (field) {
      case 'status': update = { status: value as MilestoneStatus }; break
      case 'customerCommitment': update = { customerCommitment: value as CustomerCommitment }; break
      case 'targetDate': update = { targetDate: value }; break
      case 'riskDetails': update = { riskDetails: value }; break
      case 'comments': update = { comments: value }; break
    }
    setSavingEdit(true)
    setError('')
    try {
      const saved = await client.updateMilestone(opportunity.id, milestoneId, update)
      setMilestones((current) => current.map((item) => item.id === saved.id ? saved : item))
      setMilestoneEdit(null)
    } catch (cause) {
      handleError(cause)
    } finally {
      setSavingEdit(false)
    }
  }

  async function saveOpportunityComments() {
    if (!opportunity) return
    setSavingEdit(true)
    setError('')
    try {
      const saved = await client.updateOpportunity(opportunity.id, { comments: opportunityComments })
      setOpportunity(saved)
      setOpportunities((current) => current.map((item) => item.id === saved.id ? saved : item))
      setSearchOpportunities((current) => current.map((item) => item.id === saved.id ? saved : item))
      setOpportunityCommentsOpen(false)
    } catch (cause) {
      handleError(cause)
    } finally {
      setSavingEdit(false)
    }
  }

  function openOpportunityComments(nextOpportunity: Opportunity) {
    if (opportunity?.id !== nextOpportunity.id) void selectOpportunity(nextOpportunity)
    setOpportunityComments(nextOpportunity.comments ?? '')
    setOpportunityCommentsOpen(true)
    setError('')
  }

  function toggleBlade(blade: Blade) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(blade)) next.delete(blade)
      else next.add(blade)
      return next
    })
  }

  function resizeBlade(blade: Blade, width: number) {
    setBladeWidths((current) => ({ ...current, [blade]: width }))
  }

  async function selectAccount(nextAccount: Account) {
    setError('')
    setAccount(nextAccount)
    setOpportunity(null)
    setExpandedOpportunityId(null)
    setMilestones([])
    setResult(null)
    setAgentResult(null)
    setLoading(true)
    setMobileBlade('opportunities')
    try {
      setOpportunities(await client.listOpportunities(nextAccount.id))
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function selectOpportunity(nextOpportunity: Opportunity, nextAccount = account) {
    if (!nextAccount) return
    setError('')
    if (account?.id !== nextAccount.id) {
      setAccount(nextAccount)
      setOpportunities(searchOpportunities.filter((item) => item.accountId === nextAccount.id))
    }
    setOpportunity(nextOpportunity)
    setExpandedOpportunityId(nextOpportunity.id)
    setOpportunityCommentsOpen(false)
    setMilestones([])
    setResult(null)
    setAgentResult(null)
    setActionsOpen(true)
    setCenterTab('msx')
    setLoading(true)
    setMobileBlade('opportunities')
    try {
      const [nextResult, nextMilestones] = await Promise.all([
        client.runMcemCoach(nextAccount.id, nextOpportunity.id),
        client.listMilestones(nextOpportunity.id)
      ])
      setResult(nextResult)
      setMilestones(nextMilestones)
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  function toggleOpportunity(nextOpportunity: Opportunity) {
    if (opportunity?.id === nextOpportunity.id) {
      setExpandedOpportunityId((current) => current === nextOpportunity.id ? null : nextOpportunity.id)
      return
    }
    void selectOpportunity(nextOpportunity)
  }

  function loadGuidance(nextCapability = capability) {
    if (!account || !opportunity) return
    setCapability(nextCapability)
    setCenterTab('guidance')
    setTaskPrompt('')
    setAgentResult(null)
    setShareMessage('')
    setMobileBlade('center')
  }

  async function loadStageBoard(boardOpportunities = opportunities) {
    if (!account) return
    setCenterTab('stages')
    setMobileBlade('center')
    setBoardLoading(true)
    setError('')
    try {
      const evaluations = await Promise.all(boardOpportunities.map(async (item) => [item.id, await client.runMcemCoach(account.id, item.id)] as const))
      setBoardEvaluations(Object.fromEntries(evaluations))
    } catch (cause) {
      handleError(cause)
    } finally {
      setBoardLoading(false)
    }
  }

  async function proposeStageMove(item: Opportunity, targetStage: number) {
    if (!account || Math.abs(targetStage - item.recordedStage) !== 1) return
    setError('')
    try {
      const evaluation = await client.runMcemCoach(account.id, item.id)
      setBoardEvaluations((current) => ({ ...current, [item.id]: evaluation }))
      setStageMoveReason('')
      setPendingStageMove({ opportunity: item, targetStage, evaluation })
    } catch (cause) {
      handleError(cause)
    }
  }

  async function confirmStageMove() {
    if (!account || !pendingStageMove) return
    const requiresReason = pendingStageMove.targetStage < pendingStageMove.opportunity.recordedStage
      || pendingStageMove.evaluation.criteria.some((criterion) => criterion.status !== 'met')
    if (requiresReason && stageMoveReason.trim().length < 10) return
    setStageMoveSaving(true)
    setError('')
    try {
      const transition = await client.transitionOpportunityStage(account.id, pendingStageMove.opportunity.id, pendingStageMove.targetStage, stageMoveReason.trim() || undefined)
      const updatedOpportunities = opportunities.map((item) => item.id === transition.opportunity.id ? transition.opportunity : item)
      setOpportunities(updatedOpportunities)
      if (opportunity?.id === transition.opportunity.id) setOpportunity(transition.opportunity)
      setPendingStageMove(null)
      setBoardEvaluations((current) => { const next = { ...current }; delete next[transition.opportunity.id]; return next })
      void loadStageBoard(updatedOpportunities)
    } catch (cause) {
      handleError(cause)
    } finally {
      setStageMoveSaving(false)
    }
  }

  async function runAgentPrompt(selectedPrompt = taskPrompt, selectedCapability = capability) {
    if (!account || !opportunity) return
    const prompt = selectedPrompt.trim()
    if (prompt.length < 3) return
    setCapability(selectedCapability)
    setTaskPrompt(selectedPrompt)
    setAgentResult(null)
    setAgentLoading(true)
    setError('')
    setShareStatus('ready')
    setShareMessage('')
    try {
      setAgentResult(await client.runAgentTask(selectedCapability, account.id, opportunity.id, prompt))
    } catch (cause) {
      handleError(cause)
    } finally {
      setAgentLoading(false)
    }
  }

  async function openEmailDialog() {
    if (!agentResult) return
    const label = capabilities.find((item) => item.id === agentResult.capability)?.label ?? 'Agent response'
    setEmailRecipients(await client.getCurrentUserEmail().catch(() => undefined) ?? '')
    setEmailSubject(`${label}: ${opportunity?.name ?? 'Agent response'}`)
    setShareStatus('ready')
    setShareMessage('')
    setEmailDialogOpen(true)
  }

  async function openEmailCompose() {
    if (!agentResult || !opportunity) return
    const recipients = emailRecipients.split(/[;,]/).map((recipient) => recipient.trim()).filter(Boolean)
    const label = capabilities.find((item) => item.id === agentResult.capability)?.label ?? 'Agent response'
    setShareStatus('running')
    setShareMessage('')
    try {
      await client.openEmailCompose({
        contractVersion,
        recipients,
        subject: emailSubject,
        responseTitle: label,
        responseMarkdown: formatResponseMarkdown(addMsxOpportunityLink(agentResult.content, opportunity.id))
      })
      setEmailDialogOpen(false)
      setShareStatus('success')
      setShareMessage(client.mode === 'desktop' ? 'Email message opened for review.' : 'Rich email draft downloaded for review.')
    } catch (cause) {
      setShareStatus('error')
      setShareMessage(cause instanceof Error ? cause.message : 'The email message could not be opened.')
    }
  }

  async function exportAgentResponse() {
    if (!agentResult) return
    const label = capabilities.find((item) => item.id === agentResult.capability)?.label ?? 'Agent response'
    setShareStatus('running')
    setShareMessage('')
    try {
      const response = await client.exportAgentResponse({
        contractVersion,
        responseTitle: `${label} - ${opportunity?.name ?? 'Agent response'}`,
        responseMarkdown: formatResponseMarkdown(agentResult.content),
        generatedAt: agentResult.generatedAt
      })
      setShareStatus(response.state === 'saved' ? 'success' : 'ready')
      setShareMessage(response.state === 'saved' ? 'Word document saved.' : '')
    } catch (cause) {
      setShareStatus('error')
      setShareMessage(cause instanceof Error ? cause.message : 'The Word document could not be exported.')
    }
  }

  async function refreshAccounts() {
    setError('')
    setLoading(true)
    setSearchLoading(true)
    try {
      const items = await client.listAccounts()
      const portfolio = await Promise.all(items.map((item) => client.listOpportunities(item.id)))
      setAccounts(items)
      setSearchOpportunities(portfolio.flat())
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
      setSearchLoading(false)
    }
  }

  async function refreshOpportunities() {
    if (!account) return
    setError('')
    setLoading(true)
    try {
      const items = await client.listOpportunities(account.id)
      setOpportunities(items)
      setSearchOpportunities((current) => [...current.filter((item) => item.accountId !== account.id), ...items])
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  async function refreshOpportunityContext() {
    if (!account || !opportunity) return
    setError('')
    setLoading(true)
    try {
      const [nextResult, nextMilestones] = await Promise.all([
        client.runMcemCoach(account.id, opportunity.id),
        client.listMilestones(opportunity.id)
      ])
      setResult(nextResult)
      setMilestones(nextMilestones)
      if (centerTab === 'guidance' && taskPrompt.trim().length >= 3) {
        setAgentResult(await client.runAgentTask(capability, account.id, opportunity.id, taskPrompt.trim()))
      }
    } catch (cause) {
      handleError(cause)
    } finally {
      setLoading(false)
    }
  }

  function closeOpportunities() {
    setAccount(null)
    setOpportunities([])
    setOpportunity(null)
    setExpandedOpportunityId(null)
    setMilestones([])
    setResult(null)
    setAgentResult(null)
    setActionsOpen(false)
    setMobileBlade('accounts')
  }

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const searchResults: SearchResult[] = normalizedSearch
    ? [
        ...accounts
          .filter((item) => item.name.toLocaleLowerCase().includes(normalizedSearch))
          .map((item): SearchResult => ({ type: 'account', account: item })),
        ...searchOpportunities
          .filter((item) => item.name.toLocaleLowerCase().includes(normalizedSearch))
          .map((item): SearchResult | null => {
            const owningAccount = accounts.find((candidate) => candidate.id === item.accountId)
            return owningAccount ? { type: 'opportunity', account: owningAccount, opportunity: item } : null
          })
          .filter((item): item is SearchResult => item !== null)
      ].slice(0, 8)
    : []

  function chooseSearchResult(item: SearchResult) {
    setSearchQuery('')
    if (item.type === 'account') void selectAccount(item.account)
    else void selectOpportunity(item.opportunity, item.account)
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searchResults[0]) chooseSearchResult(searchResults[0])
  }

  async function exitApplication() {
    setError('')
    setExiting(true)
    try {
      await client.exitApplication()
    } catch (cause) {
      setExiting(false)
      handleError(cause)
    }
  }

  const status = result ? stageStatus(result) : null
  const modeLabel = client.mode === 'web-live'
    ? 'WEB · CONNECTED DATA'
    : shell === 'web' ? 'STATIC WEB · SAMPLE DATA' : 'DESKTOP · CONNECTED DATA'

  return <div className="app-shell">
    <header className="command-bar">
      <div className="brand-mark" aria-hidden="true">T</div>
      <div className="brand"><strong>TLC</strong><span>Account Team Intelligence</span></div>
      <form className="global-search" role="search" onSubmit={submitSearch}>
        <Search20Regular />
        <input
          type="search"
          aria-label="Search accounts and opportunities"
          aria-controls="global-search-results"
          aria-expanded={normalizedSearch.length > 0}
          autoComplete="off"
          placeholder="Search accounts and opportunities"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {normalizedSearch && <div className="search-results" id="global-search-results" role="listbox" aria-label="Search results">
          {searchResults.map((item) => <button
            key={item.type === 'account' ? `account-${item.account.id}` : `opportunity-${item.opportunity.id}`}
            type="button"
            role="option"
            onClick={() => chooseSearchResult(item)}
          >
            {item.type === 'account' ? <Building20Regular /> : <List20Regular />}
            <span>
              <strong>{item.type === 'account' ? item.account.name : item.opportunity.name}</strong>
              <small>{item.type === 'account' ? `Account · ${item.account.segment}` : `Opportunity · ${item.account.name}`}</small>
            </span>
          </button>)}
          {!searchLoading && searchResults.length === 0 && <p role="status">No accounts or opportunities found.</p>}
          {searchLoading && <p role="status">Searching portfolio…</p>}
        </div>}
      </form>
      <div className="command-actions">
        <span className="mode-badge">{modeLabel}</span>
        <button className="profile-button" title="Signed-in user" aria-label="Signed-in user"><Person20Regular /></button>
        <Button appearance="subtle" icon={<Power20Regular />} disabled={exiting} onClick={() => void exitApplication()} aria-label="Exit application" title="Exit application">
          <span className="exit-label">{exiting ? 'Exiting' : 'Exit'}</span>
        </Button>
      </div>
    </header>

    <main className="workspace">
      <nav className="icon-rail" aria-label="Primary navigation">
        <button className="rail-button active" title="Home" aria-label="Home"><Home20Regular /></button>
        <button className="rail-button" title="Accounts" aria-label="Accounts"><Building20Regular /></button>
        <button className="rail-button" title="Opportunities" aria-label="Opportunities"><List20Regular /></button>
        <button className="rail-button" title="Guidance" aria-label="Guidance"><Sparkle20Regular /></button>
      </nav>

      <section className={`blade account-blade ${collapsed.has('accounts') ? 'collapsed' : ''} ${mobileBlade === 'accounts' ? 'mobile-active' : ''}`} style={{ flexBasis: collapsed.has('accounts') ? undefined : bladeWidths.accounts }} aria-label="Accounts blade">
        <BladeHeader title="Accounts" subtitle={`${accounts.length} customer accounts`} collapsed={collapsed.has('accounts')} refreshing={loading || searchLoading} onRefresh={() => void refreshAccounts()} onToggle={() => toggleBlade('accounts')} />
        {!collapsed.has('accounts') && <div className="blade-body">
          <p className="blade-intro">Choose an account to open its active opportunities.</p>
          <div className="account-list">
            {accounts.map((item) => <button key={item.id} className={`account-button ${account?.id === item.id ? 'selected' : ''}`} onClick={() => void selectAccount(item)}>
              <span><strong>{item.name}</strong><small>{item.segment}</small></span>
              <ChevronRight20Regular />
            </button>)}
          </div>
        </div>}
        {collapsed.has('accounts') && <button className="collapsed-symbol" onClick={() => toggleBlade('accounts')} aria-label="Expand Accounts"><Building20Regular /></button>}
        {!collapsed.has('accounts') && <BladeResizeHandle blade="accounts" label="Accounts blade" edge="end" width={bladeWidths.accounts} onResize={(width) => resizeBlade('accounts', width)} />}
      </section>

      {account && <section className={`blade opportunity-blade ${collapsed.has('opportunities') ? 'collapsed' : ''} ${mobileBlade === 'opportunities' ? 'mobile-active' : ''}`} style={{ flexBasis: collapsed.has('opportunities') ? undefined : bladeWidths.opportunities }} aria-label="Opportunities blade">
        <BladeHeader title="Opportunities" subtitle={account.name} collapsed={collapsed.has('opportunities')} refreshing={loading} actions={<Menu checkedValues={{ opportunitySort: [opportunitySort] }} onCheckedValueChange={(_, data) => setOpportunitySort(data.checkedItems[0] as OpportunitySort)} positioning="below-end">
          <MenuTrigger disableButtonEnhancement><Button appearance="subtle" className="icon-button" icon={<ArrowSort20Regular />} aria-label="Sort opportunities" title={`Sort opportunities by ${opportunitySort === 'closeDate' ? 'Close Date' : opportunitySort === 'stage' ? 'Stage' : 'Value'}`} /></MenuTrigger>
          <MenuPopover><MenuList aria-label="Sort opportunities by">
            <MenuItemRadio name="opportunitySort" value="closeDate">Close Date</MenuItemRadio>
            <MenuItemRadio name="opportunitySort" value="stage">Stage</MenuItemRadio>
            <MenuItemRadio name="opportunitySort" value="value">$ Value</MenuItemRadio>
          </MenuList></MenuPopover>
        </Menu>} onRefresh={() => void refreshOpportunities()} onToggle={() => toggleBlade('opportunities')} onClose={closeOpportunities} />
        {!collapsed.has('opportunities') && <div className="blade-body opportunity-tree" role="tree" aria-label={`${account.name} opportunities and milestones`}>
          {sortedOpportunities.map((item) => {
            const selected = opportunity?.id === item.id
            const expanded = expandedOpportunityId === item.id
            return <div key={item.id} className={`opportunity-node ${expanded ? 'expanded' : ''}`} role="treeitem" aria-expanded={expanded} aria-selected={selected}>
              <div className="opportunity-row">
                <Tooltip
                  content={<div className="opportunity-tooltip-content"><b>{item.name}</b><span>Opportunity owner: {item.owner ?? 'Not assigned'}</span><span>Stage owner: {stageOwner(item.recordedStage)}</span><span>Recorded stage: {item.recordedStage}</span><span>Value: {formatMoney(item.value, item.currency)}</span><span>Close: {item.closeDate}</span></div>}
                  positioning="above"
                  relationship="description"
                >
                  <button className={`opportunity-button ${selected ? 'selected' : ''}`} onClick={() => toggleOpportunity(item)} onContextMenu={(event) => { event.preventDefault(); openOpportunityComments(item) }}>
                    <span className="opportunity-main"><strong>{item.name}</strong><small>{item.owner ?? 'Owner not assigned'} · Stage {item.recordedStage} · {formatMoney(item.value, item.currency)} · {item.closeDate}</small></span>
                    {expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                  </button>
                </Tooltip>
                <Menu positioning="below-end">
                  <MenuTrigger disableButtonEnhancement><Button appearance="subtle" className="icon-button opportunity-actions" icon={<MoreHorizontal20Regular />} aria-label={`Edit ${item.name}`} title="Edit opportunity" /></MenuTrigger>
                  <MenuPopover><MenuList><MenuItem onClick={() => openOpportunityComments(item)}>Opportunity Comments</MenuItem></MenuList></MenuPopover>
                </Menu>
              </div>
              {selected && opportunityCommentsOpen && <div className="record-editor opportunity-editor" aria-label="Edit opportunity comments">
                <Field label="Opportunity Comments"><Textarea resize="vertical" value={opportunityComments} onChange={(_, data) => setOpportunityComments(data.value)} /></Field>
                <div className="record-editor-actions"><Button disabled={savingEdit} onClick={() => setOpportunityCommentsOpen(false)}>Cancel</Button><Button appearance="primary" disabled={savingEdit} onClick={() => void saveOpportunityComments()}>{savingEdit ? 'Saving...' : 'Save'}</Button></div>
              </div>}
              {expanded && <div className="milestone-tree" role="group" aria-label={`${item.name} milestones`}>
                <div className="milestone-tree-header">
                  <span>Milestones</span>
                  <div className="milestone-tree-actions">
                    <Menu checkedValues={{ milestoneSort: [milestoneSort] }} onCheckedValueChange={(_, data) => setMilestoneSort(data.checkedItems[0] as MilestoneSort)} positioning="below-end">
                      <MenuTrigger disableButtonEnhancement><Button appearance="subtle" className="tree-refresh-button" icon={<ArrowSort20Regular />} aria-label="Sort milestones" title="Sort milestones" /></MenuTrigger>
                      <MenuPopover><MenuList aria-label="Sort milestones by">
                        <MenuItemRadio name="milestoneSort" value="targetDate">Milestone Est. Date</MenuItemRadio>
                        <MenuItemRadio name="milestoneSort" value="estimatedMonthlyUsage">Est. Change in Monthly Usage ($ Value)</MenuItemRadio>
                        <MenuItemRadio name="milestoneSort" value="commitment">Customer Commitment</MenuItemRadio>
                        <MenuItemRadio name="milestoneSort" value="status">Milestone Status</MenuItemRadio>
                      </MenuList></MenuPopover>
                    </Menu>
                    <Button appearance="subtle" className="tree-refresh-button" disabled={loading} icon={<ArrowClockwise20Regular />} onClick={() => void refreshOpportunityContext()} aria-label="Refresh Milestones" title="Refresh milestones" />
                  </div>
                </div>
                {sortedMilestones.map((milestone) => <div key={milestone.id} className="milestone-edit-row">
                  <article className="milestone-item" role="treeitem">
                    <span className="milestone-status" aria-hidden="true"><ClipboardTaskListLtr20Regular /></span>
                    <span>
                      <strong>{milestone.name}</strong>
                      <small>{[milestone.status, milestone.owner, milestone.commitment, milestone.targetDate, milestone.estimatedMonthlyUsage === undefined ? undefined : formatMoney(milestone.estimatedMonthlyUsage, opportunity.currency)].filter(Boolean).join(' · ')}</small>
                    </span>
                    <Menu positioning="below-end">
                      <MenuTrigger disableButtonEnhancement><Button appearance="subtle" className="icon-button milestone-actions" icon={<MoreHorizontal20Regular />} aria-label={`Edit ${milestone.name}`} title="Edit milestone" /></MenuTrigger>
                      <MenuPopover><MenuList>
                        {(Object.keys(milestoneFieldLabels) as MilestoneField[]).map((field) => <MenuItem key={field} onClick={() => startMilestoneEdit(milestone, field)}>{milestoneFieldLabels[field]}</MenuItem>)}
                      </MenuList></MenuPopover>
                    </Menu>
                  </article>
                  {milestoneEdit?.milestoneId === milestone.id && <div className="record-editor" aria-label={`Edit ${milestoneFieldLabels[milestoneEdit.field]}`}>
                    <Field label={milestoneFieldLabels[milestoneEdit.field]}>
                      {milestoneEdit.field === 'status' && <select value={milestoneEdit.value} onChange={(event) => setMilestoneEdit({ ...milestoneEdit, value: event.target.value })}>{milestoneStatuses.map((value) => <option key={value}>{value}</option>)}</select>}
                      {milestoneEdit.field === 'customerCommitment' && <select value={milestoneEdit.value} onChange={(event) => setMilestoneEdit({ ...milestoneEdit, value: event.target.value })}>{customerCommitments.map((value) => <option key={value}>{value}</option>)}</select>}
                      {milestoneEdit.field === 'targetDate' && <Input type="date" value={milestoneEdit.value} onChange={(_, data) => setMilestoneEdit({ ...milestoneEdit, value: data.value })} />}
                      {(milestoneEdit.field === 'riskDetails' || milestoneEdit.field === 'comments') && <Textarea resize="vertical" value={milestoneEdit.value} onChange={(_, data) => setMilestoneEdit({ ...milestoneEdit, value: data.value })} />}
                    </Field>
                    <div className="record-editor-actions"><Button disabled={savingEdit} onClick={() => setMilestoneEdit(null)}>Cancel</Button><Button appearance="primary" disabled={savingEdit || (milestoneEdit.field === 'targetDate' && !milestoneEdit.value)} onClick={() => void saveMilestoneEdit()}>{savingEdit ? 'Saving...' : 'Save'}</Button></div>
                  </div>}
                </div>)}
                {loading && milestones.length === 0 && <div className="tree-state">Loading milestones…</div>}
                {!loading && milestones.length === 0 && <div className="tree-state">No active milestones found.</div>}
              </div>}
            </div>
          })}
        </div>}
        {collapsed.has('opportunities') && <button className="collapsed-symbol" onClick={() => toggleBlade('opportunities')} aria-label="Expand Opportunities"><List20Regular /></button>}
        {!collapsed.has('opportunities') && <BladeResizeHandle blade="opportunities" label="Opportunities blade" edge="end" width={bladeWidths.opportunities} onResize={(width) => resizeBlade('opportunities', width)} />}
      </section>}

      <section className={`center-pane ${mobileBlade === 'center' ? 'mobile-active' : ''}`} aria-label="Opportunity workbench">
        {!opportunity && <div className="landing-state">
          <span className="landing-icon">{account ? <Building20Regular /> : <Apps20Regular />}</span>
          <p className="eyebrow">{account ? 'ACCOUNT SELECTED' : 'MY ACCOUNT PORTFOLIO'}</p>
          <h1>{account?.name ?? 'Select a customer account'}</h1>
          <p>{account ? 'Choose an active opportunity to review its grounded MSX evidence and multi-agent guidance.' : 'Open an account blade, inspect its opportunities, then review grounded MSX evidence and multi-agent guidance.'}</p>
          <div className="landing-accounts">
            {account
              ? sortedOpportunities.map((item) => <button key={item.id} onClick={() => void selectOpportunity(item)}><List20Regular /><span><strong>{item.name}</strong><small>Stage {item.recordedStage} · {formatMoney(item.value, item.currency)}</small></span><ChevronRight20Regular /></button>)
              : accounts.map((item) => <button key={item.id} onClick={() => void selectAccount(item)}><Building20Regular /><span><strong>{item.name}</strong><small>{item.segment}</small></span><ChevronRight20Regular /></button>)}
          </div>
        </div>}

        {opportunity && <>
          <header className="workbench-header">
            <button className="icon-button mobile-only" onClick={() => setMobileBlade('opportunities')} title="Back to opportunities" aria-label="Back to opportunities"><ChevronLeft20Regular /></button>
            <div><p className="eyebrow">{account?.name}</p><h1>{opportunity.name}</h1><span>{opportunity.owner ?? 'Owner not assigned'} · Stage {opportunity.recordedStage} · {formatMoney(opportunity.value, opportunity.currency)} · closes {opportunity.closeDate}</span></div>
          </header>
          <div className="center-tabs" role="tablist" aria-label="Opportunity view">
            <button role="tab" aria-selected={centerTab === 'msx'} onClick={() => setCenterTab('msx')}>MSX</button>
            <button role="tab" aria-selected={centerTab === 'guidance'} onClick={() => loadGuidance()}>Multi-Agent Guidance</button>
            <button role="tab" aria-selected={centerTab === 'stages'} onClick={() => void loadStageBoard()}>MCEM Stage Management</button>
          </div>
          {loading && <div className="loading-state">Loading grounded context…</div>}
          {error && <div className="error-state">{error}</div>}
          {!loading && result && centerTab === 'msx' && <div className="workbench-content">
            <section className={`stage-band ${status ?? ''}`}>
              <div><span>Recorded in MSX</span><strong>Stage {result.recordedStage}</strong></div>
              <ChevronRight20Regular />
              <div><span>Evidence supports</span><strong>Stage {result.evidenceBasedStage}</strong></div>
              <p>{status === 'advance' ? <CheckmarkCircle20Filled /> : <Warning20Filled />}{result.summary}</p>
            </section>
            <div className="section-heading"><div><p className="eyebrow">EXIT CRITERIA</p><h2>Evidence review</h2></div><span>{result.criteria.filter((item) => item.status === 'met').length}/{result.criteria.length} met</span></div>
            <div className="criteria-table">
              {result.criteria.map((item) => <article key={item.id} className="criterion-row"><span className={`criterion-dot ${item.status}`}>{item.status === 'met' ? <CheckmarkCircle20Filled /> : <Warning20Filled />}</span><div><strong>{item.label}</strong><p>{item.rationale}</p></div><span className={`status-label ${item.status}`}>{item.status}</span></article>)}
            </div>
          </div>}
          {!loading && centerTab === 'guidance' && <div className="workbench-content guidance-view">
            <div className="agent-tabs" role="tablist" aria-label="Agent role">
              {capabilities.map((item) => <button key={item.id} role="tab" aria-selected={capability === item.id} onClick={() => loadGuidance(item.id)}>{item.label}</button>)}
            </div>
            <div className="agent-prompt-suggestions" aria-label={`${capabilities.find((item) => item.id === capability)?.label} suggested prompts`}>
              {suggestedPrompts[capability].map((prompt) => <button key={prompt} type="button" disabled={agentLoading} onClick={() => void runAgentPrompt(prompt)}>{prompt}</button>)}
            </div>
            <div className="agent-composer">
              <Textarea aria-label="Agent task" placeholder="Ask a different question..." resize="vertical" rows={2} value={taskPrompt} onChange={(_, data) => setTaskPrompt(data.value)} />
              <Button appearance="primary" disabled={agentLoading || taskPrompt.trim().length < 3} onClick={() => void runAgentPrompt()}>{agentLoading ? 'Analyzing...' : 'Send'}</Button>
            </div>
            {agentLoading && <Spinner label={`Running ${capabilities.find((item) => item.id === capability)?.label}`} />}
            {agentResult && !agentLoading ? <article className="agent-response">
              <header className="agent-response-header">
                <div><p className="eyebrow">{capabilities.find((item) => item.id === agentResult.capability)?.label}</p><small>Agent {agentResult.agentVersion}</small></div>
                <div className="response-actions" aria-label="Response actions">
                  <Button icon={<Mail20Regular />} disabled={shareStatus === 'running'} onClick={openEmailDialog}>Send Email</Button>
                  <Button icon={<ArrowDownload20Regular />} disabled={shareStatus === 'running'} onClick={() => void exportAgentResponse()}>Export</Button>
                </div>
              </header>
              {shareMessage && <MessageBar intent={shareStatus === 'error' ? 'error' : 'success'}>{shareMessage}</MessageBar>}
              <div className="agent-response-markdown">
                <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void client.openEvidence(href) }}>{children}</a> }}>{formatResponseMarkdown(agentResult.content)}</Markdown>
              </div>
            </article> : !agentLoading && <div className="empty-state compact">Choose a suggested prompt or ask a different question.</div>}
            <Dialog open={emailDialogOpen} onOpenChange={(_, data) => setEmailDialogOpen(data.open)}>
              <DialogSurface><DialogBody><DialogTitle>{client.mode === 'desktop' ? 'Open email message' : 'Download email draft'}</DialogTitle><DialogContent className="email-draft-form">
                <p>{client.mode === 'desktop' ? 'The prepared message opens in your default mail application for review before sending.' : 'A rich Outlook email draft downloads for review before sending.'}</p>
                <Field label="Recipients" hint="Separate addresses with commas or semicolons."><Input type="email" aria-label="Email recipients" value={emailRecipients} onChange={(_, data) => setEmailRecipients(data.value)} /></Field>
                <Field label="Subject"><Input aria-label="Email subject" value={emailSubject} onChange={(_, data) => setEmailSubject(data.value)} /></Field>
                {shareStatus === 'error' && shareMessage && <MessageBar intent="error">{shareMessage}</MessageBar>}
              </DialogContent><DialogActions>
                <Button onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
                <Button appearance="primary" icon={<Mail20Regular />} disabled={shareStatus === 'running' || !emailRecipients.trim() || !emailSubject.trim()} onClick={() => void openEmailCompose()}>{shareStatus === 'running' ? (client.mode === 'desktop' ? 'Opening...' : 'Preparing...') : (client.mode === 'desktop' ? 'Open Email' : 'Download Draft')}</Button>
              </DialogActions></DialogBody></DialogSurface>
            </Dialog>
          </div>}
          {!loading && centerTab === 'stages' && <div className="mcem-board-view">
            {boardLoading && <div className="loading-state">Evaluating stage gates for this account…</div>}
            <div className="mcem-board" aria-label={`MCEM stages for ${account?.name}`}>
              {mcemStages.map((stage) => <section
                key={stage.id}
                className="mcem-column"
                aria-label={`Stage ${stage.id}: ${stage.name}`}
                onDragOver={(event) => { const sourceStage = Number(event.dataTransfer.types.includes('application/x-mcem-stage') && event.dataTransfer.getData('application/x-mcem-stage')); if (Math.abs(stage.id - sourceStage) === 1) event.preventDefault() }}
                onDrop={(event) => { const id = event.dataTransfer.getData('text/plain'); const item = opportunities.find((candidate) => candidate.id === id); if (item) void proposeStageMove(item, stage.id) }}
              >
                <header><span>Stage {stage.id}</span><strong>{stage.name}</strong><small>{stage.role}</small></header>
                <div className="mcem-column-cards">
                  {opportunities.filter((item) => item.recordedStage === stage.id).map((item) => {
                    const evaluation = boardEvaluations[item.id]
                    const met = evaluation?.criteria.filter((criterion) => criterion.status === 'met').length ?? 0
                    const total = evaluation?.criteria.length ?? 0
                    return <article
                      key={item.id}
                      className={`mcem-card ${opportunity?.id === item.id ? 'selected' : ''}`}
                      draggable
                      onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.setData('application/x-mcem-stage', String(item.recordedStage)); event.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => void selectOpportunity(item)}
                    >
                      <strong>{item.name}</strong>
                      <span><Person20Regular />{item.owner ?? 'Unassigned'}</span>
                      <span className={total > 0 && met === total ? 'gates-met' : 'gates-open'}>{total ? `${met}/${total} exit criteria met` : 'Evaluating exit criteria'}</span>
                      <div className="mcem-card-actions">
                        <Button size="small" appearance="subtle" disabled={stage.id === 1} icon={<ChevronLeft20Regular />} aria-label={`Move ${item.name} to previous stage`} onClick={(event) => { event.stopPropagation(); void proposeStageMove(item, stage.id - 1) }} />
                        <Button size="small" appearance="subtle" disabled={stage.id === 5} icon={<ChevronRight20Regular />} aria-label={`Move ${item.name} to next stage`} onClick={(event) => { event.stopPropagation(); void proposeStageMove(item, stage.id + 1) }} />
                      </div>
                    </article>
                  })}
                </div>
              </section>)}
            </div>
            <Dialog open={pendingStageMove !== null} onOpenChange={(_, data) => { if (!data.open && !stageMoveSaving) setPendingStageMove(null) }}>
              <DialogSurface><DialogBody><DialogTitle>Confirm MCEM stage change</DialogTitle><DialogContent className="stage-move-dialog">
                {pendingStageMove && <>
                  <p><strong>{pendingStageMove.opportunity.name}</strong></p>
                  <p>Stage {pendingStageMove.opportunity.recordedStage} → Stage {pendingStageMove.targetStage}</p>
                  {pendingStageMove.evaluation.criteria.some((criterion) => criterion.status !== 'met') && pendingStageMove.targetStage > pendingStageMove.opportunity.recordedStage && <MessageBar intent="warning">Some exit criteria are incomplete. This move will be recorded as an exception.</MessageBar>}
                  {pendingStageMove.targetStage < pendingStageMove.opportunity.recordedStage && <MessageBar intent="warning">This move recycles the opportunity to a previous stage.</MessageBar>}
                  <div className="stage-gate-list">{pendingStageMove.evaluation.criteria.map((criterion) => <span key={criterion.id} className={criterion.status}>{criterion.label}: {criterion.status}</span>)}</div>
                  {(pendingStageMove.targetStage < pendingStageMove.opportunity.recordedStage || pendingStageMove.evaluation.criteria.some((criterion) => criterion.status !== 'met')) && <Field label="Reason" hint="Required; at least 10 characters."><Textarea value={stageMoveReason} onChange={(_, data) => setStageMoveReason(data.value)} /></Field>}
                </>}
              </DialogContent><DialogActions>
                <Button disabled={stageMoveSaving} onClick={() => setPendingStageMove(null)}>Cancel</Button>
                <Button appearance="primary" disabled={stageMoveSaving || (!!pendingStageMove && (pendingStageMove.targetStage < pendingStageMove.opportunity.recordedStage || pendingStageMove.evaluation.criteria.some((criterion) => criterion.status !== 'met')) && stageMoveReason.trim().length < 10)} onClick={() => void confirmStageMove()}>{stageMoveSaving ? 'Moving…' : 'Confirm move'}</Button>
              </DialogActions></DialogBody></DialogSurface>
            </Dialog>
          </div>}
        </>}
      </section>

      {opportunity && actionsOpen && <aside className={`blade action-blade ${collapsed.has('actions') ? 'collapsed' : ''} ${mobileBlade === 'actions' ? 'mobile-active' : ''}`} style={{ flexBasis: collapsed.has('actions') ? undefined : bladeWidths.actions }} aria-label="Next best actions blade">
        {!collapsed.has('actions') && <BladeResizeHandle blade="actions" label="Next best actions blade" edge="start" width={bladeWidths.actions} onResize={(width) => resizeBlade('actions', width)} />}
        <BladeHeader title="Next best actions" subtitle="Role based" collapsed={collapsed.has('actions')} refreshing={loading} onRefresh={() => void refreshOpportunityContext()} onToggle={() => toggleBlade('actions')} onClose={() => { setActionsOpen(false); setMobileBlade('center') }} />
        {!collapsed.has('actions') && <div className="blade-body action-list">
          {result?.recommendations.map((item, index) => <article key={item.id} className="action-item">
            <div className="action-meta"><span>{index + 1}</span><b>{item.ownerRole}</b></div>
            <h3>{item.action}</h3><p>{item.rationale}</p><small>{item.confidence} confidence · {item.evidenceIds.length} citations</small>
          </article>)}
        </div>}
        {collapsed.has('actions') && <button className="collapsed-symbol" onClick={() => toggleBlade('actions')} aria-label="Expand Next best actions"><PanelRight20Regular /></button>}
      </aside>}
    </main>

    {opportunity && <nav className="mobile-nav" aria-label="Mobile workspace navigation">
      <button className={mobileBlade === 'accounts' ? 'active' : ''} onClick={() => setMobileBlade('accounts')}><Building20Regular /><span>Accounts</span></button>
      <button className={mobileBlade === 'opportunities' ? 'active' : ''} onClick={() => setMobileBlade('opportunities')}><List20Regular /><span>Opportunities</span></button>
      <button className={mobileBlade === 'center' ? 'active' : ''} onClick={() => setMobileBlade('center')}><Lightbulb20Regular /><span>Analysis</span></button>
      <button className={mobileBlade === 'actions' ? 'active' : ''} onClick={() => { setActionsOpen(true); setMobileBlade('actions') }}><PanelRight20Regular /><span>Actions</span></button>
    </nav>}
  </div>
}

export function RevampApp() {
  const shell = document.documentElement.dataset['shell'] === 'desktop' ? 'desktop' : 'web'
  const theme = document.documentElement.dataset['theme'] === 'dark' ? webDarkTheme : webLightTheme
  const [client] = useState(() => createDataClient(shell))
  return <FluentProvider className="fluent-provider" theme={theme}>
    <div className="fluent-root">
      <App shell={shell} client={client} />
    </div>
  </FluentProvider>
}