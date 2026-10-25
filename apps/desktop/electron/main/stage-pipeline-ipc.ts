import type { StagePipelineReviewHost } from '../../../../packages/orchestrator/stage-pipeline-review.js'

export const stagePipelineIpcChannel = 'tlc:stage-pipeline-review'

export function createStagePipelineIpcHandler(host: StagePipelineReviewHost) {
    return (request: unknown) => host.invoke(request)
}
