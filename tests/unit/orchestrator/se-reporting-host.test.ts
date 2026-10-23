import { describe, expect, it, vi } from 'vitest'
import { createSeReportingFixture, sampleSeProfile } from '../../../packages/common/fixtures/se-reporting.js'
import type { SeReportingResponse } from '../../../packages/common/contracts/se-reporting.js'
import { MemorySeProfileStore, SharedSeReportingHost } from '../../../packages/orchestrator/se-reporting/host.js'
import { createSampleSeReportingHost } from '../../../packages/orchestrator/se-reporting/sample.js'
import type { SeReportingSource } from '../../../packages/connectors/se-reporting/types.js'
import { SeReportingError } from '../../../packages/connectors/se-reporting/types.js'
import { seReportRelativePath } from '../../../packages/documents/se-reporting.js'

function state(response: SeReportingResponse) {
    if (response.kind !== 'state') throw new Error(response.message)
    return response
}
async function fixture() {
    const input = createSeReportingFixture()
    input.mode = 'live'
    const store = new MemorySeProfileStore()
    await store.save(input.owner.email, sampleSeProfile)
    let owner = input.owner.email
    let now = new Date('2026-10-23T12:00:00Z')
    const publish = vi.fn<SeReportingSource['publish']>().mockResolvedValue(['https://example.sharepoint.com/report.json'])
    const collect = vi.fn<SeReportingSource['collect']>().mockImplementation(async (_profile, inspection, options) => ({
        ...structuredClone(input), ...inspection, runId: options.runId
    }))
    const source: SeReportingSource = {
        inspect: async () => ({ owner: input.owner, contract: input.contract, assignments: input.assignments, access: input.access, mappingGaps: [] }),
        checkAccess: async () => input.access, collect,
        preview: async (_profile, reports) => reports.flatMap((report) => (['html', 'json'] as const).map((extension) => ({
            path: seReportRelativePath(report, extension), exists: true, status: 'approved', url: 'https://example.sharepoint.com/report', etag: 'version-1'
        }))),
        publish
    }
    const host = new SharedSeReportingHost({
        mode: 'live', owner: async () => ({ key: owner, email: owner }), profiles: store, source,
        now: () => now, synthesize: async () => ({ ...input.narratives, qualifying_evidence_ids: [] })
    })
    const run = async () => state(await host.invoke({
        contractVersion: '1.0', operation: 'run', profileId: sampleSeProfile.id,
        period: input.period, pillar: input.pillar, allowUnavailable: [], confirmed: true
    }))
    return { host, run, input, source, publish, collect, setOwner: (value: string) => { owner = value }, advance: () => { now = new Date(now.getTime() + 700000) } }
}

