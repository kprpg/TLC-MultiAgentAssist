import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createSampleAuthentication } from '../../../apps/web/src/authentication.js'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type AgentStreamHandlers, type AgentTaskContext } from '../../../packages/orchestrator/index.js'
import { briefOffer, conversionOffer, followUpAgentResponse, initialAgentResponse } from './agent-response-fixtures.js'
import { expectCopiedCustomerEmail, expectUnsentCustomerEmail, installCustomerEmailClipboard } from '../customer-email.js'

let server: Server | undefined
test.afterEach(async () => {
    if (server) {
        server.closeAllConnections()
        await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()))
        server = undefined
    }
})

async function mountGuidance(page: Page) {
    const calls: AgentTaskContext[] = []
    let finish: (() => void) | undefined
    let followUpSignal: AbortSignal | undefined
    const core = new ThinSliceOrchestrator(new FixtureMsxConnector(), new FixtureMcemGuidanceConnector(), {
        'account-pulse': {
            version: 'presentation-test',
            agent: {
                invoke: async () => initialAgentResponse,
                stream: async (context: AgentTaskContext, handlers: AgentStreamHandlers) => {
                    calls.push(context)
                    if (calls.length === 1) return initialAgentResponse
                    followUpSignal = handlers.signal
                    handlers.onDelta(followUpAgentResponse)
                    await new Promise<void>((done, reject) => {
                        const onAbort = () => reject(new Error('The request was cancelled.'))
                        handlers.signal?.addEventListener('abort', onAbort, { once: true })
                        finish = () => { handlers.signal?.removeEventListener('abort', onAbort); done() }
                    })
                    return followUpAgentResponse
                }
            }
        }
    })
    const runtime: WebRuntime = Object.assign(core, {
        listMeetingTranscripts: async () => [], getMeetingTranscript: async () => null,
        proposeMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this presentation test.') },
        applyMeetingChangeSet: async () => { throw new Error('Meeting capture is outside this presentation test.') }
    })
    const api = buildWebApiHandler({ createRuntime: () => runtime, authenticate: createSampleAuthentication() })
    const staticHandler = buildStaticHandler(resolve('apps', 'desktop', 'dist', 'revamp'), 'sample')
    server = createServer((request, response) => {
        setSecurityHeaders(response)
        void (async () => {
            if (!(await api(request, response))) await staticHandler(request, response)
        })().catch((error: unknown) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Presentation test host failed.')
        })
    })
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Presentation test server did not start.')
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.getByRole('navigation', { name: 'Primary tabs' }).getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()
    await page.getByRole('table', { name: 'Contoso Energy opportunities' }).getByRole('button', { name: /^Grid operations modernization / }).click()
    await page.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
    await page.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` })).toBeEnabled()
    return { calls, complete: () => finish?.(), signal: () => followUpSignal }
}

test('Web agent follow-ups send the preceding answer and display both responses with headings, bold labels, and tables', async ({ page }) => {
    const host = await mountGuidance(page)
    await installCustomerEmailClipboard(page)
    await expect(page.locator('.agent-response-markdown h2')).toHaveText(['Summary', 'Observed signals', 'Recommended actions', 'Sources', 'Feedback prompt'])
    await expect(page.locator('.agent-response-markdown li strong')).toHaveText(['Evidence:', 'Confidence:', 'Owner role:', 'Priority:', 'Rationale:'])
    await expect(page.locator('.agent-response-markdown li strong').first()).toHaveCSS('font-weight', '650')
    expect(host.calls).toHaveLength(1)

    const send = page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` })
    await send.focus()
    await send.press('Enter')
    await expect.poll(() => host.calls.length).toBe(2)
    const followUp = host.calls[1]!.request
    expect(followUp).toMatchObject({ capability: 'account-pulse', accountId: 'account-contoso', opportunityId: 'opp-grid-modernization' })
    expect(followUp.prompt).toContain(initialAgentResponse)
    expect(followUp.prompt).toContain(conversionOffer)
    await expect(send).toBeDisabled()
    await expect(page.getByRole('button', { name: `Send follow-up: ${briefOffer}` })).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Customer email draft actions' })).toHaveCount(0)
    host.complete()

    const response = page.getByRole('article', { name: 'Agent follow-up response' })
    await expect(response.getByRole('heading', { name: 'Customer-ready draft' })).toBeVisible()
    await expect(response.getByRole('columnheader')).toHaveText(['Owner', 'Action', 'Evidence'])
    await expect(response.locator('strong').filter({ hasText: 'Subject:' })).toBeVisible()
    await expect(page.locator('.agent-response-markdown').first().getByRole('heading', { name: 'Summary', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Send follow-up: ${briefOffer}` })).toBeEnabled()
    const actions = response.getByRole('region', { name: 'Customer email draft actions' })
    await expectCopiedCustomerEmail(page, actions)
    await actions.getByRole('button', { name: 'E-mail', exact: true }).click()
    await actions.getByLabel('Draft recipients', { exact: true }).fill('reviewer@example.com')
    await expect(actions.getByLabel('Draft subject', { exact: true })).toHaveValue('Confirming the approval path')
    const [download] = await Promise.all([
        page.waitForEvent('download'), actions.getByRole('button', { name: 'Prepare unsent draft', exact: true }).click()
    ])
    const path = await download.path()
    if (!path) throw new Error('The customer email draft was not downloaded.')
    expectUnsentCustomerEmail(await readFile(path, 'utf8'))
    await expect(actions.getByRole('status')).toContainText('Unsent email draft downloaded')
    await page.getByRole('button', { name: `Send follow-up: ${briefOffer}` }).click()
    await expect.poll(() => host.calls.length).toBe(3)
    expect(host.calls[2]!.request.prompt).toContain(followUpAgentResponse)
    host.complete()
    await expect(page.getByRole('button', { name: 'Cancel follow-up' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Customer email draft actions' })).toHaveCount(2)
})

test('Web customer drafts validate recipients and report download failures without sending anything', async ({ page }) => {
    const host = await mountGuidance(page)
    await installCustomerEmailClipboard(page)
    await page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` }).click()
    await expect.poll(() => host.calls.length).toBe(2)
    host.complete()
    const actions = page.getByRole('article', { name: 'Agent follow-up response' }).getByRole('region', { name: 'Customer email draft actions' })
    await actions.getByRole('button', { name: 'E-mail', exact: true }).click()
    await actions.getByLabel('Draft recipients', { exact: true }).fill('not-an-email')
    await actions.getByRole('button', { name: 'Prepare unsent draft', exact: true }).click()
    await expect(actions.getByRole('alert')).toContainText('valid recipient addresses')
    await actions.getByLabel('Draft subject', { exact: true }).fill('Reviewed approval sequence')
    await actions.getByRole('button', { name: 'Copy', exact: true }).click()
    expect(await page.evaluate(() => window.customerEmailClipboard.texts.at(-1))).toMatch(/^Subject: Reviewed approval sequence\n/)
    await page.route('**/api/open-email-compose', (route) => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Draft download is unavailable.' })
    }))
    await actions.getByLabel('Draft recipients', { exact: true }).fill('reviewer@example.com')
    await actions.getByRole('button', { name: 'Prepare unsent draft', exact: true }).click()
    await expect(actions.getByRole('alert')).toHaveText('Draft download is unavailable.')
    await expect(actions.getByRole('status')).toHaveCount(0)
    await expect(actions.getByRole('button', { name: 'Prepare unsent draft', exact: true })).toBeEnabled()
})

