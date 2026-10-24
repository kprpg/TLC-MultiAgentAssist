import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import type { WorkflowRunView } from '../../../packages/common/contracts/workflow-output.js'
import { workflowDefinitions, workflowOutput, workflowRun } from './workflow-fixtures.js'

type Phase = 'running' | 'partial' | 'failed'
const definition = workflowDefinitions.find((definition) => definition.id === 'WF-002')!

function view(phase: Phase): WorkflowRunView {
    const count = phase === 'partial' ? 100 : 20
    const output = workflowOutput('WF-002', 'action-list')
    const run = workflowRun('WF-002', phase === 'partial' ? 'completed' : phase, phase === 'partial' ? 'partial' : undefined)
    return {
        run: { ...run, resultRef: 'memory://workflow-runs/progress/result' },
        output: {
            ...output,
            generatedAt: phase === 'running' ? '2026-10-24T10:00:01.000Z' : '2026-10-24T10:00:05.000Z',
            card: {
                kind: 'action-list' as const, title: 'Overdue milestone triage', evidenceIds: ['tool-call-1'],
                actions: Array.from({ length: count }, (_, index) => ({
                    id: `action-${index}`, label: `Milestone ${index}`, priority: 'P1' as const
                }))
            },
            queueItems: Array.from({ length: count }, (_, index) => ({
                id: `queue-${index}`, workflowId: 'WF-002' as const, priority: 'P1' as const,
                title: `Review opportunity ${String(index).padStart(3, '0')}`, accountId: 'account-contoso',
                opportunityId: `opp-${index}`, opportunityName: `Opportunity ${index}`,
                evidenceIds: ['tool-call-1'], status: 'new' as const
            })),
            sourceHealth: [{
                source: 'dataverse-mcp', state: 'partial' as const,
                detail: phase === 'partial' ? 'Read limit reached; more rows may exist.' : 'More pages are loading; coverage is incomplete.',
                checkedAt: output.generatedAt
            }]
        }
    }
}

async function exercise(page: Page, surface: 'web' | 'desktop' | 'vscode', finish: (phase: Phase) => Promise<void>) {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByRole('button', { name: 'Plays', exact: true }).click()
    const launch = async () => {
        const card = page.locator(surface === 'vscode' ? '.play-row' : '.workflow-card').filter({ hasText: 'WF-002' })
        await card.getByRole('button', { name: surface === 'vscode' ? /^(Run|Re-run)$/ : 'Run workflow' }).click()
    }
    await launch()
    const progress = page.getByRole('status').filter({ hasText: 'WF-002' })
    await expect(progress).toContainText('20 items so far')
    await expect(progress).toContainText('incomplete')
    await expect(page.getByText('Review opportunity 019')).toBeVisible()
    await expect(progress).not.toContainText('Workflow completed')
    if (surface === 'vscode') await expect(page.getByRole('button', { name: 'Send to MCEM Coach' }).first()).toBeDisabled()
    else await expect(page.getByRole('button', { name: 'Send to MCEM Coach' })).toHaveCount(0)

    await finish('partial')
    await expect(progress).toContainText('partial source coverage')
    await expect(progress).toContainText('Read limit reached; more rows may exist.')
    await expect(page.getByText('Review opportunity 099')).toBeVisible()
    await expect(progress).not.toContainText('all required sources')

    await launch()
    await expect(progress).toContainText('20 items so far')
    await finish('failed')
    await expect(progress).toContainText('The play did not finish')
    await expect(progress).toContainText('incomplete')
    await expect(page.getByText('Review opportunity 019')).toBeVisible()
    await expect(progress).not.toContainText('Workflow completed')
    if (surface === 'vscode') await expect(page.locator('.play-status-dot')).not.toHaveClass(/done/)
}

test('Web shows the first page while loading and preserves honest partial and failed outcomes', async ({ page }) => {
    let phase: Phase = 'running'
    await page.route('**/api/workflows/*', async (route) => {
        const operation = new URL(route.request().url()).pathname.split('/').at(-1)
        if (operation === 'list') return route.fulfill({ json: [definition] })
        if (operation === 'history') return route.fulfill({ json: [] })
        if (operation === 'start') {
            phase = 'running'
            return route.fulfill({ json: workflowRun('WF-002', 'running') })
        }
        return route.fulfill({ json: view(phase) })
    })
    await page.goto('/')
    await exercise(page, 'web', async (next) => { phase = next })
})

declare global {
    interface Window { invokePlayBridge(message: unknown): Promise<unknown> }
}

test('VS Code shows the first page without calling it complete or enabling premature guidance', async ({ page }) => {
    let phase: Phase = 'running'
    const provider = {
        ...createSampleDataProvider(),
        listWorkflowDefinitions: async () => [definition],
        startWorkflow: async () => { phase = 'running'; return workflowRun('WF-002', 'running') },
        getWorkflowRun: async () => view(phase)
    }
    try {
        await page.exposeFunction('invokePlayBridge', (message: unknown) => routeBridgeMessage(provider, message))
        await page.route('**/', (route) => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body><div id="root" data-mode="sample"></div></body></html>'
        }))
        await page.addInitScript(() => {
            Object.defineProperty(window, 'acquireVsCodeApi', { value: () => ({
                getState: () => undefined, setState: () => undefined,
                postMessage: (message: { kind: string }) => {
                    if (message.kind === 'request') {
                        void window.invokePlayBridge(message).then((reply) => window.postMessage(reply, window.location.origin))
                    }
                }
            }) })
        })
        await page.goto('/')
        await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
        await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
        await exercise(page, 'vscode', async (next) => { phase = next })
    } finally {
        await provider.dispose()
    }
})

test('Desktop renders first-page progress over IPC and keeps failed results visibly incomplete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-plays-progress-'))
    const app = await electron.launch({
        args: [resolve('apps', 'desktop'), `--user-data-dir=${directory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        await app.evaluate(({ ipcMain }, fixtures) => {
            process.env.TLC_TEST_PLAY_PHASE = 'running'
            for (const operation of ['list', 'start', 'get', 'history']) ipcMain.removeHandler(`tlc:workflow-${operation}`)
            ipcMain.handle('tlc:workflow-list', () => [fixtures.definition])
            ipcMain.handle('tlc:workflow-history', () => [])
            ipcMain.handle('tlc:workflow-start', () => {
                process.env.TLC_TEST_PLAY_PHASE = 'running'
                return fixtures.running.run
            })
            ipcMain.handle('tlc:workflow-get', () => process.env.TLC_TEST_PLAY_PHASE === 'partial' ? fixtures.partial
                : process.env.TLC_TEST_PLAY_PHASE === 'failed' ? fixtures.failed : fixtures.running)
        }, { definition, running: view('running'), partial: view('partial'), failed: view('failed') })
        await exercise(await app.firstWindow(), 'desktop', async (phase) => {
            await app.evaluate((_electron, next) => { process.env.TLC_TEST_PLAY_PHASE = next }, phase)
        })
    } finally {
        await app.close()
        await rm(directory, { recursive: true, force: true })
    }
})
