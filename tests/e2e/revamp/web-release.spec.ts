import { join, resolve } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { smokeWebRelease } from '../../../scripts/smoke-web-release.mjs'
import foundryConfiguration from '../../../config/foundry.environment.default.json' with { type: 'json' }
import { contractVersion } from '../../../packages/common/contracts/version.js'

test('runs the hosted SQLite sample anonymously and resets edits after a restart', async ({ page }) => {
    test.setTimeout(120_000)
    const packageRoot = process.env['TLC_WEB_RELEASE_ROOT'] || resolve('.')
    const entryPoint = process.env['TLC_WEB_RELEASE_ROOT'] ? 'server.js' : 'apps/web/dist/server.js'
    const unexpectedRequests: string[] = []
    await smokeWebRelease(packageRoot, { sqlite: true, entryPoint, onReady: async (baseUrl) => {
        await page.route('**/*', async (route) => {
            if (new URL(route.request().url()).origin !== baseUrl) {
                unexpectedRequests.push(new URL(route.request().url()).origin)
                await route.abort()
            } else await route.continue()
        })

        await page.setViewportSize({ width: 1600, height: 900 })
        await page.goto(baseUrl)
        await expect(page.getByRole('button', { name: 'Exit application', exact: true })).toHaveCount(0)
        await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
        await page.getByRole('table', { name: 'Contoso Energy opportunities' }).getByRole('button', { name: /^Grid operations modernization / }).click()
        await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toBeVisible()
        expect(new URL(page.url()).origin).toBe(baseUrl)
        expect((await page.context().storageState()).cookies).toEqual([])
        expect(unexpectedRequests).toEqual([])
        const response = await fetch(`${baseUrl}/api/accounts/account-contoso/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({ visibility: 'hidden' })
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ id: 'account-contoso', visibility: 'hidden' })
    } })
    await smokeWebRelease(packageRoot, { sqlite: true, entryPoint, onReady: async (baseUrl) => {
        const accounts: Array<{ id: string; visibility?: string }> = await (await fetch(`${baseUrl}/api/accounts?includeHidden=true`)).json()
        expect(accounts.find((account) => account.id === 'account-contoso')?.visibility).not.toBe('hidden')
    } })
})

test('keeps the real Node host anonymous while every sample AI feature uses the guarded Foundry transport', async ({ page }) => {
    test.setTimeout(120_000)
    const directory = await mkdtemp(join(tmpdir(), 'tlc-hybrid-host-'))
    const trace = join(directory, 'calls.jsonl')
    const configuration = { ...foundryConfiguration, foundry: {
        ...foundryConfiguration.foundry, projectEndpoint: 'https://fixture.services.ai.azure.com/api/projects/sample'
    } }
    const packageRoot = process.env['TLC_WEB_RELEASE_ROOT'] || resolve('.')
    const entryPoint = process.env['TLC_WEB_RELEASE_ROOT'] ? 'server.js' : 'apps/web/dist/server.js'
    try {
        await smokeWebRelease(packageRoot, {
            sqlite: true, entryPoint,
            nodeArguments: ['--import', pathToFileURL(resolve('tests', 'fixtures', 'sample-foundry-preload.mjs')).href],
            environment: {
                TLC_AI_MODE: 'foundry', TLC_FOUNDRY_ENV_BASE64: Buffer.from(JSON.stringify(configuration)).toString('base64'),
                HOME: directory, WEBSITE_SLOT_NAME: 'sample', TLC_SAMPLE_FOUNDRY_TRACE: trace
            },
            onReady: async (baseUrl) => {
                async function post(path: string, body: unknown) {
                    const response = await fetch(`${baseUrl}${path}`, {
                        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
                        body: JSON.stringify(body)
                    })
                    expect(response.status).toBe(200)
                    const result = await response.json()
                    expect(result).toMatchObject({ inference: { provider: 'foundry', state: 'complete' } })
                    return result
                }
                await page.setViewportSize({ width: 1600, height: 900 })
                await page.goto(baseUrl)
                await expect(page.getByText('Sample data / Foundry AI', { exact: true })).toBeVisible()
                await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
                await page.getByRole('table', { name: 'Contoso Energy opportunities' }).getByRole('button', { name: /^Grid operations modernization / }).click()
                await page.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
                await page.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
                await expect(page.locator('.agent-response-markdown').first()).toContainText('Synthetic Foundry guidance based only on the supplied sample evidence.')
                expect((await page.context().storageState()).cookies).toEqual([])
                for (const capability of ['mcem-coach', 'account-pulse', 'pursuit-executive', 'risk-solution-play']) {
                    await post('/api/agent-task', { contractVersion, capability, accountId: 'account-contoso', opportunityId: 'opp-grid-modernization', prompt: 'Review the sample evidence.' })
                }
                await post('/api/opportunities/opp-grid-modernization/meeting-change-set', { transcriptId: 'tr-grid-customer' })
                const topic = await post('/api/working-session/topic', {
                    contractVersion: '1.0', opportunityId: 'opp-grid-modernization', opportunityName: 'Grid operations modernization', milestoneName: 'Storage pilot'
                })
                await post('/api/working-session/prepare', {
                    contractVersion: '1.0', opportunityId: 'opp-grid-modernization', opportunityName: 'Grid operations modernization',
                    milestoneName: 'Storage pilot', topic: topic.topic, deliverables: { decks: false, learn: false, iac: true }
                })
                await post('/api/se-reporting', {
                    contractVersion: '1.0', operation: 'run', profileId: 'sample-manager', period: '2026-10', pillar: 'infra',
                    allowUnavailable: [], confirmed: true
                })
            }
        })
        const calls: Array<{ agent?: string; schema?: string; bounded: boolean; toolsDisabled: boolean }> =
            (await readFile(trace, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
        expect(new Set(calls.flatMap((call) => call.agent ? [call.agent] : []))).toEqual(new Set([
            'tlc-mcem-coach', 'tlc-account-pulse', 'tlc-pursuit-executive', 'tlc-risk-solution-play'
        ]))
        expect(new Set(calls.flatMap((call) => call.schema ? [call.schema] : []))).toEqual(new Set([
            'meeting_signals', 'working_session_topic', 'working_session_bicep', 'se_reporting_narratives'
        ]))
        expect(calls.every((call) => call.bounded && call.toolsDisabled)).toBe(true)
    } finally { await rm(directory, { recursive: true, force: true }) }
})
