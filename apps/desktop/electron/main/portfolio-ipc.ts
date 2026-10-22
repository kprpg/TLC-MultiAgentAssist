import { discoverySnapshotRequestSchema, discoverySnapshotSchema, portfolioReadRequestSchema, portfolioIndexSchema, portfolioWorkspaceRequestSchema, portfolioWorkspaceSchema } from '../../../../packages/common/contracts/index.js'
import type { ThinSliceOrchestrator } from '../../../../packages/orchestrator/index.js'
import { mutationSyncRequestSchema, mutationSyncResponseSchema } from '../../../../packages/common/contracts/cache-sync.js'
import type { MutationSession } from '../../../../packages/orchestrator/mutations/composition.js'

export function createMutationSyncIpcHandler(session: Pick<MutationSession, 'invoke'>) {
  return async (input: unknown) => mutationSyncResponseSchema.parse(await session.invoke(mutationSyncRequestSchema.parse(input)))
}

export function createPortfolioIpcHandlers(core: Pick<ThinSliceOrchestrator, 'getPortfolioIndex' | 'getPortfolioWorkspace' | 'getDiscoverySnapshot'>): Readonly<Record<string, (input: unknown) => Promise<unknown>>> {
  return {
    'tlc:portfolio-index': async (input) => portfolioIndexSchema.parse(await core.getPortfolioIndex(portfolioReadRequestSchema.parse(input))),
    'tlc:portfolio-workspace': async (input) => portfolioWorkspaceSchema.parse(await core.getPortfolioWorkspace(portfolioWorkspaceRequestSchema.parse(input))),
    'tlc:discovery-snapshot': async (input) => discoverySnapshotSchema.parse(await core.getDiscoverySnapshot(discoverySnapshotRequestSchema.parse(input)))
  }
}
