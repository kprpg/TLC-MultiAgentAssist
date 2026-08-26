import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  foundryEnvironmentSchema,
  loadFoundryEnvironment,
  resolveFoundryEnvironmentPath
} from '../../../packages/common/configuration/foundry-environment.js'

const temporaryDirectories: string[] = []

const validEnvironment = {
  schemaVersion: 1,
  environment: 'developer',
  authentication: {
    mode: 'interactive-browser',
    expectedUserDomain: '@microsoft.com',
    appRegistration: {
      tenantId: '11111111-1111-4111-8111-111111111111',
      clientId: '22222222-2222-4222-8222-222222222222',
      redirectUri: 'http://localhost'
    },
    scopes: {
      foundry: ['https://ai.azure.com/.default'],
      msx: ['https://microsoftsales.crm.dynamics.com/.default'],
      graph: ['https://graph.microsoft.com/.default']
    }
  },
  foundry: {
    projectEndpoint: 'https://example.services.ai.azure.com/api/projects/tlc',
    requestTimeoutMs: 60_000,
    agents: {
      mcemCoach: { name: 'tlc-mcem-coach', type: 'hosted', protocol: 'responses' },
      riskSolutionPlay: { name: 'tlc-risk-solution-play', type: 'hosted', protocol: 'responses' },
      pursuitExecutive: { name: 'tlc-pursuit-executive', type: 'hosted', protocol: 'responses' },
      accountPulse: { name: 'tlc-account-pulse', type: 'hosted', protocol: 'responses' }
    }
  }
} as const

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Foundry environment configuration', () => {
  it('loads developer-specific Foundry and app registration settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-foundry-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'foundry.environment.json')
    await writeFile(filePath, JSON.stringify(validEnvironment), 'utf8')

    await expect(loadFoundryEnvironment(filePath)).resolves.toEqual(validEnvironment)
  })

  it('requires app registration details for interactive browser authentication', () => {
    const invalidEnvironment = structuredClone(validEnvironment) as Record<string, unknown>
    const authentication = invalidEnvironment['authentication'] as Record<string, unknown>
    delete authentication['appRegistration']

    expect(foundryEnvironmentSchema.safeParse(invalidEnvironment).success).toBe(false)
  })

  it('rejects secrets and undeclared connectivity settings', () => {
    const invalidEnvironment = structuredClone(validEnvironment) as Record<string, unknown>
    const authentication = invalidEnvironment['authentication'] as Record<string, unknown>
    authentication['clientSecret'] = 'must-not-be-stored-here'

    expect(foundryEnvironmentSchema.safeParse(invalidEnvironment).success).toBe(false)
  })

  it('uses an override path without hard-coding a developer environment', () => {
    const path = resolveFoundryEnvironmentPath(
      { TLC_FOUNDRY_ENV_FILE: 'environments/alice.json' },
      'C:\\repo'
    )

    expect(path).toBe('C:\\repo\\environments\\alice.json')
  })
})