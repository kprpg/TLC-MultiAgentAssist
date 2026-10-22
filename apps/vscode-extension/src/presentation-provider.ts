import { SessionPortfolio } from '../../shared/session-portfolio.js'
import type { ExtensionDataProvider } from './data-provider.js'
import type { SyncMutationOperation } from '../../../packages/common/contracts/cache-sync.js'

export function withPresentationCache(source: ExtensionDataProvider): ExtensionDataProvider {
  if (source.cacheSession) return source
  const session = new SessionPortfolio({
    getPortfolioIndex: () => source.getPortfolioIndex({ contractVersion: '1.0', includeHidden: true }),
    getDiscoverySnapshot: () => source.getDiscoverySnapshot({ contractVersion: '1.0' }),
    listMilestones: (id) => source.sourceCore ? source.sourceCore.withFreshReadContext(() => source.listMilestones(id)) : source.listMilestones(id),
    listDiscoverableMilestones: (id) => source.sourceCore ? source.sourceCore.withFreshReadContext(() => source.listDiscoverableMilestones(id)) : source.listDiscoverableMilestones(id)
  })
  const interests = new Map<string, { keys: readonly string[]; active: boolean }>()
  const suspended = new Set<string>()
  const publish = () => {
    const active = [...interests].filter(([name, item]) => item.active && ![...suspended].some((prefix) => name === prefix || name.startsWith(`${prefix}:`)))
    session.setActiveKeys([...new Set(active.flatMap(([, item]) => item.keys))])
    session.setActive(active.length > 0)
  }
  const stop = source.sourceCore?.subscribeMutations((operation, result, input) => {
    session.applyMutation(operation, result); session.finishDraft(operation, input)
  })
  const mutate = async <T>(operation: SyncMutationOperation, action: () => Promise<T>): Promise<T> => {
    const result = await action()
    if (!source.sourceCore) session.applyMutation(operation, result)
    return result
  }
  return {
    ...source,
    cacheSession: session,
    setCacheSuspended: (prefix, paused) => {
      if (suspended.has(prefix) === paused) return
      if (paused) suspended.add(prefix); else suspended.delete(prefix)
      publish()
    },
    setCacheInterest: (consumer, keys, active) => {
      if (consumer === 'webview' && !active) {
        for (const key of interests.keys()) if (key.startsWith('webview:')) interests.delete(key)
      }
      if (!active && !keys.length) interests.delete(consumer)
      else interests.set(consumer, { keys, active })
      publish()
    },
    listAccounts: (options) => session.listAccounts(options?.includeHidden),
    getPortfolioIndex: (request) => session.getPortfolioIndex(request.includeHidden),
    getPortfolioWorkspace: (request) => session.getPortfolioWorkspace(request),
    getDiscoverySnapshot: () => session.getDiscoverySnapshot(),
    listOpportunities: (id) => session.listOpportunities(id),
    discoverOpportunities: (domain) => session.discoverOpportunities(domain),
    listMilestones: (id) => session.listMilestones(id),
    listDiscoverableMilestones: (id) => session.listMilestones(id, true),
    listMilestoneActivities: (id, milestoneId) => session.readDataset(`activities:${id}:${milestoneId}`, () => source.listMilestoneActivities(id, milestoneId)),
    getRecordCreationCatalog: (request) => session.readDataset(`catalog:${request.accountId}`, () => source.getRecordCreationCatalog(request), { reference: true }),
    searchAccounts: (request) => session.readDataset(`search:${request.matchBy}:${request.query}`, () => source.searchAccounts(request)),
    addAccount: (id) => mutate('addAccount', () => source.addAccount(id)),
    setAccountVisibility: (id, visibility) => mutate('setAccountVisibility', () => source.setAccountVisibility(id, visibility)),
    joinDealTeam: (id) => mutate('joinDealTeam', () => source.joinDealTeam(id)),
    leaveDealTeam: (id) => mutate('leaveDealTeam', () => source.leaveDealTeam(id)),
    joinMilestoneTeam: (id, milestoneId) => mutate('joinMilestoneTeam', () => source.joinMilestoneTeam(id, milestoneId)),
    leaveMilestoneTeam: (id, milestoneId) => mutate('leaveMilestoneTeam', () => source.leaveMilestoneTeam(id, milestoneId)),
    updateOpportunity: (id, update) => mutate('updateOpportunity', () => source.updateOpportunity(id, update)),
    updateMilestone: (id, milestoneId, update) => mutate('updateMilestone', () => source.updateMilestone(id, milestoneId, update)),
    transitionOpportunityStage: (accountId, id, targetStage, reason) => mutate('transitionOpportunityStage', () => source.transitionOpportunityStage(accountId, id, targetStage, reason)),
    createMilestoneActivity: async (id, milestoneId, request) => {
      const result = await source.createMilestoneActivity(id, milestoneId, request)
      session.invalidateDataset(`activities:${id}:${milestoneId}`)
      return result
    },
    commitRecordCreation: (request) => mutate('commitRecordCreation', () => source.commitRecordCreation(request)),
    applyMeetingChangeSet: (request) => mutate('applyMeetingChangeSet', () => source.applyMeetingChangeSet(request)),
    dispose: async () => { stop?.(); session.dispose(); await source.dispose() }
  }
}
