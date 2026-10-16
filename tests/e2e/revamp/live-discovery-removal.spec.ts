import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { LiveMsxConnector } from '../../../packages/connectors/msx/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createSampleWorkflowHost } from '../../../packages/orchestrator/workflows/index.js'
import { buildLiveDataProvider, buildLiveTaskAgents } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { ExtensionMcemGuidanceConnector } from '../../../apps/vscode-extension/src/mcem-guidance.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'

declare global {
    interface Window {
        dispatchLiveTlcRequest(message: unknown): Promise<unknown>
    }
}

test('verifies live removal and does not confuse remaining milestone membership with Deal Team membership', async ({ page }) => {
    const userId = '00000000-0000-4000-8000-000000000001'
    const accountId = '00000000-0000-4000-8000-000000000a01'
    const opportunityId = '00000000-0000-4000-8000-000000000b02'
    const templateId = '00000000-0000-4000-8000-000000000c03'
    const membershipId = '00000000-0000-4000-8000-000000000d04'
    const milestoneId = '00000000-0000-4000-8000-000000000e05'
    let dealTeamMember = true
    let deletes = 0
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input))
        const method = init?.method ?? 'GET'
        if (method === 'DELETE') {
            expect(url.pathname).toBe(`/api/data/v9.2/msp_dealteams(${membershipId})`)
            deletes += 1
            if (deletes > 1) dealTeamMember = false
            return new Response(null, { status: 204 })
        }
        expect(method).toBe('GET')
        let body: unknown
        if (url.pathname.endsWith('/WhoAmI')) body = { UserId: userId }
        else if (url.pathname.endsWith('/msp_dealteams')) {
            expect(url.searchParams.get('$filter')).toContain(`_msp_dealteamuserid_value eq ${userId}`)
            body = { value: dealTeamMember ? [{ msp_dealteamid: membershipId, _msp_parentopportunityid_value: opportunityId }] : [] }
        } else if (url.pathname.endsWith('/teamtemplates')) body = { value: [{ teamtemplateid: templateId }] }
        else if (url.pathname.endsWith('/teams')) body = { value: [{ _regardingobjectid_value: milestoneId }] }
        else if (url.pathname.endsWith('/msp_engagementmilestones')) body = { value: [{
            msp_engagementmilestoneid: milestoneId, _msp_opportunityid_value: opportunityId,
            msp_name: 'Customer validation', msp_milestonestatus: 861980000
        }] }
        else if (url.pathname.endsWith('/accounts')) body = { value: [{ accountid: accountId, name: 'Sample customer' }] }
        else if (url.pathname.endsWith('/opportunities')) body = { value: [{
            opportunityid: opportunityId, _parentaccountid_value: accountId, name: 'Milestone-backed opportunity',
            statecode: 0, msp_activesalesstage: 1, estimatedvalue: 1000, estimatedclosedate: '2027-01-01',
            msp_technicalcapability: 861980000
        }] }
        else throw new Error(`Unexpected request: ${url} ${method}`)
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    }
    const provider = buildLiveDataProvider({
        orchestrator: new ThinSliceOrchestrator(
            new LiveMsxConnector({ getAccessToken: async () => 'test-token' }, request),
            new ExtensionMcemGuidanceConnector(),
            buildLiveTaskAgents()
        ),
        host: createSampleWorkflowHost(),
        account: 'sample@example.test',
        dispose: async () => undefined
    })
    await page.exposeFunction('dispatchLiveTlcRequest', (message: unknown) => routeBridgeMessage(provider, message))
    await page.route('**/', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body><div id="root" data-mode="live"></div></body></html>'
    }))
    await page.addInitScript(() => {
        Object.defineProperty(window, 'acquireVsCodeApi', {
            value: () => ({
                getState: () => undefined,
                setState: () => undefined,
                postMessage: (message: { kind: string }) => {
                    if (message.kind !== 'request') return
                    void window.dispatchLiveTlcRequest(message).then((response) => window.postMessage(response, window.location.origin))
                }
            })
        })
    })
    try {
        await page.goto('/')
        await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
        await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
        await page.getByRole('button', { name: 'Discover', exact: true }).click()
        const discovery = page.getByRole('region', { name: 'Discover opportunities' })
        const row = discovery.getByRole('row').filter({ hasText: 'Milestone-backed opportunity' })
        await expect(row).toContainText('On deal team')
        await row.getByRole('button', { name: 'Remove me', exact: true }).click()
        const confirmation = page.getByRole('dialog', { name: 'Remove from Deal Team' })
        await confirmation.getByRole('button', { name: 'Remove membership' }).click()
        await expect(confirmation.getByRole('alert')).toContainText('MSX still reports you on this Deal Team')
        expect(dealTeamMember).toBe(true)
        await expect(row).toContainText('On deal team')

        await confirmation.getByRole('button', { name: 'Remove membership' }).click()
        await expect(confirmation).not.toBeVisible()
        expect(dealTeamMember).toBe(false)
        await expect(row.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
        await discovery.getByRole('button', { name: 'Refresh', exact: true }).click()
        await expect(row.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
        await expect(row.getByText('On deal team', { exact: true })).toHaveCount(0)
        await expect(provider.listOpportunities(accountId)).resolves.toEqual([
            expect.objectContaining({ id: opportunityId })
        ])
        await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
        await expect(page.locator('#portfolio-accounts-panel').getByText('Milestone-backed opportunity', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Discover', exact: true }).click()
        await expect(row.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
        expect(deletes).toBe(2)
        expect(errors).toEqual([])
    } finally {
        await provider.dispose()
    }
})
