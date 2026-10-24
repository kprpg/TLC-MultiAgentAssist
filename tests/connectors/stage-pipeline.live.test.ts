import { AzureCliCredential } from '@azure/identity'
import { describe, expect, it } from 'vitest'
import { stagePipelineRequestSchema, stagePipelineSnapshotSchema } from '../../packages/common/contracts/stage-pipeline-review.js'
import { LiveMsxConnector } from '../../packages/connectors/msx/index.js'
import { LiveStagePipelineConnector } from '../../packages/connectors/msx/stage-pipeline.js'
import { createStagePipelineReviewHost } from '../../packages/orchestrator/stage-pipeline-review.js'

const msxOrigin = 'https://microsoftsales.crm.dynamics.com'

// Opt-in read-only acceptance: asserts shape, counts and source health only; never prints customer data.
describe.skipIf(process.env['TLC_RUN_LIVE_SMOKE'] !== '1')('Stage and Pipeline Review live acceptance', () => {
    const credential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
    const msx = new LiveMsxConnector({ getAccessToken: async () => (await credential.getToken(`${msxOrigin}/.default`)).token })
    const connector = new LiveStagePipelineConnector(msx)
    const request = (scope: 'mine' | 'reports' | 'both') => stagePipelineRequestSchema.parse({ contractVersion: '1.1', operation: 'get', scope })

    it('reads the seller portfolio into a contract-valid snapshot with explicit source health', async () => {
        const snapshot = await connector.load(request('mine'))
        expect(stagePipelineSnapshotSchema.safeParse(snapshot).success).toBe(true)
        const summary = {
            opportunities: snapshot.opportunities.length, milestones: snapshot.milestones.length,
            editable: snapshot.opportunities.filter((row) => row.editable).length,
            stages: [...new Set(snapshot.opportunities.map((row) => row.stage))].length,
            sources: snapshot.sources.map((row) => `${row.source}:${row.state}`)
        }
        console.info('stage-pipeline live (mine)', JSON.stringify(summary))
        expect(snapshot.mode).toBe('live')
        expect(snapshot.acr.source).toBe('derived-pipeline-only')
        expect(snapshot.opportunities.every((row) => row.editable)).toBe(true)
        expect(new Set(snapshot.milestones.map((row) => row.opportunityId)).size).toBeLessThanOrEqual(snapshot.opportunities.length)
    }, 180_000)

    it('discovers direct reports without failing when the signed-in user has none', async () => {
        const snapshot = await connector.load(request('reports'))
        expect(stagePipelineSnapshotSchema.safeParse(snapshot).success).toBe(true)
        console.info('stage-pipeline live (reports)', JSON.stringify({
            reports: snapshot.reports.length, opportunities: snapshot.opportunities.length, sources: snapshot.sources.map((row) => `${row.source}:${row.state}`)
        }))
        expect(snapshot.sources.find((row) => row.source === 'hierarchy')?.state).toBe('complete')
        expect(snapshot.opportunities.every((row) => !row.editable)).toBe(true)
    }, 180_000)

    it('serves a repeat read from the host cache far faster than the first MSX load', async () => {
        const host = createStagePipelineReviewHost({ mode: 'live', source: msx })
        const started = Date.now()
        const first = await host.invoke(request('mine'))
        const firstMs = Date.now() - started
        const second = Date.now()
        const again = await host.invoke(request('mine'))
        const secondMs = Date.now() - second
        console.info('stage-pipeline live (cache)', JSON.stringify({ firstMs, secondMs }))
        expect(first.kind).toBe('snapshot')
        expect(again).toEqual(first)
        expect(secondMs).toBeLessThan(Math.max(50, firstMs / 10))
    }, 180_000)
})