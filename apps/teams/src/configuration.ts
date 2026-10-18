import { z } from 'zod'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

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

export type TeamsLiveConfiguration = z.infer<typeof liveSchema>
export type TeamsConfiguration = TeamsLiveConfiguration | { mode: 'sample'; origin: string; environmentId: string }

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
