import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { dispatchWrite } from '../../../apps/shared/dashboards/StageAndPipelineReview/stage-pipeline-dispatch.js'

vi.mock('../../../apps/vscode-extension/src/webview/bridge.js', () => ({
    request: vi.fn(),
    streamRequest: vi.fn()
}))

let dataClient: typeof import('../../../apps/vscode-extension/src/webview/data-client.js').dataClient
let stagePipelineWrites: typeof import('../../../apps/vscode-extension/src/webview/data-client.js').stagePipelineWrites

beforeAll(async () => {
    vi.stubGlobal('document', { getElementById: () => null })
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    ;({ dataClient, stagePipelineWrites } = await import('../../../apps/vscode-extension/src/webview/data-client.js'))
})

afterEach(() => vi.restoreAllMocks())
afterAll(() => vi.unstubAllGlobals())

describe('VS Code dashboard writes', () => {
    it('adapts forecast comments to the existing mutation client string argument', async () => {
        const update = vi.spyOn(dataClient, 'updateOpportunity').mockResolvedValue(undefined!)
        await dispatchWrite(stagePipelineWrites, { kind: 'comment', opportunityId: 'o1', comments: 'Reviewed forecast' })
        expect(update).toHaveBeenCalledExactlyOnceWith('o1', 'Reviewed forecast')
    })

    it('forwards milestone edits and tasks unchanged through the mutation client', async () => {
        const update = vi.spyOn(dataClient, 'updateMilestone').mockResolvedValue(undefined!)
        const create = vi.spyOn(dataClient, 'createMilestoneActivity').mockResolvedValue(undefined!)
        await dispatchWrite(stagePipelineWrites, { kind: 'milestone', opportunityId: 'o1', milestoneId: 'm1', update: { status: 'At Risk', comments: 'Review scope' } })
        await dispatchWrite(stagePipelineWrites, { kind: 'task', opportunityId: 'o1', milestoneId: 'm1', request: { subject: 'Review scope', priority: 'Normal' } })
        expect(update).toHaveBeenCalledExactlyOnceWith('o1', 'm1', { status: 'At Risk', comments: 'Review scope' })
        expect(create).toHaveBeenCalledExactlyOnceWith('o1', 'm1', { subject: 'Review scope', priority: 'Normal' })
    })

    it('propagates write failures without retrying the mutation', async () => {
        const update = vi.spyOn(dataClient, 'updateOpportunity').mockRejectedValue(new Error('Write failed'))
        await expect(dispatchWrite(stagePipelineWrites, { kind: 'comment', opportunityId: 'o1', comments: 'Reviewed forecast' })).rejects.toThrow('Write failed')
        expect(update).toHaveBeenCalledTimes(1)
    })
})
