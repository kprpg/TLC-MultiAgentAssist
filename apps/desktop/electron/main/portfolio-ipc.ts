import { portfolioReadRequestSchema, portfolioIndexSchema, portfolioWorkspaceRequestSchema, portfolioWorkspaceSchema } from '../../../../packages/common/contracts/index.js'
import type { ThinSliceOrchestrator } from '../../../../packages/orchestrator/index.js'

export function createPortfolioIpcHandlers(core: Pick<ThinSliceOrchestrator, 'getPortfolioIndex' | 'getPortfolioWorkspace'>): Readonly<Record<string, (input: unknown) => Promise<unknown>>> {
  return {
    'tlc:portfolio-index': async (input) => portfolioIndexSchema.parse(await core.getPortfolioIndex(portfolioReadRequestSchema.parse(input))),
    'tlc:portfolio-workspace': async (input) => portfolioWorkspaceSchema.parse(await core.getPortfolioWorkspace(portfolioWorkspaceRequestSchema.parse(input)))
  }
}
