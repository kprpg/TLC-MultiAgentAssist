import { expect, test } from '@playwright/test'
import { embeddedTeams } from './helpers.js'
import { teamsClientReadyRequestSchema, teamsLaunchStatusSchema } from '../../../packages/common/contracts/teams-launch.js'

test('a browser preview reports its exact build without counting as Teams client verification', async ({ page, request }) => {
  const reports: unknown[] = []
  await page.route('**/api/teams/launch/ready', async (route) => {
    reports.push(route.request().postDataJSON())
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('Browser preview connected - Teams verification still required', { exact: true })).toBeVisible()
  const status = teamsLaunchStatusSchema.parse(await (await request.get('/api/teams/launch')).json())
  await expect.poll(() => reports.length).toBeGreaterThan(0)
  expect(teamsClientReadyRequestSchema.parse(reports[0])).toMatchObject({ runId: status.runId, clientBuildId: status.clientBuildId, host: 'browser' })
})

test('the rendered Teams SDK frame acknowledges the actual running backend and client build', async ({ page, request }) => {
  const started = Date.now()
  const app = await embeddedTeams(page, 'content')
  await expect(app.getByText('Teams client and backend verified', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const status = teamsLaunchStatusSchema.parse(await (await request.get('/api/teams/launch')).json())
    return status.clients.some((client) => client.host === 'teams' && Date.parse(client.checkedAt) >= started)
  }).toBe(true)
  await app.getByText('Teams client and backend verified', { exact: true }).click()
  await expect(app.getByText('11111111111111111111111111111111', { exact: true })).toBeVisible()
})

test('a frameless native Teams webview initializes the real SDK and is not misclassified as a browser preview', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'nativeInterface', { value: {
      framelessPostMessage: (serialized: string) => {
        const message = JSON.parse(serialized)
        let args: unknown[] | undefined
        if (message.func === 'initialize') args = [
          'content', 'desktop',
          JSON.stringify({ apiVersion: 4, supports: {}, isNAAChannelRecommended: false }), '2.58.0'
        ]
        if (message.func === 'getContext') args = [{
          locale: 'en-us', theme: 'default', frameContext: 'content', hostClientType: 'desktop',
          hostName: 'teams', entityId: 'tlc-personal', appSessionId: '11111111-1111-4111-8111-111111111111'
        }]
        if (args) queueMicrotask(() => {
          if ('onNativeMessage' in window && typeof window.onNativeMessage === 'function') {
            window.onNativeMessage({ data: { id: message.id, uuid: message.uuid, args } })
          }
        })
      }
    } })
  })
  const reports: unknown[] = []
  await page.route('**/api/teams/launch/ready', async (route) => { reports.push(route.request().postDataJSON()); await route.continue() })
  await page.goto('/?tlcAppVersion=1.2484.12345')
  await expect(page.getByText('Teams client and backend verified', { exact: true })).toBeVisible()
  expect(teamsClientReadyRequestSchema.parse(reports[0]).host).toBe('teams')
})

test('a stale client/backend build mismatch is visible and never sends a readiness acknowledgement', async ({ page, request }) => {
  const status = teamsLaunchStatusSchema.parse(await (await request.get('/api/teams/launch')).json())
  const reports: unknown[] = []
  await page.route('**/api/teams/launch', (route) => route.fulfill({
    json: { ...status, clientBuildId: '33333333-3333-4333-8333-333333333333' }
  }))
  await page.route('**/api/teams/launch/ready', async (route) => { reports.push(route.request().postDataJSON()); await route.continue() })
  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'does not match the running backend build' })).toBeVisible()
  expect(reports).toEqual([])
})

test('an old installed Teams manifest cannot pass just because its backend now serves a new client', async ({ page }) => {
  const reports: unknown[] = []
  await page.route('**/api/teams/launch/ready', async (route) => { reports.push(route.request().postDataJSON()); await route.continue() })
  const app = await embeddedTeams(page, 'content', 'default', '0.1.3')
  await expect(app.getByRole('alert').filter({ hasText: 'installed Teams app is stale' })).toBeVisible()
  expect(reports).toEqual([])
})

test('a failed backend check is displayed instead of retaining a success-shaped connection state', async ({ page }) => {
  await page.route('**/api/teams/launch', (route) => route.fulfill({ status: 503, json: { error: 'offline_fixture' } }))
  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'Backend readiness check failed (HTTP 503)' })).toBeVisible()
  await expect(page.getByText('Backend connection - verification failed', { exact: true })).toBeVisible()
})
