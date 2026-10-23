import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { get, request as httpsRequest } from 'node:https'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadTeamsTlsConfiguration } from '../../../apps/teams/src/configuration.js'
import { startTeamsServer } from '../../../apps/teams/src/server.js'
import { invokeProtectedOwnerCommand, prepareOwnerDirectory } from '../../../apps/teams/src/local-owner-control.js'
import { localConnectionVersion } from '../../../packages/common/contracts/local-connection.js'
import { actionPreviewSchema } from '../../../packages/common/contracts/collaboration.js'
import { z } from 'zod'
import { temporaryRoot } from './test-temp-root.js'

const nativeClient = vi.hoisted(() => ({
  interactive: vi.fn(async () => { throw new Error('A TLS/bootstrap test must not trigger source sign-in.') }),
  silent: vi.fn(async () => { throw new Error('A TLS/bootstrap test must not acquire source credentials.') }),
  clear: vi.fn(async () => undefined)
}))
const cliCredential = vi.hoisted(() => ({
  getToken: vi.fn(async () => { throw new Error('A CLI TLS/bootstrap test must not acquire a source token.') })
}))
const ownerStartup = vi.hoisted(() => ({ beforeReady: vi.fn(async () => undefined) }))
vi.mock('../../../apps/teams/src/local-owner-control.js', async (original) => {
  const actual = await original<typeof import('../../../apps/teams/src/local-owner-control.js')>()
  return {
    ...actual,
    startProtectedOwnerControl: async (options: Parameters<typeof actual.startProtectedOwnerControl>[0]) => {
      const control = await actual.startProtectedOwnerControl(options)
      await ownerStartup.beforeReady()
      return control
    }
  }
})
vi.mock('@azure/identity', async (original) => ({
  ...await original<typeof import('@azure/identity')>(),
  AzureCliCredential: class { getToken = cliCredential.getToken }
}))
vi.mock('../../../apps/teams/src/native-identity.js', async (original) => ({
  ...await original<typeof import('../../../apps/teams/src/native-identity.js')>(),
  createNativeAuthenticationClient: () => nativeClient
}))

