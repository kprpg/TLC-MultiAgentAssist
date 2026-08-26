import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

const appRegistrationSchema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
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
    scopes: resourceScopesSchema,
    appRegistration: appRegistrationSchema.optional()
  }).strict(),
  z.object({
    mode: z.literal('interactive-browser'),
    expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
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
    projectEndpoint: z.string().url(),
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
  return resolve(workingDirectory, configuredPath || 'config/foundry.environment.json')
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