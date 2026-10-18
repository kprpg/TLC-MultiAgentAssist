import { z } from 'zod'

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
  storageUrl: httpsOrigin.refine((value) => /^[a-z0-9]+\.table\.core\.windows\.net$/.test(new URL(value).hostname)),
  environmentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)
}).strict().superRefine((value, context) => {
  if (new URL(value.mcpScope).origin !== value.msxResource) {
    context.addIssue({ code: 'custom', path: ['mcpScope'], message: 'MCP authorization must target the configured MSX environment.' })
  }
})

export type TeamsLiveConfiguration = z.infer<typeof liveSchema>
export type TeamsConfiguration = TeamsLiveConfiguration | { mode: 'sample'; origin: string; environmentId: string }

export function loadTeamsAdmission(environment: NodeJS.ProcessEnv): boolean {
  return z.enum(['enabled', 'read-only']).parse(environment['TLC_TEAMS_ADMISSION'] ?? 'enabled') === 'enabled'
}

export function loadTeamsConfiguration(environment: NodeJS.ProcessEnv): TeamsConfiguration {
  const mode = environment['TLC_TEAMS_MODE'] ?? (environment['WEBSITE_SITE_NAME'] ? undefined : 'sample')
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
