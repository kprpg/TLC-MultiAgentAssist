import { createCanvas } from '@napi-rs/canvas'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import JSZip from 'jszip'
import Ajv from 'ajv-draft-04'
import addFormats from 'ajv-formats'
import { z } from 'zod'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const teamsManifestSchemaUrl = 'https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json'
const nativeLoopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const localAuthenticationModes = new Set(['local-interactive', 'local-azure-cli'])
const optionsSchema = z.object({
  mode: z.enum(['sample', 'live']),
  origin: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && value === url.origin && !url.username && !url.password
  }, 'An exact reachable HTTPS origin is required.'),
  appId: z.uuid(),
  authentication: z.enum(['hosted-obo', 'local-interactive', 'local-azure-cli']).default('hosted-obo'),
  botId: z.uuid().optional()
}).strict().superRefine((value, context) => {
  if (localAuthenticationModes.has(value.authentication)) {
    if (value.mode !== 'live' || !nativeLoopbackHosts.has(new URL(value.origin).hostname) || value.botId) {
      context.addIssue({ code: 'custom', message: 'Native packaging requires explicit local live mode with no cloud bot identity.' })
    }
  } else if (value.mode === 'live' && !value.botId) context.addIssue({ code: 'custom', path: ['botId'], message: 'The approved bot identity is required for the live suite.' })
})

