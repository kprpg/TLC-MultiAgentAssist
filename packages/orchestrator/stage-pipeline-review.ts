import {
    stagePipelineRequestSchema, stagePipelineResponseSchema, stagePipelineReviewContractVersion, type StagePipelineResponse
} from '../common/contracts/stage-pipeline-review.js'
import { createSampleStagePipelineReview } from '../common/fixtures/stage-pipeline-review.js'
import { CachedStagePipelineLoader, type CachedStagePipelineOptions } from './stage-pipeline-cache.js'
import {
    LiveStagePipelineConnector, StagePipelineSourceError, type LiveStagePipelineOptions, type StagePipelineLoader, type StagePipelineSource
} from '../connectors/msx/stage-pipeline.js'

export interface StagePipelineReviewHost {
    invoke(request: unknown): Promise<StagePipelineResponse>
}

export class SharedStagePipelineReviewHost implements StagePipelineReviewHost {
    constructor(private readonly loader: StagePipelineLoader) { }

    async invoke(rawRequest: unknown): Promise<StagePipelineResponse> {
        const request = stagePipelineRequestSchema.parse(rawRequest)
        try {
            return stagePipelineResponseSchema.parse(await this.loader.load(request, { fresh: request.operation === 'refresh' }))
        } catch (error) {
            if (!(error instanceof StagePipelineSourceError)) throw error
            return stagePipelineResponseSchema.parse({
                contractVersion: stagePipelineReviewContractVersion, kind: 'unavailable', code: error.code, message: error.message
            })
        }
    }
}

export type StagePipelineReviewHostOptions =
    | { mode: 'sample' }
    | ({ mode: 'live'; source: StagePipelineSource; cache?: CachedStagePipelineOptions } & LiveStagePipelineOptions)

export function createUnavailableStagePipelineReviewHost(message: string): StagePipelineReviewHost {
    return new SharedStagePipelineReviewHost({ load: async () => { throw new StagePipelineSourceError('source-unavailable', message) } })
}

export function createStagePipelineReviewHost(options: StagePipelineReviewHostOptions): StagePipelineReviewHost {
    if (options.mode === 'sample') {
        return new SharedStagePipelineReviewHost({
            load: async (request) => createSampleStagePipelineReview({ scope: request.scope, ...(request.reportIds ? { reportIds: request.reportIds } : {}) })
        })
    }
    const { source, cache, ...rest } = options
    const { mode: _ignored, ...connectorOptions } = rest
    void _ignored
    return new SharedStagePipelineReviewHost(new CachedStagePipelineLoader(new LiveStagePipelineConnector(source, connectorOptions), cache))
}
