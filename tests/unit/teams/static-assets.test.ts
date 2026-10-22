import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startTeamsServer } from '../../../apps/teams/src/server.js'

it('caches only public content-hashed assets, never the runtime identity, HTML or private APIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tlc-public-assets-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets', 'index-Abc12345.js'), 'export const sample = true')
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Public asset fixture</title>')
  await writeFile(join(root, 'build.json'), JSON.stringify({ contractVersion: '1.0', buildId: '11111111-1111-4111-8111-111111111111' }))
  const application = await startTeamsServer({
    TLC_TEAMS_MODE: 'sample', TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: '0',
    TLC_TEAMS_ORIGIN: 'http://127.0.0.1:3978', TLC_TEAMS_STATIC_ROOT: root,
    TLC_TEAMS_STATE_PATH: ':memory:', TLC_TEAMS_SAMPLE_PATH: ':memory:'
  })
  try {
    const address = application.server.address()
    if (!address || typeof address === 'string') throw new Error('No asset fixture listener.')
    const base = `http://127.0.0.1:${address.port}`
    const asset = await fetch(`${base}/assets/index-Abc12345.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    await asset.text()
    for (const path of ['/', '/build.json', '/api/teams/config', '/api/teams/session']) {
      const response = await fetch(base + path)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await response.text()
    }
  } finally { await application.close(); await rm(root, { recursive: true, force: true }) }
})
