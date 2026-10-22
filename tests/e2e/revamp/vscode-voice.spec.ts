import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { voiceContractVersion, type VoiceRequest, type VoiceSession } from '../../../packages/common/contracts/voice.js'
import { routeVoiceBridgeMessage } from '../../../apps/vscode-extension/src/voice-bridge.js'
import { recordedVoiceHost } from './voice-host-fixture.js'
import statements from '../../fixtures/voice-input/statements.json' with { type: 'json' }

interface BridgeRequest {
    kind: string
    id: string
    method: string
    params?: unknown
}

declare global {
    interface Window { voiceBridgeTest(message: BridgeRequest): Promise<unknown> }
}

async function mount(page: Page, invoke: (message: BridgeRequest) => Promise<unknown>): Promise<void> {
    await page.exposeFunction('voiceBridgeTest', invoke)
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>:root{--vscode-editor-background:#fff;--vscode-foreground:#333;--vscode-font-family:"Segoe UI",sans-serif;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#d1d1d1}</style></head><body><div id="root" data-mode="sample"></div></body></html>'
    }))
    await page.addInitScript(() => {
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined, setState: () => undefined,
                postMessage(message: BridgeRequest) {
                    if (message.kind !== 'request') return
                    if (message.method === 'voiceInput') {
                        void window.voiceBridgeTest(message).then((response) => window.postMessage(response, window.location.origin))
                        return
                    }
                    let result: unknown
                    if (message.method === 'getCurrentUserEmail') result = 'sample@example.test'
                    else if (message.method === 'getPortfolioIndex') result = {
                        contractVersion: '1.0', accounts: [{ id: 'alpha', name: 'Alpha customer', segment: 'Enterprise' }],
                        opportunities: [{ id: 'grid', accountId: 'alpha', name: 'grid operations modernization', recordedStage: 2,
                            value: 100, currency: 'USD', closeDate: '2026-12-01' }]
                    }
                    else if (message.method === 'listAccounts') result = [{ id: 'alpha', name: 'Alpha customer', segment: 'Enterprise' }]
                    else if (message.method === 'listOpportunities') result = [{
                        id: 'grid', accountId: 'alpha', name: 'grid operations modernization',
                        recordedStage: 2, value: 100, currency: 'USD', closeDate: '2026-12-01'
                    }]
                    else if (message.method === 'runMcemCoach') result = {
                        summary: 'Review the grid opportunity', state: 'needs-attention', recordedStage: 2, evidenceBasedStage: 1,
                        criteria: [], missingData: [], recommendations: [], evidence: []
                    }
                    else result = []
                    window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                }
            })
        })
    })
    await page.goto('/')
    await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
    await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
    await expect(page.getByRole('button', { name: 'Start voice search', exact: true })).toBeVisible()
}

test.describe('VS Code bridge with actual recorded native speech', () => {
    test.skip(process.platform !== 'win32', 'Offline native voice requires local Windows.')
    for (const statement of statements) {
        test(`transcribes recorded ${statement.id} using the validated bridge and shared search`, async ({ page }) => {
            const fixture = await recordedVoiceHost(resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statement.id}.wav`))
            try {
                await mount(page, (message) => routeVoiceBridgeMessage(fixture.host, message))
                const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
                await search.focus()
                await page.getByRole('button', { name: 'Start voice search', exact: true }).click()
                await page.getByRole('button', { name: 'Start listening', exact: true }).click()
                await expect(search).toHaveValue(new RegExp(statement.text, 'i'), { timeout: 20_000 })
                expect(fixture.events.some((event) => event.type === 'segment' && event.segment.isFinal)).toBe(true)
                const recognized = fixture.events.flatMap((event) => event.type === 'segment' && event.segment.isFinal ? [event.segment.text] : []).join(' ')
                await expect(search).toHaveValue(recognized)
                await search.fill('grid operations')
                await search.press('Enter')
                await expect(search).toHaveValue('')
                await expect(page.locator('#portfolio-details-panel').getByRole('heading', { name: 'grid operations modernization', exact: true })).toBeVisible()
            } finally { await fixture.close() }
        })
    }
})

test('hotkey/cancel/edit/selection/blur preserve search and ignore late voice results', async ({ page }) => {
    let snapshot: VoiceSession | undefined
    let cancellations = 0
    let starts = 0
    let sequence = 0
    await mount(page, async (message) => {
        const request = message.params as VoiceRequest
        if (request.operation === 'availability') return {
            kind: 'response', id: message.id, ok: true,
            result: { contractVersion: voiceContractVersion, kind: 'availability', availability: { available: true, processing: 'on-device', engine: 'windows-offline' } }
        }
        if (request.operation === 'start') {
            starts++
            snapshot = {
                contractVersion: voiceContractVersion, kind: 'session', sessionId: request.sessionId,
                status: 'listening', segments: [{ id: '0', sequence: ++sequence, text: 'grid', isFinal: false }], message: ''
            }
        } else if (request.operation === 'stop' && snapshot) {
            snapshot = { ...snapshot, status: 'ended', segments: [{ id: '0', sequence: ++sequence, text: 'grid', isFinal: true }] }
        } else if (request.operation === 'cancel' && snapshot) {
            cancellations++
            snapshot = { ...snapshot, status: 'cancelled', segments: [] }
        }
        return { kind: 'response', id: message.id, ok: true, result: snapshot }
    })
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('before old after')
    await search.evaluate((element: HTMLInputElement) => element.setSelectionRange(7, 10))
    await page.keyboard.press('Control+Alt+m')
    await page.getByRole('button', { name: 'Start listening', exact: true }).click()
    await expect(page.getByLabel('Voice transcript preview')).toHaveText('grid')
    await search.press('Enter')
    await expect(search).toHaveValue('before old after')
    await page.keyboard.press('Control+Alt+m')
    await expect(search).toHaveValue('before grid after')
    expect(starts).toBe(1)
    await expect.poll(() => cancellations).toBe(1)
    await page.getByRole('button', { name: 'Dismiss voice search status' }).click()

    await search.fill('typed')
    await page.keyboard.press('Control+Alt+m')
    await expect(page.getByLabel('Voice transcript preview')).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('typed')
    await expect.poll(() => cancellations).toBe(2)
    await page.getByRole('button', { name: 'Dismiss voice search status' }).click()

    await search.focus()
    await page.keyboard.press('Control+Alt+m')
    await expect(page.getByLabel('Voice transcript preview')).toBeVisible()
    await search.fill('manual wins')
    await expect(search).toHaveValue('manual wins')
    await expect.poll(() => cancellations).toBe(3)
    await page.getByRole('button', { name: 'Plays', exact: true }).click()
    await expect(search).toHaveValue('')
    await search.focus()
    await page.keyboard.press('Control+Alt+m')
    await expect(page.getByLabel('Voice transcript preview')).toBeVisible()
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    await expect.poll(() => cancellations).toBe(4)
    await expect(page.getByRole('button', { name: 'Stop voice search', exact: true })).toHaveCount(0)
})