export function createTeamsManifest(options) {
  const parsed = optionsSchema.parse(options)
  const origin = parsed.origin
  const local = localAuthenticationModes.has(parsed.authentication)
  const full = parsed.mode === 'live' && !local
  return {
    $schema: teamsManifestSchemaUrl,
    manifestVersion: '1.30',
    version: '0.1.3',
    id: parsed.appId,
    developer: {
      name: 'TLC Assist', websiteUrl: `${origin}/`,
      privacyUrl: `${origin}/privacy`, termsOfUseUrl: `${origin}/terms`
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    name: {
      short: local ? 'TLC Assist Local' : full ? 'TLC Assist' : 'TLC Assist Sample',
      full: local ? 'TLC Assist - private local MSX workspace' : full ? 'TLC Account Team Assist for Teams' : 'TLC Assist - sanitized sample workspace'
    },
    description: {
      short: local ? 'Private live MSX on your device. Local sign-in and owner pairing required.' : full ? 'Grounded account-team guidance with delegated access and reviewed changes.' : 'Sanitized TLC account-team workspace. No live business data.',
      full: local
        ? 'Every user operates their own private localhost HTTPS runtime and explicitly pairs this page through the protected owner command. The Azure CLI profile uses the current user for read-only MSX and deal-team Portfolio access; no FTE or writer role is inferred. The separate native profile requires approved identity, eligibility and resource grants. Shared channel state, cloud bots, cross-device publication and earnings-profile access are not enabled. Uploading this package does not start the backend or grant source access.'
        : 'TLC Assist joins authorized account-team information with shared workflows and grounded guidance. Source-system rights, Microsoft FTE eligibility and reviewed-action controls apply independently. Run the user-operated web service locally for development/test or deploy the same runtime later. The app requires a reachable HTTPS origin; uploading the ZIP neither starts the server nor deploys a backend.'
    },
    accentColor: '#5B5FC7',
    ...(!local ? { supportsChannelFeatures: 'tier1' } : {}),
    staticTabs: [{
      entityId: 'tlc-personal', name: 'My work', scopes: ['personal'],
      contentUrl: `${origin}/`, websiteUrl: `${origin}/`
    }],
    ...(!local ? { configurableTabs: [{
      configurationUrl: `${origin}/?surface=configure`,
      canUpdateConfiguration: true, scopes: ['team', 'groupChat'],
      context: ['channelTab', 'privateChatTab', 'meetingChatTab', 'meetingDetailsTab', 'meetingSidePanel', 'meetingStage']
    }] } : {}),
    validDomains: [new URL(origin).hostname],
    ...(!local ? { authorization: { permissions: { resourceSpecific: [
      ...(full ? [
        { name: 'ChannelMember.Read.Group', type: 'Application' },
        { name: 'ChatMember.Read.Chat', type: 'Application' }
      ] : []),
      { name: 'MeetingStage.Write.Chat', type: 'Delegated' }
    ] } } } : {}),
    ...(full ? {
      bots: [{ botId: parsed.botId, scopes: ['personal', 'team', 'groupChat'], isNotificationOnly: false, supportsFiles: false }],
      composeExtensions: [{
        botId: parsed.botId,
        commands: [{
          id: 'searchAccounts', type: 'query', title: 'Find TLC account', description: 'Find an accessible account and insert a private authenticated reference.',
          context: ['compose', 'commandBox'], parameters: [{ name: 'search', title: 'Customer name', description: 'Enter at least two characters.' }]
        }]
      }],
      webApplicationInfo: { id: parsed.botId, resource: `api://botid-${parsed.botId}` }
    } : {})
  }
}

export function validateTeamsManifestCapabilities(manifest) {
  const [major = 0, minor = 0] = manifest.manifestVersion.split('.').map(Number)
  const modernChannels = major > 1 || major === 1 && minor >= 25
  const tabs = [...(manifest.staticTabs ?? []), ...(manifest.configurableTabs ?? [])]
  const teamScope = [...tabs, ...(manifest.bots ?? [])].some((capability) => capability.scopes?.includes('team'))
  if (modernChannels && Object.hasOwn(manifest, 'supportedChannelTypes')) {
    throw new Error('Teams manifest v1.25+ must use supportsChannelFeatures instead of supportedChannelTypes.')
  }
  if (modernChannels && teamScope && manifest.supportsChannelFeatures !== 'tier1') {
    throw new Error('Teams manifest v1.25+ with team scope requires supportsChannelFeatures: "tier1".')
  }
  if (tabs.some((tab) => tab.context?.includes('meetingStage'))
    && !manifest.authorization?.permissions?.resourceSpecific?.some((permission) => permission.name === 'MeetingStage.Write.Chat' && permission.type === 'Delegated')) {
    throw new Error('Teams meetingStage requires authorization.permissions.resourceSpecific with MeetingStage.Write.Chat and type Delegated.')
  }
  return true
}

export function classifyPackageOrigin(origin) {
  const url = new URL(origin)
  const hostname = url.hostname.toLowerCase()
  return {
    developmentOnly: ['localhost', '[::1]', '0.0.0.0'].includes(hostname) || /^127\./.test(hostname)
      || /(^|\.)(example\.(com|net|org)|example|test|invalid)$/.test(hostname)
  }
}

async function smallBody(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > 64_000) { await reader.cancel(); throw new Error('The public hosting probe response exceeded its size limit.') }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function verifyTeamsOrigin(origin, mode, fetcher = fetch, authentication = 'hosted-obo') {
  z.enum(['hosted-obo', 'local-interactive', 'local-azure-cli']).parse(authentication)
  const local = localAuthenticationModes.has(authentication)
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || local && (mode !== 'live' || !nativeLoopbackHosts.has(url.hostname)) ||
      !local && classifyPackageOrigin(origin).developmentOnly) {
    throw new Error('A reachable configured HTTPS origin is required; development/template origins are not installed-host readiness.')
  }
  const get = (path) => fetcher(`${origin}${path}`, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000) })
  const health = await get('/api/health')
  if (!health.ok) throw new Error('The configured Teams API health endpoint is not reachable.')
  const status = z.object({ status: z.literal('ready'), surface: z.literal('teams'), mode: z.enum(['sample', 'live']) }).safeParse(JSON.parse(await smallBody(health)))
  if (!status.success || status.data.mode !== mode) throw new Error('The configured host is not the expected Teams runtime/data mode.')
  const ui = await get('/')
  if (!ui.ok || !ui.headers.get('content-type')?.includes('text/html') || !(await smallBody(ui)).includes('TLC Assist for Teams')) {
    throw new Error('The configured Teams UI is not reachable at the selected origin.')
  }
  const session = await get('/api/teams/session')
  if (mode === 'live' && session.status !== 401) throw new Error('The live Teams host must reject unauthenticated application sessions.')
  if (mode === 'sample' && !session.ok) throw new Error('The configured sample host is unavailable.')
  if (local) {
    const config = await get('/api/teams/config')
    if (!config.ok || !z.object({
      contractVersion: z.literal(authentication === 'local-azure-cli' ? '1.1' : '1.0'), mode: z.literal('live'), authentication: z.literal(authentication)
    }).safeParse(JSON.parse(await smallBody(config))).success) throw new Error('The selected endpoint is not the expected native-local profile.')
  }
  return { hosting: local ? 'device-local' : 'reachable', tenantSignIn: 'unverified', liveData: 'unverified' }
}

