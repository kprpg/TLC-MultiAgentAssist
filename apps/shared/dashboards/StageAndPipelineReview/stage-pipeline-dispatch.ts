import type { WriteAction } from './stage-pipeline-write-dialog.js'
import type { StagePipelineWrites } from './stage-pipeline-writes.js'

/** Routes a reviewed action to the host's existing, confirmed MSX write operations. */
export async function dispatchWrite(writes: StagePipelineWrites, action: WriteAction): Promise<void> {
    if (action.kind === 'comment') await writes.updateOpportunity(action.opportunityId, { comments: action.comments })
    else if (action.kind === 'milestone') await writes.updateMilestone(action.opportunityId, action.milestoneId, action.update)
    else await writes.createMilestoneActivity(action.opportunityId, action.milestoneId, action.request)
}
