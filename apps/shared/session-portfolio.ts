import * as c from '../../packages/common/contracts/index.js'
import type { SeDomainId } from '../../packages/common/configuration/se-domains.js'
import { SessionCache, type SessionCacheOptions, type SessionCacheValue } from './session-cache.js'

export interface SessionPortfolioSource {
  getPortfolioIndex(): Promise<c.PortfolioIndex>
  getDiscoverySnapshot(): Promise<c.DiscoverySnapshot>
  listMilestones(opportunityId: string): Promise<c.Milestone[]>
  listDiscoverableMilestones(opportunityId: string): Promise<c.Milestone[]>
}
interface DraftBaseline {
  fields: ReadonlyMap<string, unknown>
  opportunity?: c.Opportunity
  milestone?: c.Milestone
}

export class SessionPortfolio {
  private readonly portfolio: SessionCacheValue<c.PortfolioIndex>
  private readonly discovery: SessionCacheValue<c.DiscoverySnapshot>
  readonly cache: SessionCache
  private refreshRequested = false
  private readonly draftFields = new Map<string, unknown>()
  private draftBytes = 0
  private draftOverflow = false
  private readonly capturedVisibleAccounts = new Set<string>()
  private get generation(): number { return this.cache.generation }

  constructor(private readonly source: SessionPortfolioSource, options: SessionCacheOptions = {}) {
    this.cache = new SessionCache(options)
    this.portfolio = this.cache.value('portfolio')
    this.discovery = this.cache.value('discovery')
    this.discovery.derivedKeys = ['portfolio']
    this.discovery.onLoad = (snapshot, source) => {
      this.capturedVisibleAccounts.clear()
      for (const account of source.accounts) if (account.visibility !== 'hidden') this.capturedVisibleAccounts.add(account.id)
      this.portfolio.replaceDerived({
        contractVersion: c.portfolioReadVersion, accounts: snapshot.accounts, opportunities: snapshot.portfolioOpportunities
      }, !this.discovery.isStale())
    }
    let generation = this.cache.generation
    this.cache.subscribe(() => {
      if (generation === this.cache.generation) return
      generation = this.cache.generation
      this.resetDrafts(); this.capturedVisibleAccounts.clear()
    })
  }

  readonly subscribe = (listener: () => void): (() => void) => this.cache.subscribe(listener)
  readonly getRevision = (): number => this.cache.getRevision()
  readonly getState = () => this.cache.getState()
  setActive(active: boolean): void { this.cache.setActive(active) }
  setActiveKeys(keys: readonly string[]): void {
    this.cache.setActiveKeys(this.discovery.loaded && keys.includes('portfolio')
      ? [...new Set([...keys.filter((key) => key !== 'portfolio'), 'discovery'])] : keys)
  }
  dispose(): void { this.cache.dispose() }
  readDataset<T>(key: string, load: () => Promise<T>, options: { reference?: boolean } = {}): Promise<T> {
    return this.cache.value<T>(key, options.reference).read(load)
  }
  invalidateDataset(key: string): void { this.cache.invalidate(key) }

  clear(): void {
    this.cache.clear()
    this.resetDrafts()
    this.capturedVisibleAccounts.clear()
    this.refreshRequested = false
    this.portfolio.clear(); this.discovery.clear()
  }

  private milestoneValue(opportunityId: string): SessionCacheValue<c.Milestone[]> {
    return this.cache.value<c.Milestone[]>(`milestones:${opportunityId}`)
  }

  captureDraft(opportunityId: string): void {
    const opportunity = this.portfolio.peek()?.opportunities.find((item) => item.id === opportunityId)
      ?? this.discovery.peek()?.opportunities.find((item) => item.id === opportunityId)
    if (opportunity) for (const field of ['comments', 'recordedStage'] as const) {
      const key = `opportunity:${opportunityId}:${field}`
      if (!this.putDraft(key, opportunity[field] ?? '')) return
    }
    for (const milestone of this.cache.existing<c.Milestone[]>(`milestones:${opportunityId}`)?.peek() ?? []) {
      for (const field of ['comments', 'status', 'targetDate', 'commitment', 'riskDetails'] as const) {
        const key = `milestone:${opportunityId}:${milestone.id}:${field}`
        if (!this.putDraft(key, milestone[field] ?? '')) return
      }
    }
  }

