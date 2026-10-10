import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import statements from '../../fixtures/voice-input/statements.json' with { type: 'json' }
import { setSecurityHeaders } from '../../../apps/web/src/hosting.js'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { voiceWorkerCsp } from '../../../scripts/voice-worker-assets.mjs'

test('actual hosted security policy permits offline recognition without external connections', async ({ playwright }) => {
    const server = createServer((_request, response: ServerResponse) => {
        setSecurityHeaders(response)
        response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Security header test listener failed.')
    const policyResponse = await fetch(`http://127.0.0.1:${address.port}`)
    const csp = policyResponse.headers.get('content-security-policy')
    const permissions = policyResponse.headers.get('permissions-policy')
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (!csp || !permissions) throw new Error('Actual web host security headers are missing.')
    const browser = await playwright.chromium.launch({
        args: [
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-audio-input-processing',
            `--use-file-for-fake-audio-capture=${resolve('tests', 'fixtures', 'voice-input', 'recordings', 'grid-operations.wav')}%noloop`
        ]
    })
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 850 } })
        const violations: string[] = []
        page.on('console', (message) => {
            if (message.type() === 'error') violations.push(message.text())
        })
        await page.route('**/', async (route) => {
            const response = await route.fetch()
            await route.fulfill({ response, headers: {
                ...response.headers(), 'content-security-policy': csp, 'permissions-policy': permissions
            } })
        })
        await page.route('**/voice/vosk-worker.js', async (route) => {
            const response = await route.fetch()
            await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': voiceWorkerCsp } })
        })
        await page.goto('http://127.0.0.1:4174/')
        await page.getByRole('button', { name: 'Start voice search', exact: true }).click()
        await page.getByRole('button', { name: 'Start listening', exact: true }).click()
        await expect(page.getByLabel('Voice transcript preview')).toContainText('grid operations modernization', { timeout: 45_000 })
        await page.getByRole('button', { name: 'Stop voice search', exact: true }).click()
        await expect(page.getByRole('searchbox', { name: 'Search accounts and opportunities' })).toHaveValue(/grid operations modernization/i)
        expect(violations.filter((message) => /Content Security Policy|Refused|Permissions policy/i.test(message))).toEqual([])
    } finally { await browser.close() }
})

test.describe('real offline browser voice input', () => {
    test.setTimeout(90_000)

    for (const statement of statements) {
        test(`recognizes recorded ${statement.id} without cloud calls or automatic selection`, async ({ playwright }) => {
            const browser = await playwright.chromium.launch({
                args: [
                    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-audio-input-processing',
                    `--use-file-for-fake-audio-capture=${resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statement.id}.wav`)}%noloop`
                ]
            })
            const context = await browser.newContext({ viewport: { width: 1400, height: 850 } })
            const page = await context.newPage()
            const external: string[] = []
            const errors: string[] = []
            page.on('pageerror', (error) => errors.push(error.message))
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url())
                if (url.hostname !== '127.0.0.1' && url.protocol !== 'blob:') {
                    external.push(url.origin)
                    return route.abort()
                }
                return route.continue()
            })
            try {
                await page.goto('http://127.0.0.1:4174/')
                const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
                await expect(search).toBeVisible()
                await page.getByRole('button', { name: 'Start voice search', exact: true }).click()
                const disclosure = page.getByRole('dialog', { name: 'Voice search' })
                await expect(disclosure).toContainText('processed on this device')
                await disclosure.getByRole('button', { name: 'Start listening', exact: true }).click()
                await expect(page.getByLabel('Voice transcript preview')).toContainText(statement.text, { timeout: 45_000 })
                await expect(search).toHaveValue('')
                await search.press('Enter')
                await expect(search).toHaveValue('')
                await page.getByRole('button', { name: 'Stop voice search', exact: true }).click()
                await expect(search).toHaveValue(new RegExp(statement.text, 'i'))
                await expect(page.getByRole('heading', { name: 'Select a customer account', exact: true })).toBeVisible()
                expect(external).toEqual([])
                expect(errors).toEqual([])
                await page.getByRole('button', { name: 'Dismiss voice search status' }).click()
                await search.fill('grid operations')
                await search.press('Enter')
                await expect(page.getByRole('heading', { name: 'Grid operations modernization', exact: true })).toBeVisible()
            } finally { await browser.close() }
        })
    }
})

test('hidden narrow search refuses the hotkey and never requests microphone access', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            value: () => { throw new Error('Hidden search must never request microphone access.') }
        })
    })
    await page.setViewportSize({ width: 850, height: 720 })
    await page.goto('/')
    await page.locator('body').click()
    await page.keyboard.press('Control+Alt+m')
    await expect(page.getByRole('alert', { name: 'Voice search status' })).toContainText('hidden')
    await expect(page.getByRole('dialog', { name: 'Voice search' })).toHaveCount(0)
})

test('microphone denial is visible and ordinary typed search remains usable', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            value: () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
        })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Start voice search', exact: true }).click()
    await page.getByRole('button', { name: 'Start listening', exact: true }).click()
    await expect(page.getByRole('alert', { name: 'Voice search status' })).toContainText('denied')
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })
    await search.fill('grid operations')
    await search.press('Enter')
    await expect(page.getByRole('heading', { name: 'Grid operations modernization', exact: true })).toBeVisible()
})
