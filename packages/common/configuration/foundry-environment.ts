import { readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { z } from 'zod'

const windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/

const templatePlaceholderIds = new Set([
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
])

const configuredUuidSchema = z.string().uuid().refine(
  (value) => !templatePlaceholderIds.has(value),
  'Replace the template UUID with the Azure resource value.'
)

const appRegistrationSchema = z.object({
  tenantId: configuredUuidSchema,
  clientId: configuredUuidSchema,
  redirectUri: z.string().url()
}).strict()

const resourceScopesSchema = z.object({
  foundry: z.array(z.string().min(1)).min(1),
  msx: z.array(z.string().min(1)).min(1),
  graph: z.array(z.string().min(1)).min(1)
}).strict()

const authenticationSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('azure-cli'),
    expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
    foundryTenantId: configuredUuidSchema,
    scopes: resourceScopesSchema,
    appRegistration: appRegistrationSchema.optional()
  }).strict(),
  z.object({
    mode: z.literal('interactive-browser'),
    expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
    foundryTenantId: configuredUuidSchema,
    scopes: resourceScopesSchema,
    appRegistration: appRegistrationSchema
  }).strict()
])

const foundryAgentSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['prompt', 'hosted']),
  protocol: z.enum(['responses', 'invocations'])
}).strict()

export const foundryEnvironmentSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  authentication: authenticationSchema,
  foundry: z.object({
    projectEndpoint: z.string().url().refine(
      (value) => !value.includes('YOUR-FOUNDRY-ACCOUNT') && !value.includes('/YOUR-PROJECT'),
      'Replace the template endpoint with the Microsoft Foundry project endpoint.'
    ),
    requestTimeoutMs: z.number().int().min(1_000).max(300_000),
    agents: z.object({
      mcemCoach: foundryAgentSchema,
      riskSolutionPlay: foundryAgentSchema,
      pursuitExecutive: foundryAgentSchema,
      accountPulse: foundryAgentSchema
    }).strict()
  }).strict()
}).strict()

export type FoundryEnvironment = z.infer<typeof foundryEnvironmentSchema>

export function resolveFoundryEnvironmentPath(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd()
): string {
  const configuredPath = environment['TLC_FOUNDRY_ENV_FILE']?.trim()
  const relativePath = configuredPath || 'config/foundry.environment.json'
  const path = windowsAbsolutePathPattern.test(workingDirectory) ? win32 : posix
  return path.resolve(workingDirectory, relativePath)
}

export async function loadFoundryEnvironment(filePath: string): Promise<FoundryEnvironment> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (cause) {
    throw new Error(`Unable to read Foundry environment file: ${filePath}`, { cause })
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(content)
  } catch (cause) {
    throw new Error(`Foundry environment file is not valid JSON: ${filePath}`, { cause })
  }

  return foundryEnvironmentSchema.parse(candidate)
}