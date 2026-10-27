import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { contractVersion } from '../../../packages/common/contracts/index.js'
import { chooseOpportunity } from './helpers.js'
import { conversionOffer, followUpAgentResponse, initialAgentResponse } from '../revamp/agent-response-fixtures.js'
import { expectCopiedCustomerEmail, expectUnsentCustomerEmail, installCustomerEmailClipboard } from '../customer-email.js'

test('Teams customer email follow-ups can be copied and downloaded as unsent drafts for review', async ({ page, request }) => {
    let agentCalls = 0
    await page.route('**/api/teams/agent-stream', async (route) => {
        const input = route.request().postDataJSON() as { capability: string; prompt: string }
        agentCalls++
        if (agentCalls === 2) expect(input.prompt).toContain(initialAgentResponse)
        await route.fulfill({
            contentType: 'application/x-ndjson',
            body: JSON.stringify({
                type: 'complete',
                response: {
                    contractVersion, correlationId: `11111111-1111-4111-8111-${String(agentCalls).padStart(12, '0')}`,
                    capability: input.capability, agentVersion: 'presentation-test', generatedAt: '2026-10-24T16:00:00.000Z',
                    mode: 'sample', state: 'complete', content: agentCalls === 1 ? initialAgentResponse : followUpAgentResponse,
                    sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized test evidence.', checkedAt: '2026-10-24T16:00:00.000Z' }]
                }
            }) + '\n'
        })
    })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/')
    await installCustomerEmailClipboard(page)
    await chooseOpportunity(page, request)
    await page.getByRole('tab', { name: 'Guidance', exact: true }).click()
    await page.getByRole('button', { name: 'Run guidance', exact: true }).click()
    await page.getByRole('button', { name: `Send follow-up: ${conversionOffer}` }).click()
    const response = page.getByRole('article', { name: 'Agent follow-up response' })
    const actions = response.getByRole('region', { name: 'Customer email draft actions' })
    await expectCopiedCustomerEmail(page, actions)
    await actions.getByRole('button', { name: 'E-mail', exact: true }).click()
    await actions.getByLabel('Draft recipients', { exact: true }).fill('reviewer@example.com')
    const [download] = await Promise.all([
        page.waitForEvent('download'), actions.getByRole('button', { name: 'Prepare unsent draft', exact: true }).click()
    ])
    const path = await download.path()
    if (!path) throw new Error('The actual Teams email draft was not downloaded.')
    expectUnsentCustomerEmail(await readFile(path, 'utf8'))
    await expect(actions.getByRole('status')).toContainText('Unsent email draft downloaded')
    await expect(response).toContainText('Assumptions and missing information')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Please confirm the sponsor and approval sequence.')
})
