import { mcemRequestSchema, type Account, type McemRequest, type McemResponse, type Opportunity } from '../common/index.js'
import { evaluateMcemProgress } from '../agents/mcem-coach/index.js'
import type { McemGuidanceConnector, MsxConnector } from '../connectors/common/index.js'

export class ThinSliceOrchestrator {
  constructor(
    private readonly msx: MsxConnector,
    private readonly mcem: McemGuidanceConnector
  ) {}

  listAccounts(): Promise<Account[]> {
    return this.msx.listAccounts()
  }

  listOpportunities(accountId: string): Promise<Opportunity[]> {
    return this.msx.listOpportunities(accountId)
  }

  async runMcemCoach(input: McemRequest): Promise<McemResponse> {
    const request = mcemRequestSchema.parse(input)
    const context = await this.msx.getOpportunityContext(request.opportunityId)
    if (context.account.id !== request.accountId) {
      throw new Error('The selected opportunity does not belong to the selected account.')
    }
    const guidance = await this.mcem.getStageGuidance(context.opportunity.recordedStage)
    return evaluateMcemProgress(context, guidance)
  }
}