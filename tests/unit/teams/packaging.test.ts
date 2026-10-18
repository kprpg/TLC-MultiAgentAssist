import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { createTeamsManifest, buildTeamsAppZip, classifyPackageOrigin, verifyTeamsOrigin } from '../../../scripts/package-teams.mjs'
import { readFileSync } from 'node:fs'

const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
const options = { mode: 'sample', origin: 'https://tlc.example.com', appId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b' }

describe('Teams end-user upload package', () => {
  it('packages only manifest and correctly-sized PNG icons at the ZIP root', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-zip-')); folders.push(folder)
    const path = await buildTeamsAppZip({ ...options, development: true, outputDirectory: folder })
    const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
    expect(Object.keys(zip.files).sort()).toEqual(['color.png', 'manifest.json', 'outline.png'])
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.manifestVersion).toBe('1.30')
    expect(manifest.staticTabs[0].contentUrl).toBe('https://tlc.example.com/')
    expect(manifest.name.short).toContain('Sample')
    expect(manifest.bots).toBeUndefined()
    expect(JSON.stringify(manifest)).not.toContain('secret')
    for (const [name, size] of [['color.png', 192], ['outline.png', 32]] as const) {
      const bytes = await zip.file(name)!.async('nodebuffer')
      expect(bytes.subarray(1, 4).toString()).toBe('PNG')
      expect(bytes.readUInt32BE(16)).toBe(size)
      expect(bytes.readUInt32BE(20)).toBe(size)
    }
  })
  it('declares the full live suite with exact bot SSO identity and least-privilege RSC metadata', () => {
    const botId = '44444444-4444-4444-8444-444444444444'
    const manifest = createTeamsManifest({ ...options, mode: 'live', botId })
    expect(manifest.webApplicationInfo).toEqual({ id: botId, resource: `api://botid-${botId}` })
    expect(manifest.bots?.[0]?.scopes).toEqual(['personal', 'team', 'groupChat'])
    expect(manifest.composeExtensions?.[0]?.commands[0]?.id).toBe('searchAccounts')
    expect(manifest.configurableTabs[0]?.context).toContain('meetingStage')
    const text = JSON.stringify(manifest)
    expect(text).toContain('ChannelMember.Read.Group')
    expect(text).not.toContain('OnlineMeetingTranscript.Read.All')
    expect(text).not.toContain('Chat.Read.All')
  })
  it('rejects HTTP, ambiguous origins, missing live bot IDs, unsafe IDs and accidental secret parameters', () => {
    expect(() => createTeamsManifest({ ...options, origin: 'http://public.example.com' })).toThrow()
    expect(() => createTeamsManifest({ ...options, origin: 'https://tlc.example.com/path' })).toThrow()
    expect(() => createTeamsManifest({ ...options, origin: 'https://user:password@tlc.example.com' })).toThrow()
    expect(() => createTeamsManifest({ ...options, mode: 'live' })).toThrow()
    expect(() => createTeamsManifest({ ...options, appId: '../other' })).toThrow()
    expect(() => createTeamsManifest({ ...options, clientSecret: 'not-for-a-manifest' })).toThrow()
  })
  it('keeps every installed URL and validDomains aligned with one configured HTTPS host', () => {
    const manifest = createTeamsManifest(options)
    expect(manifest.validDomains).toEqual(['tlc.example.com'])
    for (const url of [
      manifest.developer.websiteUrl, manifest.developer.privacyUrl, manifest.developer.termsOfUseUrl,
      manifest.staticTabs[0]!.contentUrl, manifest.staticTabs[0]!.websiteUrl,
      manifest.configurableTabs[0]!.configurationUrl
    ]) expect(new URL(url).origin).toBe(options.origin)
  })
  it('identifies localhost and reserved template origins as development-only, not configured installations', () => {
    for (const origin of ['https://localhost:3978', 'https://127.0.0.1:3978', 'https://tlc.example.com', 'https://your-host.invalid']) {
      expect(classifyPackageOrigin(origin).developmentOnly).toBe(true)
    }
    expect(classifyPackageOrigin('https://tlc.internal.contoso.net').developmentOnly).toBe(false)
  })
  it('verifies the actual Teams UI/API surface and does not mistake another web app health endpoint for readiness', async () => {
    const origin = 'https://tlc.internal.contoso.net'
    const good = async (url: string | URL | Request) => String(url).endsWith('/api/health')
      ? Response.json({ status: 'ready', surface: 'teams', mode: 'live' })
      : String(url).endsWith('/api/teams/session') ? Response.json({ error: 'authorization_required' }, { status: 401 })
        : new Response('<!doctype html><html><title>TLC Assist for Teams</title></html>', { headers: { 'content-type': 'text/html' } })
    expect(await verifyTeamsOrigin(origin, 'live', good)).toMatchObject({ hosting: 'reachable', tenantSignIn: 'unverified', liveData: 'unverified' })
    await expect(verifyTeamsOrigin(origin, 'live', async () => Response.json({ status: 'ready' }))).rejects.toThrow(/Teams/i)
    await expect(verifyTeamsOrigin('https://localhost:3978', 'live', good)).rejects.toThrow(/development|template/i)
  })
})

describe('VS Code F5 and release entry points', () => {
  it('preserves existing extension launchers and wires Teams backend debugging to its actual build and entrypoint', () => {
    const launch = JSON.parse(readFileSync('.vscode\\launch.json', 'utf8'))
    const tasks = JSON.parse(readFileSync('.vscode\\tasks.json', 'utf8'))
    const configuration = launch.configurations.find((entry: { name: string }) => entry.name === 'TLC Teams (sample, F5)')
    expect(configuration).toMatchObject({ type: 'node', request: 'launch', program: '${workspaceFolder}/apps/teams/dist/server.js', preLaunchTask: 'build-teams' })
    expect(launch.configurations.some((entry: { name: string }) => entry.name === 'Run TLC Assist Extension')).toBe(true)
    expect(tasks.tasks.find((entry: { label: string }) => entry.label === 'build-teams')?.command).toBe('npm run teams:build')
  })
})
