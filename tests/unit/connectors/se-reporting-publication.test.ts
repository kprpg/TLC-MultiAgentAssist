import { describe, expect, it, vi } from 'vitest'
import { createSeReportingFixture, sampleSeProfile } from '../../../packages/common/fixtures/se-reporting.js'
import { buildSeReports } from '../../../packages/orchestrator/se-reporting/model.js'
import { LiveSeReportingSource } from '../../../packages/connectors/se-reporting/publish.js'
import { seReportRelativePath } from '../../../packages/documents/se-reporting.js'

function fixture() {
    const input = createSeReportingFixture()
    input.mode = 'live'
    const report = buildSeReports(input)[0]!
    report.review.asks_captured = true
    let writes = 0
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (target, init) => {
        const url = String(target)
        if (url.includes('/shares/')) return Response.json({ id: 'root', name: 'Pod Reports', parentReference: { driveId: 'drive-one' }, webUrl: sampleSeProfile.outputRootUrl, folder: {} })
        if (init?.method === 'PUT') {
            if (++writes > 1) return new Response(null, { status: 412 })
            return Response.json({ id: 'written-file', eTag: 'new-version', webUrl: 'https://example.sharepoint.com/report.html' })
        }
        if (!url.includes('.html') && !url.includes('.json')) return Response.json({ id: 'folder', folder: {} })
        return Response.json({ id: 'existing-file', eTag: 'version-one', webUrl: 'https://example.sharepoint.com/report' })
    })
    const source = new LiveSeReportingSource({ getToken: async () => 'synthetic-token', expectedEmail: async () => input.owner.email, fetcher })
    const files = (['html', 'json'] as const).map((extension) => ({
        path: seReportRelativePath(report, extension), exists: true, status: 'approved', etag: 'version-one', url: 'https://example.sharepoint.com/report'
    }))
    return { source, report, files, fetcher }
}
describe('SE report publication integrity', () => {
    it('checks destination versions before any report write', async () => {
        const data = fixture()
        data.files[0]!.etag = 'stale-version'
        await expect(data.source.publish(sampleSeProfile, [data.report], data.files)).rejects.toMatchObject({ code: 'publication-conflict' })
        expect(data.fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    })
    it('uses conditional writes, publishes canonical JSON last and reports partial failure explicitly', async () => {
        const data = fixture()
        await expect(data.source.publish(sampleSeProfile, [data.report], data.files)).rejects.toMatchObject({ code: 'publication-partial' })
        const writes = data.fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')
        expect(writes).toHaveLength(2)
        expect(String(writes[0]![0])).toContain('.html')
        expect(String(writes[1]![0])).toContain('.json')
        expect(writes[0]![1]?.headers).toMatchObject({ 'if-match': 'version-one' })
    })
    it('refuses live publication of test or synthetic reports', async () => {
        const data = fixture()
        data.report.data_mode = 'sample'
        await expect(data.source.preview(sampleSeProfile, [data.report])).rejects.toMatchObject({ code: 'test-publication-denied' })
        expect(data.fetcher).not.toHaveBeenCalled()
    })
})
