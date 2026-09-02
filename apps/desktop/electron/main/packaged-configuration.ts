import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveFoundryEnvironmentPath } from '../../../../packages/common/configuration/foundry-environment.js'

interface PackagedConfigurationOptions {
  environment?: NodeJS.ProcessEnv
  workingDirectory?: string
  isPackaged: boolean
  userDataPath: string
  templatePath: string
}

export interface PreparedFoundryEnvironment {
  filePath: string
  created: boolean
}

export async function prepareFoundryEnvironmentFile(
  options: PackagedConfigurationOptions
): Promise<PreparedFoundryEnvironment> {
  const environment = options.environment ?? process.env
  const workingDirectory = options.workingDirectory ?? process.cwd()
  const configuredPath = environment['TLC_FOUNDRY_ENV_FILE']?.trim()

  if (!options.isPackaged || configuredPath) {
    return {
      filePath: resolveFoundryEnvironmentPath(environment, workingDirectory),
      created: false
    }
  }

  const filePath = join(options.userDataPath, 'foundry.environment.json')
  try {
    await stat(filePath)
    return { filePath, created: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dirname(filePath), { recursive: true })
  await copyFile(options.templatePath, filePath)
  return { filePath, created: true }
}