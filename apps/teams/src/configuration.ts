import { z } from 'zod'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { configuredUuidSchema } from '../../../packages/common/configuration/foundry-environment.js'
import { cliWriteModeSchema } from '../../../packages/common/contracts/local-connection.js'

const httpsOrigin = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && value === url.origin
}, 'An exact HTTPS origin is required.')
const liveSchema = z.object({
  mode: z.literal('live'),
  origin: httpsOrigin,
  tenantId: z.uuid(),
  apiClientId: z.uuid(),
  spaClientId: z.uuid(),
  botClientId: z.uuid(),
  apiCredential: z.string().min(1),
  botCredential: z.string().min(1),
  msxResource: httpsOrigin.refine((value) => /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i.test(new URL(value).hostname)),
  mcpScope: z.url().refine((value) => value.startsWith('https://') && value.endsWith('/mcp.tools')),
  storageUrl: httpsOrigin.refine((value) => /^[a-z0-9]+\.table\.core\.windows\.net$/.test(new URL(value).hostname)).optional(),
  environmentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)
}).strict().superRefine((value, context) => {
  if (new URL(value.mcpScope).origin !== value.msxResource) {
    context.addIssue({ code: 'custom', path: ['mcpScope'], message: 'MCP authorization must target the configured MSX environment.' })
  }
})

const nativeSchema = z.object({
  mode: z.literal('live'),
  authentication: z.literal('local-interactive'),
  origin: httpsOrigin.refine((value) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)),
  tenantId: configuredUuidSchema.transform((value) => value.toLowerCase()),
  nativeClientId: configuredUuidSchema.transform((value) => value.toLowerCase()),
  nativeRedirectUri: z.url().refine((value) => {
    const uri = new URL(value)
    return uri.protocol === 'http:' && uri.hostname === 'localhost' && uri.pathname === '/' && !uri.username && !uri.password && !uri.search && !uri.hash
  }),
  msxResource: httpsOrigin.refine((value) => /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i.test(new URL(value).hostname)),
  mcpScope: z.url(),
  graphScopes: z.array(z.enum(['https://graph.microsoft.com/OnlineMeetings.Read', 'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All'])),
  guidanceMode: z.enum(['deterministic', 'foundry']),
  environmentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)
}).strict().superRefine((value, context) => {
  if (value.mcpScope !== `${value.msxResource}/mcp.tools`) context.addIssue({ code: 'custom', path: ['mcpScope'], message: 'Native MCP scope must match the configured MSX environment.' })
})
export type TeamsLiveConfiguration = z.infer<typeof liveSchema>
export type NativeTeamsConfiguration = z.infer<typeof nativeSchema>
const cliSchema = z.object({
  ...nativeSchema.shape,
  authentication: z.literal('local-azure-cli'),
  writeMode: cliWriteModeSchema,
  graphScopes: z.array(z.never()),
  guidanceMode: z.literal('deterministic')
}).omit({ nativeClientId: true, nativeRedirectUri: true }).strict().superRefine((value, context) => {
  if (value.mcpScope !== `${value.msxResource}/mcp.tools`) context.addIssue({ code: 'custom', path: ['mcpScope'], message: 'Local source scope must match the configured MSX environment.' })
})
export type CliTeamsConfiguration = z.infer<typeof cliSchema>
export type LocalTeamsConfiguration = NativeTeamsConfiguration | CliTeamsConfiguration
export type TeamsConfiguration = TeamsLiveConfiguration | LocalTeamsConfiguration | { mode: 'sample'; origin: string; environmentId: string }
export function isNativeConfiguration(value: TeamsConfiguration): value is NativeTeamsConfiguration {
  return value.mode === 'live' && 'authentication' in value && value.authentication === 'local-interactive'
}
export function isCliConfiguration(value: TeamsConfiguration): value is CliTeamsConfiguration {
  return value.mode === 'live' && 'authentication' in value && value.authentication === 'local-azure-cli'
}
export function isLocalConfiguration(value: TeamsConfiguration): value is LocalTeamsConfiguration {
  return isNativeConfiguration(value) || isCliConfiguration(value)
}

export interface TeamsRuntimeConfiguration {
  profile: 'local' | 'azure'
  state: { kind: 'sqlite'; path: string } | { kind: 'table'; url: string }
  samplePath: string
}

export function loadTeamsRuntimeConfiguration(environment: NodeJS.ProcessEnv, configuration: TeamsConfiguration): TeamsRuntimeConfiguration {
  const profile = z.enum(['local', 'azure']).parse(environment['TLC_TEAMS_RUNTIME_PROFILE'] ?? (environment['WEBSITE_SITE_NAME'] ? 'azure' : 'local'))
  const root = resolve(environment['TLC_TEAMS_DATA_DIR'] ?? join(environment['LOCALAPPDATA'] ?? homedir(), 'TLC-Assist', 'Teams', configuration.mode))
  const dataDirectory = configuration.mode === 'live' ? join(root, configuration.tenantId, configuration.environmentId) : root
  const samplePath = environment['TLC_TEAMS_SAMPLE_PATH'] ?? join(dataDirectory, 'sample.sqlite')
  if (configuration.mode === 'live' && profile === 'azure') {
    if (isLocalConfiguration(configuration)) throw new Error('Local owner authentication cannot run in an Azure host.')
    if (!configuration.storageUrl) throw new Error('The Azure runtime profile requires configured Table Storage.')
    return { profile, state: { kind: 'table', url: configuration.storageUrl }, samplePath }
  }
  const configuredPath = environment['TLC_TEAMS_STATE_PATH'] ?? join(dataDirectory, 'collaboration.sqlite')
  if (configuration.mode === 'live' && configuredPath === ':memory:') throw new Error('Live laptop state must use a durable SQLite file.')
  const path = configuredPath === ':memory:' ? configuredPath : resolve(configuredPath)
  const resolvedSamplePath = samplePath === ':memory:' ? samplePath : resolve(samplePath)
  if (path !== ':memory:' && path === resolvedSamplePath) throw new Error('Collaboration state and sample data require distinct files.')
  return { profile, state: { kind: 'sqlite', path }, samplePath: resolvedSamplePath }
}

