import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { LiveMeetingCaptureConnector, type LiveMeetingTranscriptSource } from '../../../packages/connectors/msx/live-meeting.js'
import { GraphMeetingError } from '../../../packages/connectors/graph/meetings.js'
import { parseTranscriptContent } from '../../../packages/agents/meeting-signal-extractor/src/transcript-parse.js'
import { deferredSignal } from './operation-result-fixtures.js'

declare global {
    interface Window { invokeMeetingBridge(message: unknown): Promise<unknown> }
}

test.use({ locale: 'en-US', timezoneId: 'UTC' })

const arc = { handle: `gm_${'a'.repeat(32)}`, subject: 'Arc review', startsAt: '2026-10-23T14:00:00.000Z', meetingType: 'customer' as const }
const sync = { handle: `gm_${'b'.repeat(32)}`, subject: 'Internal sync', startsAt: '2026-10-22T09:30:00.000Z', meetingType: 'internal' as const }

/** Mounts the real built VS Code webview against the real host router, with only the Teams source faked. */
async function mount(page: Page, source: LiveMeetingTranscriptSource, options: {
    onResponse?: (method: string) => void
    apply?: ReturnType<typeof createSampleDataProvider>['applyMeetingChangeSet']
} = {}): Promise<void> {
    const meetings = new LiveMeetingCaptureConnector(new FixtureMsxConnector(), undefined, source)
    const provider = {
        ...createSampleDataProvider(),
        listMeetingTranscripts: () => meetings.listMeetingTranscripts(),
        getMeetingTranscript: async () => null,
        proposeMeetingChangeSet: (request: { opportunityId: string; transcriptId?: string }) => meetings.proposeMeetingChangeSet({
            opportunityId: request.opportunityId, ...(request.transcriptId ? { transcriptId: request.transcriptId } : {})
        }),
        ...(options.apply ? { applyMeetingChangeSet: options.apply } : {})
    }
    await page.exposeFunction('invokeMeetingBridge', async (message: unknown) => {
        const response = await routeBridgeMessage(provider as never, message)
        if (message && typeof message === 'object' && 'method' in message && typeof message.method === 'string') options.onResponse?.(message.method)
        return response
    })
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript(() => {
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined, setState: () => undefined,
                postMessage: (message: { kind: string }) => {
                    if (message.kind === 'request') void window.invokeMeetingBridge(message).then((reply) => window.postMessage(reply, window.location.origin))
                }
            })
        })
    })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
}

async function openPanel(page: Page) {
    await page.getByRole('button', { name: 'Meeting capture', exact: true }).click()
    return page.locator('.meeting-launcher-panel')
}

test('VS Code lists recent Teams meetings by title and date and imports the chosen one', async ({ page }) => {
    const acquired: Array<[string, string]> = []
    await mount(page, {
        listRecentMeetings: async () => [sync, arc],
        acquireRecentTranscript: async (handle, opportunityId) => {
            acquired.push([handle, opportunityId])
            return parseTranscriptContent('Priya Nair: We have sign-off to spend 900 thousand this quarter.', { id: 'graph-transcript', source: 'teams', meetingType: 'customer' })
        }
    })
    const panel = await openPanel(page)

    const picker = panel.getByRole('combobox', { name: 'Meeting' })
    await expect(picker.locator('option')).toHaveText([
        'Arc review - Fri, Oct 23, 2:00 PM (customer)',
        'Internal sync - Thu, Oct 22, 9:30 AM (internal)'
    ])
    await expect(panel.getByText('The transcript is imported from Teams when you choose Extract & Review.')).toBeVisible()
    expect(acquired).toEqual([])

    await panel.getByRole('button', { name: 'Extract & Review' }).click()
    await expect.poll(() => acquired.length).toBe(1)
    expect(acquired[0]![0]).toBe(arc.handle)
    await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Review meeting signals' }).getByRole('row', { name: /Budget/ }).first()).toBeVisible()
})

test('VS Code explains why Teams meetings are unavailable and offers a retry', async ({ page }) => {
    let attempts = 0
    await mount(page, {
        listRecentMeetings: async () => {
            attempts += 1
            if (attempts === 1) throw new GraphMeetingError('auth-required', 'delegated_session_unavailable')
            return [arc]
        },
        acquireRecentTranscript: async () => undefined
    })
    const panel = await openPanel(page)

    await expect(panel.getByRole('alert')).toContainText('Microsoft Graph sign-in or consent is required')
    await expect(panel.getByRole('alert')).toContainText('Paste / upload')
    await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeDisabled()

    await panel.getByRole('button', { name: 'Try again' }).click()
    await expect(panel.getByRole('combobox', { name: 'Meeting' })).toBeVisible()
    expect(attempts).toBe(2)
})