  captureField(opportunityId: string, field: string, observed: unknown, options: { milestoneId?: string; reset?: boolean } = {}): void {
    const name = field === 'customerCommitment' ? 'commitment' : field
    if (!(options.milestoneId ? ['comments', 'status', 'targetDate', 'commitment', 'riskDetails'] : ['comments', 'recordedStage']).includes(name)) {
      this.draftOverflow = true
      this.cache.reportError(new Error('This editor has no valid source-field context. Review current source values before confirming its changes.'))
      return
    }
    const key = options.milestoneId ? `milestone:${opportunityId}:${options.milestoneId}:${name}` : `opportunity:${opportunityId}:${name}`
    if (options.reset) this.deleteDraft(key)
    this.putDraft(key, observed ?? '')
  }

  private putDraft(key: string, value: unknown): boolean {
    if (this.draftFields.has(key)) return true
    const bytes = new TextEncoder().encode(JSON.stringify([key, value])).byteLength
    if (this.draftFields.size >= this.cache.policy.maxInactiveEntries * 10 || this.draftBytes + bytes > this.cache.policy.maxSerializedBytes) {
      this.draftOverflow = true
      this.cache.reportError(new Error('Unsent draft memory is full. Keep existing drafts and use the current-source review before submitting another edit.'))
      return false
    }
    this.draftFields.set(key, value); this.draftBytes += bytes
    return true
  }
  private deleteDraft(key: string): void {
    if (!this.draftFields.has(key)) return
    this.draftBytes -= new TextEncoder().encode(JSON.stringify([key, this.draftFields.get(key)])).byteLength
    this.draftFields.delete(key)
  }
  private resetDrafts(): void { this.draftFields.clear(); this.draftBytes = 0; this.draftOverflow = false }

  captureReview(operation: c.SyncMutationOperation, input: Record<string, unknown>): ((review: c.MutationReview) => void) | undefined {
    if (!['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'].includes(operation)) return undefined
    const generation = this.generation
    const opportunityId = String(input['opportunityId'])
    const opportunity = this.portfolio.peek()?.opportunities.find((item) => item.id === opportunityId)
      ?? this.discovery.peek()?.opportunities.find((item) => item.id === opportunityId)
    const milestone = this.cache.existing<c.Milestone[]>(`milestones:${opportunityId}`)?.peek()?.find((item) => item.id === input['milestoneId'])
    const prefix = operation === 'updateMilestone' ? `milestone:${opportunityId}:${String(input['milestoneId'])}:` : `opportunity:${opportunityId}:`
    const baseline: DraftBaseline = {
      fields: new Map([...this.draftFields].filter(([key]) => key.startsWith(prefix))),
      ...(opportunity ? { opportunity } : {}), ...(milestone ? { milestone } : {})
    }
    const needed = operation === 'updateMilestone' ? Object.keys(c.milestoneUpdateSchema.parse(input['update'])).map((field) =>
      `${prefix}${field === 'customerCommitment' ? 'commitment' : field}`) : [`${prefix}${operation === 'transitionOpportunityStage' ? 'recordedStage' : 'comments'}`]
    const unverified = this.draftOverflow && needed.some((key) => !baseline.fields.has(key))
    return (review) => {
      this.assertGeneration(generation)
      if (unverified) throw new Error('The original edit base could not be retained. Review current source values before explicitly confirming this draft.')
      this.validateMutationReview(review, baseline)
    }
  }

  discardDraft(opportunityId: string): void {
    for (const key of this.draftFields.keys()) {
      if (key.startsWith(`opportunity:${opportunityId}:`) || key.startsWith(`milestone:${opportunityId}:`)) this.deleteDraft(key)
    }
  }

