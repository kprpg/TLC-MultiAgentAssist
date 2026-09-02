import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
      created: true
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
    await expect(readFile(second.filePath, 'utf8')).resolves.toBe('{"environment":"customized"}')
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
    })).resolves.toEqual({ filePath: configuredPath, created: false })
  })
})