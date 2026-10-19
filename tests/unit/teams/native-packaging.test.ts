import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildTeamsAppZip, createTeamsManifest, validateTeamsManifestCapabilities, verifyTeamsOrigin } from '../../../scripts/package-teams.mjs'
import { cliCapabilities, cliPublicConfigurationVersion, localConnectionVersion, nativeCapabilities } from '../../../packages/common/contracts/local-connection.js'

const options = {
  mode: 'live', authentication: 'local-interactive', origin: 'https://localhost:3978',
  appId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b'
}
describe('explicit device-local live package', () => {
  it('packages and probes the explicit CLI profile without registering a native app or reading source records', async () => {
    const manifest = createTeamsManifest({ ...options, authentication: 'local-azure-cli' })
    expect(manifest.name.short).toBe('TLC Assist Local')
    expect(manifest.bots).toBeUndefined()
    expect(manifest.webApplicationInfo).toBeUndefined()
    expect(() => createTeamsManifest({ ...options, authentication: 'local-azure-cli', origin: 'https://shared.contoso.net' })).toThrow()
    const requests: string[] = []
    const transport = async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      requests.push(path)
      if (path === '/api/health') return Response.json({ status: 'ready', surface: 'teams', mode: 'live' })
      if (path === '/') return new Response('<title>TLC Assist for Teams</title>', { headers: { 'content-type': 'text/html' } })
      if (path === '/api/teams/config') return Response.json({ contractVersion: cliPublicConfigurationVersion, mode: 'live', authentication: 'local-azure-cli', writeMode: 'read-only', capabilities: cliCapabilities })
      return Response.json({ error: 'authorization_required' }, { status: 401 })
    }
    expect(await verifyTeamsOrigin(options.origin, 'live', transport, 'local-azure-cli')).toEqual({ hosting: 'device-local', tenantSignIn: 'unverified', liveData: 'unverified' })
    expect(requests.sort()).toEqual(['/', '/api/health', '/api/teams/config', '/api/teams/session'])
  })
  it('advertises private native source use without unreachable bots or shared-state promises', () => {
    const manifest = createTeamsManifest(options)
    expect(manifest.name.short).toBe('TLC Assist Local')
    expect(manifest.staticTabs[0]).toMatchObject({ contentUrl: `${options.origin}/`, websiteUrl: `${options.origin}/`, scopes: ['personal'] })
    expect(manifest.configurableTabs).toBeUndefined()
    expect(manifest.bots).toBeUndefined()
    expect(manifest.composeExtensions).toBeUndefined()
    expect(manifest.webApplicationInfo).toBeUndefined()
    expect(manifest.authorization).toBeUndefined()
    expect(validateTeamsManifestCapabilities(manifest)).toBe(true)
  })
  it('keeps hosted live guards and rejects mixed/public native profiles', () => {
    expect(() => createTeamsManifest({ ...options, authentication: 'hosted-obo' })).toThrow()
    expect(() => createTeamsManifest({ ...options, origin: 'https://shared.contoso.net' })).toThrow()
    expect(() => createTeamsManifest({ ...options, mode: 'sample' })).toThrow()
    expect(() => createTeamsManifest({ ...options, botId: '44444444-4444-4444-8444-444444444444' })).toThrow()
  })
  it('creates a separate local-live ZIP with no backend, credentials or source-token parameters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-native-package-test-'))
    try {
      const path = await buildTeamsAppZip({ ...options, development: true, outputDirectory: directory })
      expect(path).toContain('TLC-Assist-Teams-local-live.zip')
      const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
      expect(Object.keys(zip.files).sort()).toEqual(['color.png', 'manifest.json', 'outline.png'])
      const text = await zip.file('manifest.json')!.async('string')
      expect(text).not.toContain('access_token')
      expect(text).not.toContain('nativeClientId')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('verifies only bootstrap endpoints and does not equate local hosting with MSX access', async () => {
    const requests: string[] = []
    const transport = async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requests.push(url.pathname)
      if (url.pathname === '/api/health') return Response.json({ status: 'ready', surface: 'teams', mode: 'live' })
      if (url.pathname === '/') return new Response('<title>TLC Assist for Teams</title>', { headers: { 'content-type': 'text/html' } })
      if (url.pathname === '/api/teams/config') return Response.json({ contractVersion: localConnectionVersion, mode: 'live', authentication: 'local-interactive', capabilities: nativeCapabilities })
      return Response.json({ error: 'authorization_required' }, { status: 401 })
    }
    expect(await verifyTeamsOrigin(options.origin, 'live', transport, 'local-interactive')).toEqual({ hosting: 'device-local', tenantSignIn: 'unverified', liveData: 'unverified' })
    expect(requests.sort()).toEqual(['/', '/api/health', '/api/teams/config', '/api/teams/session'])
  })
})
