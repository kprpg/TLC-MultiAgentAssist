import { Fragment, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import * as c from '../../../../packages/common/contracts/index.js'
import { seDomainDefinitions, seDomainIds, type SeDomainId } from '../../../../packages/common/configuration/se-domains.js'
import { AddCustomerButton, type CustomerSearchClient } from '../../../shared/add-customer.js'
import { DiscoveryControls, DiscoverySortHeader } from '../../../shared/discovery-controls.js'
import {
  discoveryCustomers, filterDiscoveryOpportunities, sortDiscoveryOpportunities, toggleDiscoverySort,
  type DiscoveryFilters, type DiscoverySort
} from '../../../shared/discovery.js'
import { filterVisibleMilestones } from '../../../shared/milestone-visibility.js'
import type { TeamsApiClient } from './data-client.js'
import './discovery.css'

type ReviewedAction = (operation: string, input: Record<string, unknown>) => Promise<unknown>

export function DiscoveryWorkspace({ client, mode, active, searchClient, onAction, boundAccountId }: {
  client: TeamsApiClient; mode: 'sample' | 'live'; active: boolean; searchClient: CustomerSearchClient
  onAction: ReviewedAction; boundAccountId?: string
}) {
  const [domain, setDomain] = useState<SeDomainId>('infra')
  const [opportunities, setOpportunities] = useState<c.DiscoverableOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [filters, setFilters] = useState<DiscoveryFilters>({ include: [], exclude: [] })
  const [sort, setSort] = useState<DiscoverySort | null>(null)
  const [expandedId, setExpandedId] = useState<string>()
  const visible = useMemo(() => sortDiscoveryOpportunities(filterDiscoveryOpportunities(opportunities, filters), sort), [opportunities, filters, sort])
  const customers = useMemo(() => discoveryCustomers(opportunities), [opportunities])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setOpportunities([]); setLoading(true); setError(''); setExpandedId(undefined)
    client.operation('discoverOpportunities', { domain }, z.array(c.discoverableOpportunitySchema), controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setOpportunities(boundAccountId ? items.filter((item) => item.accountId === boundAccountId) : items)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) { setError(String(cause)); setLoading(false) }
      })
    return () => controller.abort()
  }, [client, active, domain, refreshVersion, boundAccountId])

  return <section className="teams-discovery" aria-label="Discover opportunities" aria-busy={loading} hidden={!active}>
    <header className="teams-discovery-header">
      <h1>Discover opportunities</h1>
      <p>Review all active opportunities for visible accounts and add or remove yourself from the Deal Team &mdash; or expand an opportunity to join a milestone team without joining the Deal Team. Deal Team or milestone-team membership brings an opportunity into Portfolio.</p>
      {!boundAccountId && <AddCustomerButton client={searchClient} dataMode={mode} onAdded={() => {
        setFilters({ include: [], exclude: [] })
        setRefreshVersion((value) => value + 1)
      }} />}
      <p className="teams-discovery-note">Adding a customer is separate from joining a Deal Team or milestone team. Membership changes require explicit review.</p>
      <div className="teams-discovery-toolbar">
        <nav className="teams-discovery-domains" role="tablist" aria-label="Solution Engineer domain" onKeyDown={(event) => {
          const index = seDomainIds.indexOf(domain)
          const next = event.key === 'ArrowRight' ? (index + 1) % seDomainIds.length
            : event.key === 'ArrowLeft' ? (index + seDomainIds.length - 1) % seDomainIds.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? seDomainIds.length - 1 : undefined
          if (next === undefined) return
          const nextDomain = seDomainIds[next]
          if (!nextDomain) return
          event.preventDefault()
          setDomain(nextDomain)
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
          {seDomainIds.map((id) => <button key={id} type="button" role="tab" aria-selected={domain === id}
            tabIndex={domain === id ? 0 : -1} onClick={() => setDomain(id)}>{seDomainDefinitions[id].label}</button>)}
        </nav>
        <button type="button" className="teams-discovery-refresh" aria-label="Refresh Discover" disabled={loading}
          onClick={() => setRefreshVersion((value) => value + 1)}>Refresh</button>
      </div>
    </header>
    <DiscoveryControls customers={customers} filters={filters} onChange={setFilters}
      visibleCount={visible.length} totalCount={opportunities.length} loading={loading} />
    {loading && <div className="discovery-loading" role="status">Loading Discover opportunities... {mode === 'live' ? 'Checking your current visible accounts and source opportunities. Navigation remains available while the source responds.' : ''}</div>}
    {error && <p role="alert" className="error-banner">{error}. Use Refresh to retry.</p>}
    {!loading && !error && opportunities.length === 0 && <p>No eligible opportunities for this source scope and domain.</p>}
    {!loading && !error && opportunities.length > 0 && visible.length === 0 && <p role="status">No opportunities match your customer filters. Clear filters to show all customers.</p>}
    {visible.length > 0 && <div className="record-table-wrap" role="region" aria-label="Discover opportunity table" tabIndex={0}>
      <table className="teams-discovery-table" aria-label="Discovered opportunities">
        <thead><tr><th scope="col">Opportunity</th>
          <DiscoverySortHeader column="account" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} />
          <th scope="col">Technical capability</th>
          <DiscoverySortHeader column="stage" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} />
          <DiscoverySortHeader column="action" sort={sort} onSort={(column) => setSort((current) => toggleDiscoverySort(current, column))} />
        </tr></thead>
        <tbody>{visible.map((item) => <DiscoveryOpportunityRow key={item.id} client={client} item={item} domain={domain}
          expanded={expandedId === item.id} onExpand={() => setExpandedId((current) => current === item.id ? undefined : item.id)}
          onAction={onAction} onDealTeamChanged={(onDealTeam) => setOpportunities((current) => current.map((entry) => entry.id === item.id ? { ...entry, onDealTeam } : entry))} />)}</tbody>
      </table>
    </div>}
  </section>
}

