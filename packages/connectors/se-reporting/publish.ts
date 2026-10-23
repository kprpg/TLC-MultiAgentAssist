import { z } from 'zod'
import { seReportSchema, type SeReport, type SeReportingProfile } from '../../common/contracts/se-reporting.js'
import { renderSeReportHtml, seReportRelativePath } from '../../documents/se-reporting.js'
import { readBoundedText } from '../common/http-response.js'
import { LiveSeReportingReader } from './live.js'
import { SeReportingError, type SePublishFile, type SeReportingSource } from './types.js'

const graphRoot = 'https://graph.microsoft.com/v1.0'
const itemSchema = z.object({ id: z.string(), eTag: z.string(), webUrl: z.url() })

export class LiveSeReportingSource extends LiveSeReportingReader implements SeReportingSource {
    private async root(profile: SeReportingProfile) {
        const root = await this.api.share(profile.outputRootUrl)
        if (!root.folder || root.file) throw new SeReportingError('invalid-output-root', 'The profile output root must resolve to a SharePoint folder.')
        return root
    }
    private async existing(driveId: string, rootId: string, path: string) {
        const response = await this.api.request('graph', `${graphRoot}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootId)}:/${path.split('/').map(encodeURIComponent).join('/')}?$select=id,eTag,webUrl`)
        if (response.status === 404) return null
        if (!response.ok) throw new SeReportingError('publication-preview-failed', 'The report destination could not be checked. No files were written.')
        return itemSchema.parse(JSON.parse(await readBoundedText(response, 64000)))
    }
    async preview(profile: SeReportingProfile, reports: SeReport[]): Promise<SePublishFile[]> {
        if (reports.some((report) => report.schema_contract.test_mode || report.data_mode !== 'live')) throw new SeReportingError('test-publication-denied', 'Test or synthetic artifacts cannot be published to a live manager folder.')
        const root = await this.root(profile)
        const files: SePublishFile[] = []
        for (const report of reports) {
            for (const extension of ['html', 'json'] as const) {
                const path = seReportRelativePath(report, extension)
                const current = await this.existing(root.parentReference.driveId, root.id, path)
                let status = current ? 'Existing companion' : 'New file'
                if (current && extension === 'json') {
                    let previous: SeReport
                    try { previous = seReportSchema.parse(JSON.parse(await this.api.file(root.parentReference.driveId, current.id, new URL(profile.outputRootUrl).hostname))) } catch {
                        throw new SeReportingError('existing-report-invalid', 'An existing JSON report could not be validated. It will not be overwritten.')
                    }
                    if (previous.owner.system_user_id.toLowerCase() !== report.owner.system_user_id.toLowerCase() || previous.report_id !== report.report_id) {
                        throw new SeReportingError('report-owner-mismatch', 'The existing artifact belongs to another reporter or report. It will not be overwritten.')
                    }
                    status = previous.status
                }
                files.push({ path, exists: Boolean(current), status, url: current?.webUrl ?? '', etag: current?.eTag ?? null })
            }
        }
        return files
    }
    async publish(profile: SeReportingProfile, reports: SeReport[], files: SePublishFile[]): Promise<string[]> {
        const root = await this.root(profile)
        const driveId = root.parentReference.driveId
        for (const file of files) {
            const current = await this.existing(driveId, root.id, file.path)
            if ((current?.eTag ?? null) !== file.etag) throw new SeReportingError('publication-conflict', 'A destination changed after review. Prepare and review publication again; no report files were written.')
        }
        const folderCache = new Map([['', root.id]])
        const ensureFolder = async (segments: string[]): Promise<string> => {
            let parentId = root.id
            let path = ''
            for (const segment of segments) {
                path = path ? `${path}/${segment}` : segment
                const cached = folderCache.get(path)
                if (cached) { parentId = cached; continue }
                const response = await this.api.request('graph', `${graphRoot}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(segment)}?$select=id,folder`)
                let value: unknown
                if (response.status === 404) {
                    value = await this.api.json('graph-write', `${graphRoot}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`, {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: segment, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
                    })
                } else {
                    if (!response.ok) throw new SeReportingError('publication-folder-failed', 'The reporter output folder could not be verified.')
                    value = JSON.parse(await readBoundedText(response, 64000))
                }
                const folder = z.object({ id: z.string(), folder: z.object({}).passthrough() }).parse(value)
                parentId = folder.id
                folderCache.set(path, parentId)
            }
            return parentId
        }
        const published: string[] = []
        try {
            for (const report of reports) {
                if (report.schema_contract.test_mode || report.data_mode !== 'live' || !report.review.asks_captured) throw new SeReportingError('publication-review-required', 'Complete reporter review before publication. Test and synthetic drafts cannot be published.')
                for (const extension of ['html', 'json'] as const) {
                    const path = seReportRelativePath(report, extension)
                    const plan = files.find((file) => file.path === path)
                    if (!plan) throw new SeReportingError('publication-plan-mismatch', 'The report no longer matches its reviewed publication plan.')
                    const segments = path.split('/')
                    const name = segments.pop()!
                    const parentId = await ensureFolder(segments)
                    const response = await this.api.request('graph-write', `${graphRoot}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/content${plan.etag ? '' : '?@microsoft.graph.conflictBehavior=fail'}`, {
                        method: 'PUT', headers: {
                            'content-type': extension === 'json' ? 'application/json' : 'text/html; charset=utf-8',
                            ...(plan.etag ? { 'if-match': plan.etag } : { 'if-none-match': '*' })
                        },
                        body: extension === 'json' ? JSON.stringify(report, null, 2) : renderSeReportHtml(report)
                    })
                    if (!response.ok) throw new SeReportingError('publication-write-failed', `SharePoint rejected a report write (HTTP ${response.status}).`)
                    const result = itemSchema.parse(JSON.parse(await readBoundedText(response, 64000)))
                    published.push(result.webUrl)
                }
            }
        } catch (error) {
            if (published.length) throw new SeReportingError('publication-partial', `${published.length} of ${files.length} files were written before publication stopped. Inspect the configured output folder before retrying; the package was not marked fully published.`)
            throw error
        }
        return published
    }
}
