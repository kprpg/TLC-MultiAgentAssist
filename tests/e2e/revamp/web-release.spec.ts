import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { smokeWebRelease } from '../../../scripts/smoke-web-release.mjs'

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