function DiscoveryOpportunityRow({ client, item, domain, expanded, onExpand, onAction, onDealTeamChanged }: {
  client: TeamsApiClient; item: c.DiscoverableOpportunity; domain: SeDomainId; expanded: boolean
  onExpand(): void; onAction: ReviewedAction; onDealTeamChanged(onDealTeam: boolean): void
}) {
  const [milestones, setMilestones] = useState<c.Milestone[]>([])
  const [milestoneState, setMilestoneState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [milestoneError, setMilestoneError] = useState('')
  const [milestoneRevision, setMilestoneRevision] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const visibleMilestones = filterVisibleMilestones(milestones)

  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setMilestoneState('loading'); setMilestoneError('')
    client.operation('listDiscoverableMilestones', { opportunityId: item.id }, z.array(c.milestoneSchema), controller.signal)
      .then((items) => { if (!controller.signal.aborted) { setMilestones(items); setMilestoneState('ready') } })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) { setMilestoneError(String(cause)); setMilestoneState('error') }
      })
    return () => controller.abort()
  }, [client, item.id, expanded, milestoneRevision])

  async function changeDealTeam() {
    setBusy('deal-team'); setError('')
    try {
      const result = item.onDealTeam
        ? c.dealTeamLeaveResultSchema.parse(await onAction('leaveDealTeam', { opportunityId: item.id }))
        : c.dealTeamJoinResultSchema.parse(await onAction('joinDealTeam', { opportunityId: item.id, domain }))
      if (result.opportunityId !== item.id) throw new Error('The reviewed membership result does not match this opportunity. Check Activity before retrying.')
      onDealTeamChanged(result.onDealTeam)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(null) }
  }

  async function changeMilestoneTeam(milestone: c.Milestone) {
    setBusy(`milestone:${milestone.id}`); setError('')
    try {
      const input = { opportunityId: item.id, milestoneId: milestone.id }
      const result = milestone.onMilestoneTeam
        ? c.milestoneTeamLeaveResultSchema.parse(await onAction('leaveMilestoneTeam', input))
        : c.milestoneTeamJoinResultSchema.parse(await onAction('joinMilestoneTeam', { ...input, domain }))
      if (result.opportunityId !== item.id || result.milestoneId !== milestone.id) {
        throw new Error('The reviewed membership result does not match this milestone. Check Activity before retrying.')
      }
      setMilestones((current) => current.map((entry) => entry.id === milestone.id ? { ...entry, onMilestoneTeam: result.onMilestoneTeam } : entry))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(null) }
  }

  return <Fragment>
    <tr>
      <td><span className="teams-discovery-name">
        <button type="button" className="teams-discovery-expand" aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} milestones for ${item.name}`} onClick={onExpand}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>
        </button><strong>{item.name}</strong>
      </span></td>
      <td>{item.accountName ?? '-'}</td><td>{item.technicalCapability ?? '-'}</td><td>{item.recordedStage}</td>
      <td><div className="teams-discovery-membership">
        {item.onDealTeam && <span className="teams-discovery-joined">On deal team</span>}
        <button type="button" className={`link${item.onDealTeam ? ' teams-discovery-remove' : ''}`} disabled={busy !== null}
          title={item.onDealTeam ? 'Review leaving Deal Team' : 'Review joining Deal Team'} onClick={() => { void changeDealTeam() }}>
          {busy === 'deal-team' ? item.onDealTeam ? 'Removing...' : 'Adding...' : item.onDealTeam ? 'Remove me' : 'Add me'}
        </button>
      </div>{error && <p className="error-banner" role="alert">{error}</p>}</td>
    </tr>
    {expanded && <tr className="discover-milestones-row" aria-label={`${item.name} milestones`}><td colSpan={5}>
      {(milestoneState === 'idle' || milestoneState === 'loading') && <p role="status">Loading milestones...</p>}
      {milestoneState === 'error' && <div role="alert" className="error-banner">{milestoneError}
        <button type="button" onClick={() => setMilestoneRevision((value) => value + 1)}>Retry milestones</button>
      </div>}
      {milestoneState === 'ready' && visibleMilestones.length === 0 && <p className="muted">No milestones found for this opportunity.</p>}
      {milestoneState === 'ready' && visibleMilestones.map((milestone) => <div className="teams-discovery-milestone" key={milestone.id}>
        <button type="button" className={`teams-discovery-milestone-toggle${milestone.onMilestoneTeam ? ' is-member' : ''}`}
          aria-pressed={milestone.onMilestoneTeam === true} disabled={busy !== null}
          aria-label={`${milestone.onMilestoneTeam ? 'Remove me from' : 'Add me to'} the team for ${milestone.name}`}
          title={milestone.onMilestoneTeam ? 'Review leaving milestone team' : 'Review joining milestone team'}
          onClick={() => { void changeMilestoneTeam(milestone) }}>
          {busy === `milestone:${milestone.id}` ? '...' : milestone.onMilestoneTeam ? '-' : '+'}
        </button><span><strong>{milestone.name}</strong> - {milestone.status}{milestone.targetDate ? ` - ${milestone.targetDate}` : ''}</span>
      </div>)}
    </td></tr>}
  </Fragment>
}
