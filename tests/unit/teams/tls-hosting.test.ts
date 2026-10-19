import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadTeamsTlsConfiguration } from '../../../apps/teams/src/configuration.js'
import { startTeamsServer } from '../../../apps/teams/src/server.js'

const execute = promisify(execFile)
let directory: string
let certificatePath: string
let keyPath: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tlc-teams-test-tls-'))
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
      const request = (ca?: Buffer) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const response = get(url, { ...(ca ? { ca } : {}), timeout: 5_000 }, (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        })
        response.once('error', reject)
        response.once('timeout', () => response.destroy(new Error('HTTPS test timed out.')))
      })
      await expect(request()).rejects.toThrow(/self-signed|certificate/i)
      const response = await request(await readFile(certificatePath))
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toMatchObject({ status: 'ready', surface: 'teams', mode: 'sample' })
    } finally { await application.close() }
  })
})