  validateMutationReview(review: c.MutationReview, baseline?: DraftBaseline): void {
    if (!['updateOpportunity', 'updateMilestone', 'transitionOpportunityStage'].includes(review.operation)) return
    const input = review.input
    const fields = baseline?.fields ?? this.draftFields
    const opportunityId = String(input['opportunityId'])
    const envelope = review.before !== null && typeof review.before === 'object' && 'source' in review.before
      ? review.before.source : review.before
    const before = envelope !== null && typeof envelope === 'object' ? envelope : undefined
    if (!before) throw new Error('Current source values must be reviewed before background saving.')
    if (review.operation === 'updateMilestone') {
      const items = 'milestones' in before ? c.milestoneSchema.array().parse(before.milestones) : []
      const source = items.find((item) => item.id === input['milestoneId'])
      const cached = baseline ? baseline.milestone : this.cache.existing<c.Milestone[]>(`milestones:${opportunityId}`)?.peek()?.find((item) => item.id === input['milestoneId'])
      if (!source || !cached) throw new Error('Refresh this milestone and review its current values before saving.')
      for (const field of Object.keys(c.milestoneUpdateSchema.parse(input['update']))) {
        const key = field === 'customerCommitment' ? 'commitment' : field
        const value = (item: c.Milestone): unknown => key === 'comments' ? item.comments : key === 'status' ? item.status
          : key === 'targetDate' ? item.targetDate : key === 'commitment' ? item.commitment : item.riskDetails
        const original = fields.has(`milestone:${opportunityId}:${cached.id}:${key}`) ? fields.get(`milestone:${opportunityId}:${cached.id}:${key}`) : value(cached) ?? ''
        if ((value(source) ?? '') !== original) throw new Error('The source changed while you were editing. Keep your draft and review the latest milestone before saving.')
      }
    } else {
      const source = 'opportunity' in before ? c.opportunitySchema.parse(before.opportunity) : undefined
      const cached = baseline ? baseline.opportunity : this.portfolio.peek()?.opportunities.find((item) => item.id === opportunityId)
        ?? this.discovery.peek()?.opportunities.find((item) => item.id === opportunityId)
      if (!source || !cached) throw new Error('Refresh this opportunity and review current source values before saving.')
      const field = review.operation === 'updateOpportunity' ? 'comments' : 'recordedStage'
      const key = `opportunity:${opportunityId}:${field}`
      const original = fields.has(key) ? fields.get(key) : cached[field] ?? ''
      if ((source[field] ?? '') !== original) throw new Error('The source changed while you were editing. Keep your draft and review current opportunity values before saving.')
    }
  }

