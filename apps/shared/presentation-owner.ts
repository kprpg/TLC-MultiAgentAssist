import type { ThinSliceOrchestrator } from '../../packages/orchestrator/index.js'
import { portfolioReadVersion } from '../../packages/common/contracts/index.js'
import { SessionPortfolio } from './session-portfolio.js'

export function createPresentationOwner(core: ThinSliceOrchestrator): {
  session: SessionPortfolio
  interest(consumer: string, keys: readonly string[], active: boolean): void
  suspend(prefix: string, suspended: boolean): void
  forget(prefix: string): void
  dispose(): void
} {
  const session = new SessionPortfolio({
    getPortfolioIndex: () => core.getPortfolioIndex({ contractVersion: portfolioReadVersion, includeHidden: true }),
    getDiscoverySnapshot: () => core.getDiscoverySnapshot({ contractVersion: '1.0' }),
    listMilestones: (id) => core.withFreshReadContext(() => core.listMilestones(id)),
    listDiscoverableMilestones: (id) => core.withFreshReadContext(() => core.listDiscoverableMilestones(id))
  })
  const consumers = new Map<string, { keys: readonly string[]; active: boolean }>()
  const suspended = new Set<string>()
  const publish = () => {
    const active = [...consumers].filter(([name, item]) => item.active && ![...suspended].some((prefix) => name === prefix || name.startsWith(`${prefix}:`)))
    session.setActiveKeys([...new Set(active.flatMap(([, item]) => item.keys))])
    session.setActive(active.length > 0)
  }
  const stop = core.subscribeMutations((operation, result, input) => {
    session.applyMutation(operation, result)
    session.finishDraft(operation, input)
    if (operation === 'createMilestoneActivity') session.invalidateDataset(`activities:${String(input['opportunityId'])}:${String(input['milestoneId'])}`)
  })
  return {
    session,
    interest(consumer, keys, active) {
      if (!active && !keys.length) consumers.delete(consumer)
      else consumers.set(consumer, { keys, active })
      publish()
    },
    suspend(prefix, paused) {
      if (suspended.has(prefix) === paused) return
      if (paused) suspended.add(prefix); else suspended.delete(prefix)
      publish()
    },
    forget(prefix) {
      for (const key of consumers.keys()) if (key === prefix || key.startsWith(`${prefix}:`)) consumers.delete(key)
      suspended.delete(prefix); publish()
    },
    dispose() { stop(); session.dispose(); consumers.clear() }
  }
}