export function loadTeamsStateKey(environment: NodeJS.ProcessEnv): Buffer {
  const encoded = environment['TLC_TEAMS_STATE_KEY'] ?? ''
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Live Teams state requires a securely provisioned 32-byte Base64 encryption key.')
  return key
}

export function loadTeamsTlsConfiguration(environment: NodeJS.ProcessEnv, origin: string): { certificatePath: string; keyPath: string } | undefined {
  const certificate = environment['TLC_TEAMS_TLS_CERT_PATH']
  const key = environment['TLC_TEAMS_TLS_KEY_PATH']
  if (!certificate && !key) return undefined
  if (!certificate || !key) throw new Error('Local HTTPS requires both a certificate path and a private key path.')
  if (new URL(origin).protocol !== 'https:') throw new Error('A local TLS listener requires an HTTPS configured origin.')
  return { certificatePath: resolve(certificate), keyPath: resolve(key) }
}

export function loadTeamsAdmission(environment: NodeJS.ProcessEnv): boolean {
  return z.enum(['enabled', 'read-only']).parse(environment['TLC_TEAMS_ADMISSION'] ?? 'enabled') === 'enabled'
}

export function loadTeamsConfiguration(environment: NodeJS.ProcessEnv): TeamsConfiguration {
  const hosted = environment['WEBSITE_SITE_NAME'] || environment['TLC_TEAMS_RUNTIME_PROFILE'] === 'azure'
  const mode = environment['TLC_TEAMS_MODE'] ?? (hosted ? undefined : 'sample')
  const authMode = environment['TLC_TEAMS_AUTH_MODE'] ?? 'hosted-obo'
  if (!['hosted-obo', 'local-interactive', 'local-azure-cli'].includes(authMode)) throw new Error('TLC_TEAMS_AUTH_MODE is invalid.')
  if (authMode === 'local-interactive' || authMode === 'local-azure-cli') {
    if (mode !== 'live' || hosted || environment['TLC_TEAMS_HOST'] && !['localhost', '127.0.0.1', '::1'].includes(environment['TLC_TEAMS_HOST'])) {
      throw new Error('Native authentication requires explicit live mode on a loopback-only local runtime.')
    }
    const msxResource = environment['TLC_TEAMS_MSX_RESOURCE']
    const local = {
      mode, authentication: authMode, origin: environment['TLC_TEAMS_ORIGIN'],
      tenantId: environment['TLC_TEAMS_TENANT_ID'],
      msxResource, mcpScope: environment['TLC_TEAMS_MCP_SCOPE'] ?? `${msxResource}/mcp.tools`,
      graphScopes: environment['TLC_TEAMS_GRAPH_SCOPES']?.split(/\s+/).filter(Boolean) ?? [],
      guidanceMode: environment['TLC_TEAMS_GUIDANCE_MODE'] ?? 'deterministic',
      environmentId: environment['TLC_TEAMS_ENVIRONMENT_ID']
    }
    return authMode === 'local-azure-cli' ? cliSchema.parse({
      ...local, writeMode: environment['TLC_TEAMS_CLI_WRITE_MODE'] ?? 'read-only'
    }) : nativeSchema.parse({
      ...local, nativeClientId: environment['TLC_TEAMS_NATIVE_CLIENT_ID'],
      nativeRedirectUri: environment['TLC_TEAMS_NATIVE_REDIRECT_URI'] ?? 'http://localhost'
    })
  }
  if (mode === 'sample') {
    const origin = environment['TLC_TEAMS_ORIGIN'] ?? 'http://127.0.0.1:3978'
    const url = new URL(origin)
    if (url.origin !== origin || (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'https:')) {
      throw new Error('Sample mode requires a loopback or exact HTTPS origin.')
    }
    return { mode, origin, environmentId: 'sample' }
  }
  if (mode !== 'live') throw new Error('TLC_TEAMS_MODE must explicitly select sample or live in hosted environments.')
  return liveSchema.parse({
    mode,
    origin: environment['TLC_TEAMS_ORIGIN'],
    tenantId: environment['TLC_TEAMS_TENANT_ID'],
    apiClientId: environment['TLC_TEAMS_API_CLIENT_ID'],
    spaClientId: environment['TLC_TEAMS_SPA_CLIENT_ID'],
    botClientId: environment['TLC_TEAMS_BOT_CLIENT_ID'],
    apiCredential: environment['TLC_TEAMS_API_CREDENTIAL'],
    botCredential: environment['TLC_TEAMS_BOT_CREDENTIAL'],
    msxResource: environment['TLC_TEAMS_MSX_RESOURCE'],
    mcpScope: environment['TLC_TEAMS_MCP_SCOPE'],
    storageUrl: environment['TLC_TEAMS_STORAGE_URL'],
    environmentId: environment['TLC_TEAMS_ENVIRONMENT_ID']
  })
}