test('Web agent follow-ups send user-written feedback with the original response for context', async ({ page }) => {
    const host = await mountGuidance(page)
    await page.getByRole('button', { name: 'Reply to feedback', exact: true }).click()
    const send = page.getByRole('button', { name: 'Send reply to agent', exact: true })
    await expect(send).toBeDisabled()
    const feedback = 'Focus on the ATS owner assignments instead of an email.'
    await page.getByRole('textbox', { name: 'Reply to the agent' }).fill(feedback)
    await send.click()
    await expect.poll(() => host.calls.length).toBe(2)
    expect(host.calls[1]!.request.prompt).toContain(feedback)
    expect(host.calls[1]!.request.prompt).toContain(initialAgentResponse)
    host.complete()
    await expect(page.getByRole('article', { name: 'Agent follow-up response' }).getByRole('heading', { name: 'Customer-ready draft' })).toBeVisible()
})

test('Web agent follow-ups retain the original on errors and allow retry and cancellation', async ({ page }) => {
    const host = await mountGuidance(page)
    await page.route('**/api/agent-task/stream', (route) => route.fulfill({
        contentType: 'application/x-ndjson',
        body: JSON.stringify({ type: 'error', code: 'failed', message: 'The follow-up is temporarily unavailable.' }) + '\n'
    }))
    const send = page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` })
    await send.click()
    await expect(page.getByRole('alert')).toHaveText('The follow-up is temporarily unavailable.')
    await expect(page.locator('.agent-response-markdown').first()).toContainText('The approval path is unconfirmed.')
    await page.unroute('**/api/agent-task/stream')
    await send.click()
    await expect.poll(() => host.calls.length).toBe(2)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel follow-up' }).click()
    await expect(send).toBeEnabled()
    await expect(page.getByRole('article', { name: 'Agent follow-up response' })).toHaveCount(0)
    await expect.poll(() => host.signal()?.aborted).toBe(true)
    host.complete()
    await expect(page.locator('.agent-response-markdown').first()).toContainText('The approval path is unconfirmed.')
})

test('Web agent follow-ups are cancelled when the selected agent changes', async ({ page }) => {
    const host = await mountGuidance(page)
    await page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` }).click()
    await expect.poll(() => host.calls.length).toBe(2)
    await page.getByRole('tab', { name: 'MCEM Coach', exact: true }).click()
    await expect.poll(() => host.signal()?.aborted).toBe(true)
    host.complete()
    await expect(page.getByRole('article', { name: 'Agent follow-up response' })).toHaveCount(0)
})
