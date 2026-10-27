import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { LocalPdfMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { LocalStore, LocalStoreMsxConnector } from '../../../packages/connectors/local-store/index.js'
import { LiveMeetingCaptureConnector, type LiveMeetingTranscriptSource } from '../../../packages/connectors/msx/live-meeting.js'
import { GraphMeetingError } from '../../../packages/connectors/graph/meetings.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { deferredSignal } from './operation-result-fixtures.js'

test.use({ locale: 'en-US', timezoneId: 'UTC' })

const arc = { handle: `gm_${'a'.repeat(32)}`, subject: 'Arc review', startsAt: '2026-10-23T14:00:00.000Z', meetingType: 'customer' as const }
const sync = { handle: `gm_${'b'.repeat(32)}`, subject: 'Internal sync', startsAt: '2026-10-22T09:30:00.000Z', meetingType: 'internal' as const }
const spokenLine = 'Priya Nair: We have sign-off to spend 900 thousand this quarter.'

let server: Server | undefined
let store: LocalStore | undefined

test.afterEach(async () => {
    if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
    server = undefined
    store?.close()
    store = undefined
})

/** The hosted Web app backed by the real live-meeting connector, with only the Teams source faked. */
async function hostedWeb(source: LiveMeetingTranscriptSource): Promise<string> {
    store = new LocalStore()
    const msx = new LocalStoreMsxConnector(store)
    const meetings = new LiveMeetingCaptureConnector(msx, undefined, source)
    const runtime: WebRuntime = Object.assign(
        new ThinSliceOrchestrator(msx, new LocalPdfMcemGuidanceConnector(resolve('docs', 'knowledge', 'MCEM Overview.pdf')), {}),
        {
            listMeetingTranscripts: () => meetings.listMeetingTranscripts(),
            getMeetingTranscript: async () => null,
            proposeMeetingChangeSet: (request: Parameters<WebRuntime['proposeMeetingChangeSet']>[0]) => meetings.proposeMeetingChangeSet({
                opportunityId: request.opportunityId,
                ...(request.transcriptId ? { transcriptId: request.transcriptId } : {}),
                ...(request.rawTranscript ? { transcript: parseTranscriptContent(request.rawTranscript.content, { opportunityId: request.opportunityId }) } : {})
            }),
            applyMeetingChangeSet: (input: Parameters<WebRuntime['applyMeetingChangeSet']>[0]) => meetings.applyMeetingChangeSet(input)
        }
    )
    const api = buildWebApiHandler({ createRuntime: () => runtime, authenticate: createSampleAuthentication() })
    const staticHandler = buildStaticHandler(resolve('apps', 'desktop', 'dist', 'revamp'), 'sample')
    server = createServer((request, response) => {
        setSecurityHeaders(response)
        void (async () => {
            if (!(await api(request, response))) await staticHandler(request, response)
        })().catch((error: unknown) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Test host failed.')
        })
    })
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Hosted Web test server did not start.')
    return `http://127.0.0.1:${address.port}`
}

async function openLauncher(page: import('@playwright/test').Page, base: string) {
    await page.goto(base)
    await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
    const blade = page.getByRole('region', { name: 'Opportunities blade' })
    await blade.getByRole('button', { name: /^Grid operations modernization/ }).click()
    await blade.locator('.blade-header').getByRole('button', { name: 'Meeting capture' }).click()
    return page.locator('.meeting-launcher-panel')
}