test('VS Code only asks the Teams source when the Meeting capture panel is opened', async ({ page }) => {
    let listed = 0
    await mount(page, { listRecentMeetings: async () => { listed += 1; return [arc] }, acquireRecentTranscript: async () => undefined })
    await expect(page.getByRole('button', { name: 'Meeting capture', exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    expect(listed).toBe(0)
    await openPanel(page)
    await expect.poll(() => listed).toBe(1)
})

test('@operation-retention retains a VS Code proposal after the Portfolio view unmounts', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    const delivered = deferredSignal()
    let acquisitions = 0
    await mount(page, {
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => {
            acquisitions++
            arrived.resolve()
            await release.promise
            return parseTranscriptContent('Priya Nair: We have sign-off to spend 900 thousand this quarter.', {
                id: 'retained-extension-transcript', source: 'teams', meetingType: 'customer'
            })
        }
    }, { onResponse: (method) => { if (method === 'proposeMeetingChangeSet') delivered.resolve() } })
    const panel = await openPanel(page)
    try {
        await panel.getByRole('button', { name: 'Extract & Review' }).click()
        await arrived.promise
        await page.getByRole('button', { name: 'Discover', exact: true }).click()
        await expect(panel).toHaveCount(0)
        release.resolve()
        await delivered.promise
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

test('@operation-retention restores pending VS Code extraction without another import', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    let acquisitions = 0
    await mount(page, {
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => {
            acquisitions++
            arrived.resolve()
            await release.promise
            return parseTranscriptContent('Priya Nair: Budget is approved for 900 thousand.', { source: 'teams', meetingType: 'customer' })
        }
    })
    const panel = await openPanel(page)
    try {
        await panel.getByRole('button', { name: 'Extract & Review' }).click()
        await arrived.promise
        await page.getByRole('button', { name: 'Discover', exact: true }).click()
        await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
        await openPanel(page)
        await expect(panel.getByRole('button', { name: 'Extracting...' })).toBeDisabled()
        expect(acquisitions).toBe(1)
        release.resolve()
        await expect(panel.getByRole('button', { name: 'Review last result' })).toBeVisible()
        await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toHaveCount(0)
        expect(acquisitions).toBe(1)
    } finally { release.resolve() }
})

test('@operation-retention does not repopulate private VS Code results after a mode reset', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    const delivered = deferredSignal()
    await mount(page, {
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => {
            arrived.resolve()
            await release.promise
            return parseTranscriptContent('Priya Nair: Budget is approved for 900 thousand.', { source: 'teams', meetingType: 'customer' })
        }
    }, { onResponse: (method) => { if (method === 'proposeMeetingChangeSet') delivered.resolve() } })
    const panel = await openPanel(page)
    try {
        await panel.getByRole('button', { name: 'Extract & Review' }).click()
        await arrived.promise
        await page.evaluate(() => window.postMessage({
            kind: 'event', type: 'modeChanged', payload: { mode: 'live' }
        }, window.location.origin))
        await expect(panel).toHaveCount(0)
        release.resolve()
        await delivered.promise
        await openPanel(page)
        await expect(panel.getByRole('button', { name: 'Extract & Review' })).toBeEnabled()
        await expect(panel.getByRole('button', { name: 'Review last result' })).toHaveCount(0)
        await expect(page.getByRole('dialog', { name: 'Review meeting signals' })).toHaveCount(0)
    } finally { release.resolve() }
})

test('@operation-retention consumes a VS Code proposal when Submit starts, before Done', async ({ page }) => {
    const arrived = deferredSignal()
    const release = deferredSignal()
    let applies = 0
    await mount(page, {
        listRecentMeetings: async () => [arc],
        acquireRecentTranscript: async () => parseTranscriptContent(
            'Priya Nair: We have sign-off to spend 900 thousand this quarter.', { source: 'teams', meetingType: 'customer' })
    }, {
        apply: async ({ proposal, approval }) => {
            applies++
            expect(approval.reason).toBe('Reviewed retained proposal')
            arrived.resolve()
            await release.promise
            return { changeSetId: proposal.changeSetId, state: 'applied', items: [], auditNote: 'Applied in the isolated review fixture.' }
        }
    })
    const panel = await openPanel(page)
    await panel.getByRole('button', { name: 'Extract & Review' }).click()
    const review = page.getByRole('dialog', { name: 'Review meeting signals' })
    await expect(review).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Review last result' })).toHaveCount(1)
    await review.getByRole('textbox', { name: 'Reason (required)' }).fill('Reviewed retained proposal')
    try {
        await review.getByRole('button', { name: 'Submit (all-or-none)' }).click()
        await arrived.promise
        await expect(panel.getByRole('button', { name: 'Review last result' })).toHaveCount(0)
        release.resolve()
        await expect(review.getByText(/^Applied/).first()).toBeVisible()
        await review.getByRole('button', { name: 'Done', exact: true }).click()
        await openPanel(page)
        await expect(panel.getByRole('button', { name: 'Review last result' })).toHaveCount(0)
        expect(applies).toBe(1)
    } finally { release.resolve() }
})