describe('SE reporting lifecycle and approval boundaries', () => {
    it('runs the complete synthetic workflow without network or publication writes', async () => {
        const host = createSampleSeReportingHost()
        const initial = state(await host.invoke({ contractVersion: '1.0', operation: 'get' }))
        expect(initial.mode).toBe('sample')
        expect(initial.run?.reports).toHaveLength(3)
        expect(initial.run?.reports.every((report) => report.data_mode === 'sample' && report.status === 'draft')).toBe(true)
    })

    it('keeps reporter asks empty until direct input and preserves them verbatim in the person summary', async () => {
        const data = await fixture()
        const generated = await data.run()
        expect(generated.run?.reports.every((report) => report.asks_for_manager.length === 0)).toBe(true)
        const originals = generated.run!.reports.filter((report) => report.artifact_type === 'person_pillar_report')
        const asks = originals.map((report, index) => ({ reportId: report.report_id, text: index ? '' : '  Please help with this exact request.\nDo not rewrite it.  ' }))
        const reviewed = state(await data.host.invoke({ contractVersion: '1.0', operation: 'review', runId: generated.run!.id, asks, approve: true, confirmed: true }))
        expect(reviewed.run!.reports[0]!.asks_for_manager[0]!.ask).toBe(asks[0]!.text)
        expect(reviewed.run!.reports.at(-1)!.asks_for_manager[0]!.ask).toBe(asks[0]!.text)
        expect(reviewed.run!.reports[1]!.asks_for_manager).toEqual([])
        expect(reviewed.run!.reports.every((report) => report.status === 'approved')).toBe(true)
        expect(data.publish).not.toHaveBeenCalled()
    })

    it('requires completed review, exact unexpired publication confirmation and explicit overwrite consent', async () => {
        const data = await fixture()
        const { run } = await data.run()
        const prepare = { contractVersion: '1.0', operation: 'prepare-publish', runId: run!.id }
        expect(await data.host.invoke(prepare)).toMatchObject({ kind: 'error', code: 'reporter-review-required' })
        await data.host.invoke({
            contractVersion: '1.0', operation: 'review', runId: run!.id,
            asks: run!.reports.filter((report) => report.atu).map((report) => ({ reportId: report.report_id, text: '' })), approve: false, confirmed: true
        })
        const preview = state(await data.host.invoke(prepare)).publishPreview!
        const publish = { contractVersion: '1.0', operation: 'publish', runId: run!.id, token: preview.token, overwriteConfirmed: false, confirmed: true }
        expect(await data.host.invoke(publish)).toMatchObject({ kind: 'error', code: 'overwrite-confirmation-required' })
        expect(data.publish).not.toHaveBeenCalled()
        expect(state(await data.host.invoke({ ...publish, overwriteConfirmed: true })).published).toHaveLength(1)
        expect(data.publish).toHaveBeenCalledTimes(1)
        expect(await data.host.invoke({ ...publish, overwriteConfirmed: true })).toMatchObject({ kind: 'error', code: 'publication-review-expired' })
    })

    it('does not approve or publish an isolated test-contract artifact', async () => {
        const data = await fixture()
        data.input.contract.testMode = true
        const { run } = await data.run()
        expect(await data.host.invoke({
            contractVersion: '1.0', operation: 'review', runId: run!.id,
            asks: [], approve: true, confirmed: true
        })).toMatchObject({ kind: 'error', code: 'test-approval-denied' })
        expect(data.publish).not.toHaveBeenCalled()
    })

    it('isolates users and preserves the prior package after a failed source read', async () => {
        const data = await fixture()
        const original = await data.run()
        data.collect.mockRejectedValueOnce(new SeReportingError('source-failed', 'The source failed.'))
        const result = await data.host.invoke({ contractVersion: '1.0', operation: 'run', profileId: sampleSeProfile.id, period: '2026-10', pillar: 'infra', allowUnavailable: [], confirmed: true })
        expect(result).toMatchObject({ kind: 'error', code: 'source-failed' })
        expect(state(await data.host.invoke({ contractVersion: '1.0', operation: 'get' })).run?.id).toBe(original.run?.id)
        data.setOwner('someone-else@example.test')
        expect(state(await data.host.invoke({ contractVersion: '1.0', operation: 'get' })).run).toBeNull()
    })

    it('does not lose the active-operation lock when a second operation is rejected as busy', async () => {
        const data = await fixture()
        let release: (() => void) | undefined
        data.collect.mockImplementationOnce(async (_profile, inspection, options) => {
            await new Promise<void>((resolve) => { release = resolve })
            return { ...data.input, ...inspection, runId: options.runId }
        })
        const pending = data.run()
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        const check = { contractVersion: '1.0', operation: 'check-access', profileId: sampleSeProfile.id }
        expect(await data.host.invoke(check)).toMatchObject({ kind: 'error', code: 'reporting-busy' })
        expect(await data.host.invoke(check)).toMatchObject({ kind: 'error', code: 'reporting-busy' })
        release!()
        await pending
        expect((await data.host.invoke(check)).kind).toBe('state')
    })
})
