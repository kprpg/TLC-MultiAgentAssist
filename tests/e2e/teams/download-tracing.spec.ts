import { expect, test } from '@playwright/test'
import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { startTeamsServer } from '../../../apps/teams/src/server.js'
import { chooseOpportunity } from './helpers.js'

test.use({ trace: 'off' })

for (const snapshots of [false, true]) {
  test(`document downloads retain POST authorization with tracing snapshots ${snapshots ? 'enabled' : 'disabled'}`, async ({ browser }) => {
    const reservation = createServer()
    await new Promise<void>((resolveReady, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolveReady) })
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('No test port was reserved.')
    await new Promise<void>((resolveClosed) => reservation.close(() => resolveClosed()))
    const origin = `http://127.0.0.1:${address.port}`
    const application = await startTeamsServer({
      TLC_TEAMS_MODE: 'sample', TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: String(address.port),
      TLC_TEAMS_ORIGIN: origin, TLC_TEAMS_STATE_PATH: ':memory:', TLC_TEAMS_SAMPLE_PATH: ':memory:',
      TLC_TEAMS_STATIC_ROOT: resolve('apps', 'teams', 'dist', 'client')
    })
    const requests: Array<{ method: string; status: number }> = []
    application.server.on('request', (request, response) => {
      if (request.url?.startsWith('/api/teams/documents/')) {
        response.once('finish', () => { requests.push({ method: request.method ?? '', status: response.statusCode }) })
      }
    })
    const context = await browser.newContext({ baseURL: origin, acceptDownloads: true })
    try {
      if (snapshots) await context.tracing.start({ snapshots: true, screenshots: true })
      const page = await context.newPage()
      await page.goto('/')
      await chooseOpportunity(page, context.request)
      await page.getByRole('button', { name: 'Run guidance', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Grounded TLC response' })).toBeVisible()
      const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Word', exact: true }).click()])
      const wordPath = await word.path()
      if (!wordPath) throw new Error('The Word download was not saved.')
      expect((await JSZip.loadAsync(await readFile(wordPath))).file('word/document.xml')).not.toBeNull()
      await page.getByLabel('Email draft recipients').fill('reviewer@example.com')
      const [email] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download unsent email draft' }).click()])
      const emailPath = await email.path()
      if (!emailPath) throw new Error('The email download was not saved.')
      expect(await readFile(emailPath, 'utf8')).toContain('X-Unsent: 1')
      if (snapshots) await context.tracing.stop()
      expect(requests.filter((request) => request.method === 'POST')).toEqual([{ method: 'POST', status: 200 }, { method: 'POST', status: 200 }])
      const probes = requests.filter((request) => request.method !== 'POST')
      if (!snapshots) expect(probes).toEqual([])
      for (const probe of probes) expect(probe).toEqual({ method: 'GET', status: 404 })
    } finally {
      await context.close()
      await application.close()
    }
  })
}
