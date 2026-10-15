import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareFoundryEnvironmentFile } from '../../../apps/desktop/electron/main/packaged-configuration.js'

describe('prepareFoundryEnvironmentFile', () => {
  it('seeds a packaged app configuration in the user data directory once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-config-'))
    const templatePath = join(root, 'template.json')
    const userDataPath = join(root, 'user-data')
    await writeFile(templatePath, '{"environment":"template"}', 'utf8')

    const first = await prepareFoundryEnvironmentFile({
      environment: {},
      isPackaged: true,
      userDataPath,
      templatePath
    })
    expect(first).toEqual({
      filePath: join(userDataPath, 'foundry.environment.json'),
      created: true,
      requiresConfiguration: true
    })
    await expect(readFile(first.filePath, 'utf8')).resolves.toBe('{"environment":"template"}')

    await writeFile(first.filePath, '{"environment":"customized"}', 'utf8')
    const second = await prepareFoundryEnvironmentFile({
      environment: {},
      isPackaged: true,
      userDataPath,
      templatePath
    })
    expect(second.created).toBe(false)
    expect(second.requiresConfiguration).toBe(false)
    await expect(readFile(second.filePath, 'utf8')).resolves.toBe('{"environment":"customized"}')
  })

  it('seeds a usable product default without requiring first-launch configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-config-'))
    const templatePath = join(root, 'default.json')
    const userDataPath = join(root, 'user-data')
    await writeFile(templatePath, '{"environment":"production"}', 'utf8')

    const prepared = await prepareFoundryEnvironmentFile({
      environment: {},
      isPackaged: true,
      userDataPath,
      templatePath,
      requiresConfigurationOnCreate: false
    })

    expect(prepared).toEqual({
      filePath: join(userDataPath, 'foundry.environment.json'),
      created: true,
      requiresConfiguration: false
    })
    await expect(readFile(prepared.filePath, 'utf8')).resolves.toBe('{"environment":"production"}')
  })

  it('preserves an explicit environment file override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-config-'))
    const configuredPath = join(root, 'custom.json')

    await expect(prepareFoundryEnvironmentFile({
      environment: { TLC_FOUNDRY_ENV_FILE: configuredPath },
      workingDirectory: root,
      isPackaged: true,
      userDataPath: join(root, 'user-data'),
      templatePath: join(root, 'template.json')
    })).resolves.toEqual({ filePath: configuredPath, created: false, requiresConfiguration: false })
  })

  it('migrates the untouched packaged Azure CLI default to interactive browser authentication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tlc-config-'))
    const templatePath = join(root, 'default.json')
    const userDataPath = join(root, 'user-data')
    const filePath = join(userDataPath, 'foundry.environment.json')
    const foundry = {
      projectEndpoint: 'https://example.services.ai.azure.com/api/projects/tlc',
      requestTimeoutMs: 60_000,
      agents: {
        mcemCoach: { name: 'tlc-mcem-coach', type: 'prompt', protocol: 'responses' },
        riskSolutionPlay: { name: 'tlc-risk-solution-play', type: 'prompt', protocol: 'responses' },
        pursuitExecutive: { name: 'tlc-pursuit-executive', type: 'prompt', protocol: 'responses' },
        accountPulse: { name: 'tlc-account-pulse', type: 'prompt', protocol: 'responses' }
      }
    }
    const scopes = {
      foundry: ['https://ai.azure.com/.default'],
      msx: ['https://microsoftsales.crm.dynamics.com/.default'],
      graph: ['https://graph.microsoft.com/.default']
    }
    const legacy = {
      schemaVersion: 1,
      environment: 'shared',
      authentication: {
        mode: 'azure-cli',
        expectedUserDomain: '@microsoft.com',
        foundryTenantId: '173eb3fc-9ba1-437f-99a1-89d5e53b91d1',
        scopes
      },
      foundry
    }
    const template = {
      ...legacy,
      authentication: {
        ...legacy.authentication,
        mode: 'interactive-browser',
        appRegistration: {
          tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
          clientId: 'd4a694ba-9ed0-4467-9c06-f7dfe41ceb8c',
          redirectUri: 'http://localhost'
        }
      }
    }
    await mkdir(userDataPath, { recursive: true })
    await writeFile(filePath, JSON.stringify(legacy), 'utf8')
    await writeFile(templatePath, JSON.stringify(template), 'utf8')

    const prepared = await prepareFoundryEnvironmentFile({
      environment: {},
      isPackaged: true,
      userDataPath,
      templatePath
    })

    expect(prepared.created).toBe(false)
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"mode": "interactive-browser"')
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"clientId": "d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c"')
  })
})