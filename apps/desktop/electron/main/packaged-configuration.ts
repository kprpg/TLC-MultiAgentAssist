import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  foundryEnvironmentSchema,
  resolveFoundryEnvironmentPath,
  type FoundryEnvironment
} from '../../../../packages/common/configuration/foundry-environment.js'

interface PackagedConfigurationOptions {
  environment?: NodeJS.ProcessEnv
  workingDirectory?: string
  isPackaged: boolean
  userDataPath: string
  templatePath: string
  requiresConfigurationOnCreate?: boolean
}

export interface PreparedFoundryEnvironment {
  filePath: string
  created: boolean
  requiresConfiguration: boolean
}

function sameConfiguration(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isLegacyBundledConfiguration(
  existing: FoundryEnvironment,
  template: FoundryEnvironment
): boolean {
  return existing.environment === 'shared'
    && existing.environment === template.environment
    && existing.authentication.mode === 'azure-cli'
    && existing.authentication.appRegistration === undefined
    && template.authentication.mode === 'interactive-browser'
    && existing.authentication.expectedUserDomain === template.authentication.expectedUserDomain
    && existing.authentication.foundryTenantId === template.authentication.foundryTenantId
    && sameConfiguration(existing.authentication.scopes, template.authentication.scopes)
    && sameConfiguration(existing.foundry, template.foundry)
}

async function migrateLegacyBundledConfiguration(filePath: string, templatePath: string): Promise<void> {
  let existingCandidate: unknown
  let templateCandidate: unknown
  try {
    existingCandidate = JSON.parse(await readFile(filePath, 'utf8'))
    templateCandidate = JSON.parse(await readFile(templatePath, 'utf8'))
  } catch {
    return
  }

  const existing = foundryEnvironmentSchema.safeParse(existingCandidate)
  const template = foundryEnvironmentSchema.safeParse(templateCandidate)
  if (!existing.success || !template.success || !isLegacyBundledConfiguration(existing.data, template.data)) return

  await writeFile(filePath, `${JSON.stringify({
    ...existing.data,
    authentication: template.data.authentication
  }, null, 2)}\n`, 'utf8')
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
      created: false,
      requiresConfiguration: false
    }
  }

  const filePath = join(options.userDataPath, 'foundry.environment.json')
  try {
    await stat(filePath)
    await migrateLegacyBundledConfiguration(filePath, options.templatePath)
    return { filePath, created: false, requiresConfiguration: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dirname(filePath), { recursive: true })
  await copyFile(options.templatePath, filePath)
  return {
    filePath,
    created: true,
    requiresConfiguration: options.requiresConfigurationOnCreate ?? true
  }
}