test('lists recent Teams meetings by title and date, and imports the chosen meeting transcript into Extract & Review', async ({ page }) => {
    const acquired: Array<[string, string]> = []
    const base = await hostedWeb({
        listRecentMeetings: async () => [sync, arc],
        acquireRecentTranscript: async (handle, opportunityId) => {
            acquired.push([handle, opportunityId])
            return parseTranscriptContent(spokenLine, { id: 'graph-transcript', source: 'teams', meetingType: 'customer' })
        }
    })
    const panel = await openLauncher(page, base)

    const picker = panel.getByRole('combobox', { name: 'Meeting' })
    await expect(picker).toBeVisible()
    await expect(picker.locator('option')).toHaveText([
        'Arc review - Fri, Oct 23, 2:00 PM (customer)',
        'Internal sync - Thu, Oct 22, 9:30 AM (internal)'
    ])
    await expect(panel.getByText('The transcript is imported from Teams when you choose Extract & Review.')).toBeVisible()
    await expect(page.getByText('No linked meeting transcripts')).toHaveCount(0)
    expect(acquired).toEqual([])

    await picker.selectOption({ label: 'Internal sync - Thu, Oct 22, 9:30 AM (internal)' })
    await picker.selectOption({ label: 'Arc review - Fri, Oct 23, 2:00 PM (customer)' })
    await panel.getByRole('button', { name: 'Extract & Review' }).click()

    const dialog = page.getByRole('dialog', { name: 'Review meeting signals' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('row', { name: /Budget/ }).first()).toBeVisible()
    expect(acquired).toHaveLength(1)
    expect(acquired[0]![0]).toBe(arc.handle)
})

test('explains why Teams meetings are unavailable, retries, and keeps Paste / upload as the fallback', async ({ page }) => {
    let attempts = 0
    const base = await hostedWeb({
        listRecentMeetings: async () => {
            attempts += 1
            if (attempts === 1) throw new GraphMeetingError('denied', 'http_403')
            return [arc]
        },
        acquireRecentTranscript: async () => undefined
    })
    const panel = await openLauncher(page, base)

    const alert = panel.getByRole('alert')
    await expect(alert).toContainText('Microsoft Graph did not allow access to your calendar')
    await expect(alert).toContainText('Paste / upload')
    await expect(alert).not.toContainText('Error invoking')
    await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeDisabled()

    await panel.getByRole('button', { name: 'Try again' }).click()
    await expect(panel.getByRole('combobox', { name: 'Meeting' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeEnabled()

    await panel.getByRole('button', { name: 'Paste / upload' }).click()
    await expect(panel.getByPlaceholder(/Paste a Teams transcript/)).toBeVisible()
})

test('says so plainly when the chosen meeting has no transcript yet, without opening a review', async ({ page }) => {
    const base = await hostedWeb({ listRecentMeetings: async () => [arc], acquireRecentTranscript: async () => undefined })
    const panel = await openLauncher(page, base)
    await panel.getByRole('button', { name: 'Extract & Review' }).click()
    await expect(page.getByText(/No transcript is available for this meeting yet/).first()).toBeVisible()
    await expect(page.getByText(/Paste \/ upload with a transcript you are authorized to provide/).first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeEnabled()
})

test('@operation-retention retains a Web proposal without opening a review in another view', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    let acquisitions = 0
    const base = await hostedWeb({
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => {
            acquisitions++
            arrived.resolve()
            await release.promise
            return parseTranscriptContent(spokenLine, { id: 'retained-web-transcript', source: 'teams', meetingType: 'customer' })
        }
    })

    const panel = await openLauncher(page, base)
    const response = page.waitForResponse((value) => value.request().method() === 'POST' && value.url().endsWith('/meeting-change-set'))
    try {
        await panel.getByRole('button', { name: 'Extract & Review' }).click()
        await arrived.promise
        await page.getByRole('button', { name: 'Discover', exact: true }).click()
        await expect(panel).toHaveCount(0)
        release.resolve()
        await (await response).finished()
        await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toHaveCount(0)
        await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
        await page.getByRole('button', { name: 'Meeting capture', exact: true }).click()
        await page.getByRole('button', { name: 'Review last result', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toBeVisible()
        expect(acquisitions).toBe(1)
    } finally {
        release.resolve()
    }
})

test('@operation-retention isolates a late Web proposal from the newly selected opportunity', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    const base = await hostedWeb({
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => {
            arrived.resolve()
            await release.promise
            return parseTranscriptContent(spokenLine, { id: 'scoped-transcript', source: 'teams', meetingType: 'customer' })
        }
    })
    const panel = await openLauncher(page, base)
    const response = page.waitForResponse((value) => value.request().method() === 'POST' && value.url().endsWith('/meeting-change-set'))
    try {
        await panel.getByRole('button', { name: 'Extract & Review' }).click()
        await arrived.promise
        const blade = page.getByRole('region', { name: 'Opportunities blade' })
        await blade.getByRole('button', { name: /^Cloud security readiness/ }).click()
        await page.getByRole('button', { name: 'Meeting capture', exact: true }).click()
        await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeEnabled()
        release.resolve()
        await (await response).finished()
        await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toHaveCount(0)
        await expect(panel.getByRole('button', { name: 'Review last result' })).toHaveCount(0)
        await panel.getByRole('button', { name: 'Close', exact: true }).click()
        await blade.getByRole('button', { name: /^Grid operations modernization/ }).click()
        await page.getByRole('button', { name: 'Meeting capture', exact: true }).click()
        await expect(panel.getByRole('button', { name: 'Review last result' })).toBeVisible()
    } finally { release.resolve() }
})
