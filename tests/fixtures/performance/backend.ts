import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { MemoryPortfolioPreferenceStore } from '../../../packages/connectors/common/portfolio-preferences.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createDeterministicLiveTaskAgents } from '../../../packages/orchestrator/task-agents.js'

export const performanceAccountId = '10000000-0000-4000-8000-000000000001'
export const performanceOpportunityId = '20000000-0000-4000-8000-000000000001'
export const performanceSource = 'https://performance.crm.dynamics.com'

export function createControlledLiveBackend(upstream: string, cachePortfolio: boolean, onToken?: () => void) {
  const target = new URL(upstream)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('The performance source must be an isolated loopback fixture.')
  let tokenCalls = 0
  const msx = new LiveMsxConnector({
    getAccessToken: async () => { tokenCalls++; onToken?.(); return 'synthetic-read-only-source' }
  }, async (input, init) => {
    const source = new URL(String(input))
    if (source.origin !== performanceSource || init?.method && init.method !== 'GET') {
      throw new Error('External sources and writes are prohibited in the performance fixture.')
    }
    return fetch(new URL(source.pathname + source.search, target), init)
  }, `${performanceSource}/api/data/v9.2/`, undefined, {}, new MemoryPortfolioPreferenceStore(), {
    cachePortfolio, requireConditionalWrites: true
  })
  const core = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), createDeterministicLiveTaskAgents())
  return { core, msx, tokenCalls: () => tokenCalls }
}