function icon(size, outline) {
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  if (!outline) { context.fillStyle = '#5B5FC7'; context.fillRect(0, 0, size, size) }
  context.fillStyle = '#FFFFFF'
  context.font = `bold ${Math.round(size * .7)}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('T', size / 2, size / 2 + size * .025)
  return canvas.toBuffer('image/png')
}

export async function buildTeamsAppZip(options) {
  const { outputDirectory = join(root, 'release-teams'), development = false, ...metadata } = options
  const manifest = createTeamsManifest(metadata)
  validateTeamsManifestCapabilities(manifest)
  if (classifyPackageOrigin(metadata.origin).developmentOnly && !development) {
    throw new Error('The package origin is development-only or a template. Use an explicitly labeled development package or configure the selected HTTPS host.')
  }
  if (development && metadata.mode === 'live' && !localAuthenticationModes.has(metadata.authentication)) throw new Error('A development/template package cannot claim the live suite.')
  const zip = new JSZip()
  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  zip.file('color.png', icon(192, false))
  zip.file('outline.png', icon(32, true))
  await mkdir(outputDirectory, { recursive: true })
  const output = join(outputDirectory, localAuthenticationModes.has(metadata.authentication) ? 'TLC-Assist-Teams-local-live.zip' : development ? 'TLC-Assist-Teams-development.zip' : metadata.mode === 'live' ? 'TLC-Assist-Teams.zip' : 'TLC-Assist-Teams-sample.zip')
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const checked = await JSZip.loadAsync(bytes, { checkCRC32: true })
  if (Object.keys(checked.files).length !== 3) throw new Error('The Teams ZIP must contain exactly three root files.')
  await writeFile(output, bytes)
  return output
}

export async function validateTeamsManifest(manifest) {
  const cache = join(root, '.tlc', 'teams-schema-1.30.json')
  let schema
  try { schema = JSON.parse(await readFile(cache, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (schema === undefined) {
    const response = await fetch(teamsManifestSchemaUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('The official pinned Teams schema could not be downloaded.')
    schema = await response.json()
    await mkdir(dirname(cache), { recursive: true })
    await writeFile(cache, JSON.stringify(schema))
  }
  const validator = new Ajv({ allErrors: true, strict: false })
  addFormats(validator)
  const validate = validator.compile(schema)
  if (!validate(manifest)) throw new Error(`Teams manifest schema validation failed: ${JSON.stringify(validate.errors)}`)
  return validateTeamsManifestCapabilities(manifest)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'sample' }, origin: { type: 'string' },
    'app-id': { type: 'string' }, 'bot-id': { type: 'string' }, runtime: { type: 'boolean', default: false },
    development: { type: 'boolean', default: false }, 'verify-origin': { type: 'boolean', default: false },
    'local-native': { type: 'boolean', default: false },
    'local-azure-cli': { type: 'boolean', default: false }
  } })
  const configuredOrigin = values.origin ?? process.env.TLC_TEAMS_ORIGIN
  if (values['local-native'] && values['local-azure-cli']) throw new Error('Select exactly one local authentication profile.')
  const localOwner = values['local-native'] || values['local-azure-cli']
  if (!configuredOrigin && !values.development) throw new Error('Configure --origin with your selected HTTPS host, or explicitly request --development. Uploading the ZIP does not start a laptop server or provision hosting.')
  if (values.mode === 'live' && !values['app-id'] && !process.env.TLC_TEAMS_PACKAGE_ID) throw new Error('Live packaging requires the explicitly approved Teams package ID.')
  const metadata = {
    mode: values.mode,
    authentication: values['local-azure-cli'] ? 'local-azure-cli' : values['local-native'] ? 'local-interactive' : 'hosted-obo',
    origin: configuredOrigin ?? (localOwner ? 'https://localhost:3978' : 'https://localhost:3979'),
    appId: values['app-id'] ?? process.env.TLC_TEAMS_PACKAGE_ID ?? '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b',
    ...(values.mode === 'live' && !localOwner ? { botId: values['bot-id'] ?? process.env.TLC_TEAMS_BOT_CLIENT_ID } : {})
  }
  await validateTeamsManifest(createTeamsManifest(metadata))
  if (values['verify-origin']) console.info(`Hosting check: ${JSON.stringify(await verifyTeamsOrigin(metadata.origin, metadata.mode, fetch, metadata.authentication))}`)
  console.info(`Teams installation ZIP (manifest/icons only): ${await buildTeamsAppZip({ ...metadata, development: values.development })}`)
  console.info('The ZIP references the runtime you operate: local dev/test now, Azure later. It neither starts your laptop server nor deploys a runtime.')
  if (localOwner) console.warn('LOCAL-ONLY LIVE PACKAGE: each user must run this origin on their own device. Source access, eligibility and owner pairing are unverified; no cloud-suite readiness is claimed.')
  else if (values.development) console.warn('DEVELOPMENT PACKAGE: not a verified Teams installation. Configure trusted HTTPS exposure and repackage with that origin before sideloading.')
  if (values.runtime) {
    const { packageTeamsRuntime } = await import('./package-teams-runtime.mjs')
    console.info(`Teams runtime ZIP: ${await packageTeamsRuntime()}`)
  }
}