  finishDraft(operation: c.SyncMutationOperation, input: Record<string, unknown>): void {
    if (operation === 'updateOpportunity') this.deleteDraft(`opportunity:${String(input['opportunityId'])}:comments`)
    if (operation === 'transitionOpportunityStage') this.deleteDraft(`opportunity:${String(input['opportunityId'])}:recordedStage`)
    if (operation === 'updateMilestone') for (const field of Object.keys(c.milestoneUpdateSchema.parse(input['update']))) {
      this.deleteDraft(`milestone:${String(input['opportunityId'])}:${String(input['milestoneId'])}:${field === 'customerCommitment' ? 'commitment' : field}`)
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new DOMException('The source session was refreshed.', 'AbortError')
  }

  refresh(opportunityId?: string): void {
    if (opportunityId) {
      this.cache.existing<c.Milestone[]>(`milestones:${opportunityId}`)?.invalidate()
      return
    }
    this.refreshRequested = true
    this.cache.invalidateAll()
  }

  async getDiscoverySnapshot(): Promise<c.DiscoverySnapshot> {
    const generation = this.generation
    const snapshot = await this.discovery.read(async () => c.discoverySnapshotSchema.parse(await this.source.getDiscoverySnapshot()))
    this.assertGeneration(generation)
    if (!this.discovery.isStale()) this.refreshRequested = false
    const visible = new Set(snapshot.accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    return {
      ...snapshot,
      opportunities: snapshot.opportunities.filter((opportunity) => visible.has(opportunity.accountId)),
      portfolioOpportunities: snapshot.portfolioOpportunities.filter((opportunity) => visible.has(opportunity.accountId))
    }
  }

  async getPortfolioIndex(includeHidden = false): Promise<c.PortfolioIndex> {
    const generation = this.generation
    const index = await this.portfolio.read(async () => {
      if (this.refreshRequested) {
        const snapshot = await this.getDiscoverySnapshot()
        return { contractVersion: c.portfolioReadVersion, accounts: snapshot.accounts, opportunities: snapshot.portfolioOpportunities }
      }
      return c.portfolioIndexSchema.parse(await this.source.getPortfolioIndex())
    })
    this.assertGeneration(generation)
    const visible = new Set(index.accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    return {
      ...index,
      accounts: includeHidden ? index.accounts : index.accounts.filter((account) => visible.has(account.id)),
      opportunities: index.opportunities.filter((opportunity) => visible.has(opportunity.accountId))
    }
  }

  async listAccounts(includeHidden = false): Promise<c.Account[]> {
    const generation = this.generation
    const index = await this.getPortfolioIndex(includeHidden)
    this.assertGeneration(generation)
    return index.accounts
  }

  async listOpportunities(accountId: string): Promise<c.Opportunity[]> {
    const generation = this.generation
    const index = await this.getPortfolioIndex()
    this.assertGeneration(generation)
    return index.opportunities.filter((opportunity) => opportunity.accountId === accountId)
  }

  async getPortfolioWorkspace(input: c.PortfolioWorkspaceRequest): Promise<c.PortfolioWorkspace> {
    const generation = this.generation
    const request = c.portfolioWorkspaceRequestSchema.parse(input)
    const index = await this.getPortfolioIndex(request.includeHidden)
    this.assertGeneration(generation)
    const account = request.accountId ? index.accounts.find((item) => item.id === request.accountId && item.visibility !== 'hidden')
      : index.accounts.find((item) => item.visibility !== 'hidden')
    if (request.accountId && !account) throw new Error('The selected account is not in the current visible portfolio.')
    const opportunities = index.opportunities.filter((item) => item.accountId === account?.id)
    const opportunity = request.opportunityId ? opportunities.find((item) => item.id === request.opportunityId) : opportunities[0]
    if (request.opportunityId && !opportunity) throw new Error('The selected opportunity is not in the selected account portfolio.')
    const milestones = opportunity ? await this.listMilestones(opportunity.id) : []
    this.assertGeneration(generation)
    return {
      contractVersion: c.portfolioReadVersion, accounts: index.accounts, opportunities,
      milestones,
      ...(account ? { selectedAccountId: account.id } : {}),
      ...(opportunity ? { selectedOpportunityId: opportunity.id } : {})
    }
  }

  async discoverOpportunities(domain: SeDomainId): Promise<c.DiscoverableOpportunity[]> {
    const generation = this.generation
    const snapshot = await this.getDiscoverySnapshot()
    this.assertGeneration(generation)
    const visible = new Set(snapshot.accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    return snapshot.opportunities.filter((opportunity) => opportunity.domain === domain && visible.has(opportunity.accountId))
  }

  listMilestones(opportunityId: string, discoverable = false): Promise<c.Milestone[]> {
    const value = this.milestoneValue(opportunityId)
    return value.read(async () => c.milestoneSchema.array().parse(await (discoverable
      ? this.source.listDiscoverableMilestones(opportunityId) : this.source.listMilestones(opportunityId))))
  }

  applyMutation(operation: string, result: unknown): void {
    switch (operation) {
      case 'addAccount':
      case 'setAccountVisibility': {
        const account = c.accountSchema.parse(result)
        const expandedScope = account.visibility !== 'hidden' && (this.discovery.loaded || this.discovery.refreshing)
          && !this.capturedVisibleAccounts.has(account.id)
        const update = (accounts: c.Account[]) => [...accounts.filter((item) => item.id !== account.id), account]
          .sort((left, right) => left.name.localeCompare(right.name))
        this.portfolio.update((index) => ({ ...index, accounts: update(index.accounts) }))
        this.discovery.update((snapshot) => ({ ...snapshot, accounts: update(snapshot.accounts) }))
        this.cache.updateMatching('search:', (value) => c.accountCandidateSchema.array().parse(value).map((candidate) =>
          candidate.id === account.id ? { ...candidate, state: account.visibility === 'hidden' ? 'hidden' : 'visible' } : candidate))
        if (expandedScope) {
          this.refreshRequested = true
          this.discovery.invalidate()
          this.portfolio.invalidate()
        }
        break
      }
      case 'joinDealTeam':
      case 'leaveDealTeam': {
        const membership = operation === 'joinDealTeam' ? c.dealTeamJoinResultSchema.parse(result) : c.dealTeamLeaveResultSchema.parse(result)
        this.discovery.update((snapshot) => {
          const discovered = snapshot.opportunities.find((item) => item.id === membership.opportunityId)
          return {
            ...snapshot, opportunities: snapshot.opportunities.map((item) =>
              item.id === membership.opportunityId ? { ...item, onDealTeam: membership.onDealTeam } : item),
            portfolioOpportunities: membership.onDealTeam && discovered && !snapshot.portfolioOpportunities.some((item) => item.id === membership.opportunityId)
              ? [...snapshot.portfolioOpportunities, c.opportunitySchema.parse(discovered)]
              : !membership.onDealTeam && !snapshot.milestoneTeamOpportunityIds.includes(membership.opportunityId)
                ? snapshot.portfolioOpportunities.filter((item) => item.id !== membership.opportunityId) : snapshot.portfolioOpportunities
          }
        })
        this.updatePortfolioMembership(membership.opportunityId, membership.onDealTeam, 'deal-team')
        break
      }
      case 'joinMilestoneTeam':
      case 'leaveMilestoneTeam': {
        const membership = operation === 'joinMilestoneTeam' ? c.milestoneTeamJoinResultSchema.parse(result) : c.milestoneTeamLeaveResultSchema.parse(result)
        this.cache.existing<c.Milestone[]>(`milestones:${membership.opportunityId}`)?.update((items) => items.map((item) =>
          item.id === membership.milestoneId ? { ...item, onMilestoneTeam: membership.onMilestoneTeam } : item))
        const otherMembership = this.cache.existing<c.Milestone[]>(`milestones:${membership.opportunityId}`)?.peek()?.some((item) => item.onMilestoneTeam)
        this.discovery.update((snapshot) => {
          const discovered = snapshot.opportunities.find((item) => item.id === membership.opportunityId)
          return {
            ...snapshot, milestoneTeamOpportunityIds: membership.onMilestoneTeam || otherMembership
              ? [...new Set([...snapshot.milestoneTeamOpportunityIds, membership.opportunityId])]
              : otherMembership === false ? snapshot.milestoneTeamOpportunityIds.filter((id) => id !== membership.opportunityId)
                : snapshot.milestoneTeamOpportunityIds,
            portfolioOpportunities: membership.onMilestoneTeam && discovered && !snapshot.portfolioOpportunities.some((item) => item.id === membership.opportunityId)
              ? [...snapshot.portfolioOpportunities, c.opportunitySchema.parse(discovered)]
              : !membership.onMilestoneTeam && otherMembership === false && discovered?.onDealTeam === false
                ? snapshot.portfolioOpportunities.filter((item) => item.id !== membership.opportunityId) : snapshot.portfolioOpportunities
          }
        })
        this.updatePortfolioMembership(membership.opportunityId, membership.onMilestoneTeam || otherMembership === true, 'milestone-team')
        break
      }
      case 'updateOpportunity':
      case 'transitionOpportunityStage': {
        const opportunity = operation === 'updateOpportunity' ? c.opportunitySchema.parse(result) : c.mcemStageTransitionResultSchema.parse(result).opportunity
        this.portfolio.update((index) => ({ ...index, opportunities: index.opportunities.map((item) => item.id === opportunity.id ? opportunity : item) }))
        this.discovery.update((snapshot) => ({
          ...snapshot,
          portfolioOpportunities: snapshot.portfolioOpportunities.map((item) => item.id === opportunity.id ? opportunity : item),
          opportunities: snapshot.opportunities.map((item) => item.id === opportunity.id ? { ...item, ...opportunity } : item)
        }))
        break
      }
      case 'updateMilestone': {
        const milestone = c.milestoneSchema.parse(result)
        this.cache.existing<c.Milestone[]>(`milestones:${milestone.opportunityId}`)?.update((items) => items.map((item) => item.id === milestone.id ? milestone : item))
        break
      }
      case 'commitRecordCreation':
        if (c.recordCreationResultSchema.parse(result).state === 'committed') this.refresh()
        break
      case 'applyMeetingChangeSet':
        if (c.meetingChangeSetResultSchema.parse(result).state === 'applied') this.refresh()
        break
    }
  }

  private updatePortfolioMembership(opportunityId: string, joining: boolean, kind: 'deal-team' | 'milestone-team'): void {
    const snapshot = this.discovery.peek()
    const discovered = snapshot?.opportunities.find((item) => item.id === opportunityId)
    const milestones = this.cache.existing<c.Milestone[]>(`milestones:${opportunityId}`)?.peek()
    const retained = kind === 'deal-team'
      ? milestones?.some((item) => item.onMilestoneTeam) ?? snapshot?.milestoneTeamOpportunityIds.includes(opportunityId)
      : discovered?.onDealTeam
    if (!joining && retained === undefined) {
      this.portfolio.clear()
      return
    }
    const opportunity = discovered ? c.opportunitySchema.parse(discovered) : undefined
    this.portfolio.update((index) => ({
      ...index,
      opportunities: joining && opportunity && !index.opportunities.some((item) => item.id === opportunityId)
        ? [...index.opportunities, opportunity].sort((left, right) => left.name.localeCompare(right.name))
        : !joining && retained === false ? index.opportunities.filter((item) => item.id !== opportunityId) : index.opportunities
    }))
  }
}

export function waitForSessionRead<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void read.then((value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}