const execute = promisify(execFile)
let directory: string
let certificatePath: string
let keyPath: string
beforeAll(async () => {
  directory = await mkdtemp(join(temporaryRoot, 'tlc-teams-test-tls-'))
  certificatePath = join(directory, 'localhost.pem')
  keyPath = join(directory, 'localhost-key.pem')
  await execute('pwsh', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $rsa = [Security.Cryptography.RSA]::Create(2048)
    try {
      $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
      $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
      $san.AddDnsName('localhost')
      $san.AddIpAddress([Net.IPAddress]::Loopback)
      $request.CertificateExtensions.Add($san.Build())
      $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1), [DateTimeOffset]::UtcNow.AddDays(1))
      try {
        [IO.File]::WriteAllText((Join-Path $env:TLC_TEST_TLS_DIRECTORY 'localhost.pem'), $certificate.ExportCertificatePem())
        [IO.File]::WriteAllText((Join-Path $env:TLC_TEST_TLS_DIRECTORY 'localhost-key.pem'), $rsa.ExportPkcs8PrivateKeyPem())
      } finally { $certificate.Dispose() }
    } finally { $rsa.Dispose() }
  `], { env: { ...process.env, TLC_TEST_TLS_DIRECTORY: directory }, timeout: 30_000 })
}, 40_000)
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('explicit local HTTPS hosting', () => {
  it.runIf(process.platform === 'win32').each(['local-interactive', 'local-azure-cli'] as const)('boots %s live hosting without bot/Foundry credentials or any MSX sign-in/read/write', async (authentication) => {
    const reservation = createServer()
    await new Promise<void>((ready) => reservation.listen(0, '127.0.0.1', ready))
    const reserved = reservation.address()
    if (!reserved || typeof reserved === 'string') throw new Error('No test port.')
    const port = reserved.port
    await new Promise<void>((closed, reject) => reservation.close((error) => error ? reject(error) : closed()))
    const ownerDirectory = join(directory, `${authentication}-owner`)
    await prepareOwnerDirectory(ownerDirectory)
    const origin = `https://localhost:${port}`
    let releaseOwner = () => {}
    const gate = new Promise<void>((resolve) => { releaseOwner = resolve })
    const waiting = new Promise<void>((resolve) => {
      ownerStartup.beforeReady.mockImplementationOnce(async () => { resolve(); await gate })
    })
    const startup = startTeamsServer({
      TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: authentication, TLC_TEAMS_RUNTIME_PROFILE: 'local',
      TLC_TEAMS_ORIGIN: origin, TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: String(port),
      TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777',
      ...(authentication === 'local-interactive' ? { TLC_TEAMS_NATIVE_CLIENT_ID: '88888888-8888-4888-8888-888888888888' } : {}),
      TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'offline-native-bootstrap',
      TLC_TEAMS_DATA_DIR: join(ownerDirectory, 'data'), TLC_TEAMS_SAMPLE_PATH: ':memory:',
      TLC_TEAMS_OWNER_DIRECTORY: ownerDirectory, TLC_TEAMS_TLS_CERT_PATH: certificatePath, TLC_TEAMS_TLS_KEY_PATH: keyPath
    })
    try {
      await Promise.race([waiting, startup.then(() => { throw new Error('The startup readiness gate was not reached.') })])
      const ca = await readFile(certificatePath)
      const status = await new Promise<number>((resolve, reject) => {
        const response = get(`https://127.0.0.1:${port}/api/health`, { ca, headers: { host: `localhost:${port}` } }, (incoming) => {
          incoming.resume()
          incoming.once('end', () => resolve(incoming.statusCode ?? 0))
        })
        response.once('error', reject)
      })
      expect(status).toBe(503)
    } catch (error) {
      releaseOwner()
      await (await startup).close()
      throw error
    } finally { releaseOwner() }
    const application = await startup
    try {
      const ca = await readFile(certificatePath)
      const request = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string }>((done, fail) => {
        const response = get(`https://127.0.0.1:${port}${path}`, { ca, headers: { host: `localhost:${port}`, ...headers }, timeout: 5000 }, (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
          incoming.on('end', () => done({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        })
        response.once('error', fail)
        response.once('timeout', () => response.destroy(new Error('Native TLS test timed out.')))
      })
      expect((await request('/api/health')).status).toBe(200)
      expect(JSON.parse((await request('/api/teams/config')).body)).toMatchObject({ mode: 'live', authentication })
      expect((await request('/api/teams/session')).status).toBe(401)
      const teamsNavigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', referer: 'https://teams.microsoft.com/' }
      expect((await request('/', teamsNavigation)).status).toBe(200)
      expect((await request('/api/teams/session', teamsNavigation)).status).toBe(403)
      expect((await request('/', { ...teamsNavigation, origin: 'https://hostile.example.test' })).status).toBe(403)
      const owner = await invokeProtectedOwnerCommand(ownerDirectory, { contractVersion: localConnectionVersion, action: 'status' })
      expect(owner).toMatchObject({ ok: true, status: { state: 'sign-in-required' }, pending: [] })
      expect(nativeClient.interactive).not.toHaveBeenCalled()
      expect(nativeClient.silent).not.toHaveBeenCalled()
      expect(cliCredential.getToken).not.toHaveBeenCalled()
    } finally { await application.close() }
    expect(application.server.listening).toBe(false)
  }, 50_000)
  it.runIf(process.platform === 'win32')('keeps real Sample writes in their own SQLite files across a Live runtime restart without source access', async () => {
    const reservation = createServer()
    await new Promise<void>((ready) => reservation.listen(0, '127.0.0.1', ready))
    const reserved = reservation.address()
    if (!reserved || typeof reserved === 'string') throw new Error('No persistence-test port.')
    const port = reserved.port
    await new Promise<void>((closed, reject) => reservation.close((error) => error ? reject(error) : closed()))
    const ownerDirectory = join(directory, 'sample-first-owner')
    await prepareOwnerDirectory(ownerDirectory)
    const samplePath = join(directory, 'isolated-sample.sqlite')
    const origin = `https://localhost:${port}`
    const environment: NodeJS.ProcessEnv = {
      TLC_TEAMS_MODE: 'live', TLC_TEAMS_INITIAL_MODE: 'sample', TLC_TEAMS_AUTH_MODE: 'local-azure-cli',
      TLC_TEAMS_RUNTIME_PROFILE: 'local', TLC_TEAMS_ORIGIN: origin, TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: String(port),
      TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777',
      TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'offline-sample-first',
      TLC_TEAMS_DATA_DIR: join(ownerDirectory, 'data'), TLC_TEAMS_SAMPLE_PATH: samplePath,
      TLC_TEAMS_OWNER_DIRECTORY: ownerDirectory, TLC_TEAMS_TLS_CERT_PATH: certificatePath, TLC_TEAMS_TLS_KEY_PATH: keyPath
    }
    const ca = await readFile(certificatePath)
    const outbound = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('This Sample test must not access an external source.') })
    const request = (path: string, body?: unknown) => new Promise<{ status: number; body: unknown }>((done, fail) => {
      const response = httpsRequest(`https://127.0.0.1:${port}${path}`, {
        ca, method: body === undefined ? 'GET' : 'POST', timeout: 5000,
        headers: { host: `localhost:${port}`, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => {
          try { done({ status: incoming.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
          catch (error) { fail(error) }
        })
      })
      response.once('error', fail)
      response.once('timeout', () => response.destroy(new Error('Sample persistence HTTPS request timed out.')))
      response.end(body === undefined ? undefined : JSON.stringify(body))
    })
    let opportunityId = ''
    try {
      for (let generation = 0; generation < 2; generation++) {
        const application = await startTeamsServer(environment)
        try {
          expect(await request('/api/teams/modes')).toMatchObject({
            status: 200, body: { initialMode: 'sample', runtimeMode: 'live', availableModes: ['sample', 'live'] }
          })
          expect((await request('/api/teams/live/session')).status).toBe(401)
          expect((await request('/api/teams/sample/session')).body).toMatchObject({ mode: 'sample' })
          if (generation === 0) {
            const accounts = z.array(z.object({ id: z.string() })).parse((await request('/api/teams/sample/operations/listAccounts', {})).body)
            const account = accounts[0]
            if (!account) throw new Error('No canonical Sample account.')
            const opportunities = z.array(z.object({ id: z.string() })).parse((await request('/api/teams/sample/operations/listOpportunities', { accountId: account.id })).body)
            const opportunity = opportunities[0]
            if (!opportunity) throw new Error('No canonical Sample opportunity.')
            opportunityId = opportunity.id
            const preview = actionPreviewSchema.parse((await request('/api/teams/sample/actions/preview', {
              operation: 'updateOpportunity', input: { opportunityId, update: { comments: 'Persistent isolated Sample edit' } }
            })).body)
            expect(await request('/api/teams/sample/actions/commit', {
              contractVersion: '1.0', id: preview.id, digest: preview.digest, reason: 'Explicit local Sample review'
            })).toMatchObject({ status: 200, body: { state: 'confirmed' } })
          }
          expect(await request('/api/teams/sample/operations/getOpportunityContext', { opportunityId })).toMatchObject({
            status: 200, body: { opportunity: { comments: 'Persistent isolated Sample edit' } }
          })
          expect((await invokeProtectedOwnerCommand(ownerDirectory, { contractVersion: localConnectionVersion, action: 'status' })))
            .toMatchObject({ ok: true, status: { state: 'sign-in-required' }, pending: [] })
        } finally { await application.close(); await application.close() }
      }
      for (const path of [samplePath, `${samplePath}.state.sqlite`]) {
        expect((await readFile(path)).subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
      }
      expect(nativeClient.interactive).not.toHaveBeenCalled()
      expect(nativeClient.silent).not.toHaveBeenCalled()
      expect(cliCredential.getToken).not.toHaveBeenCalled()
      expect(outbound).not.toHaveBeenCalled()
    } finally { outbound.mockRestore() }
  }, 50_000)
  it('requires a complete certificate/key pair and an HTTPS configured origin', () => {
    expect(loadTeamsTlsConfiguration({}, 'http://127.0.0.1:3978')).toBeUndefined()
    expect(() => loadTeamsTlsConfiguration({ TLC_TEAMS_TLS_CERT_PATH: certificatePath }, 'https://localhost:3978')).toThrow(/certificate.*key/i)
    expect(() => loadTeamsTlsConfiguration({ TLC_TEAMS_TLS_KEY_PATH: keyPath }, 'https://localhost:3978')).toThrow(/certificate.*key/i)
    expect(() => loadTeamsTlsConfiguration({ TLC_TEAMS_TLS_CERT_PATH: certificatePath, TLC_TEAMS_TLS_KEY_PATH: keyPath }, 'http://127.0.0.1:3978')).toThrow(/HTTPS/)
  })
  it('serves the actual protected host over TLS without disabling certificate verification or modifying system trust', async () => {
    const application = await startTeamsServer({
      TLC_TEAMS_MODE: 'sample', TLC_TEAMS_RUNTIME_PROFILE: 'local',
      TLC_TEAMS_ORIGIN: 'https://localhost:3978', TLC_TEAMS_HOST: '127.0.0.1', TLC_TEAMS_PORT: '0',
      TLC_TEAMS_STATE_PATH: ':memory:', TLC_TEAMS_SAMPLE_PATH: ':memory:',
      TLC_TEAMS_TLS_CERT_PATH: certificatePath, TLC_TEAMS_TLS_KEY_PATH: keyPath
    })
    try {
      const address = application.server.address()
      if (!address || typeof address === 'string') throw new Error('No HTTPS test listener.')
      const url = `https://127.0.0.1:${address.port}/api/health`
      const request = (ca?: Buffer) => new Promise<{ status: number; body: string; csp: string }>((resolve, reject) => {
        const response = get(url, { ...(ca ? { ca } : {}), timeout: 5_000 }, (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
          incoming.on('end', () => resolve({
            status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'),
            csp: String(incoming.headers['content-security-policy'] ?? '')
          }))
        })
        response.once('error', reject)
        response.once('timeout', () => response.destroy(new Error('HTTPS test timed out.')))
      })
      await expect(request()).rejects.toThrow(/self-signed|certificate/i)
      const response = await request(await readFile(certificatePath))
      expect(response.status).toBe(200)
      expect(response.csp).toContain('https://res.cdn.office.net/teams-js/validDomains/json/validDomains.json')
      expect(JSON.parse(response.body)).toMatchObject({ status: 'ready', surface: 'teams', mode: 'sample' })
    } finally { await application.close() }
  })
})
