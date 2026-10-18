import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { ManagedIdentityCredential } from '@azure/identity'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { TableClient } from '@azure/data-tables'
import { loadTeamsAdmission, loadTeamsConfiguration } from './configuration.js'
import { createTeamsHandler } from './app.js'
import { createDelegatedTokenProvider, type DelegatedTokenProvider } from './authentication.js'
import { SqliteDocumentStore, type ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { TableDocumentStore } from '../../../packages/connectors/common/table-document-store.js'
import { ScopedPortfolioPreferenceStore } from '../../../packages/connectors/common/scoped-portfolio-preferences.js'
import { GraphContextAuthority } from '../../../packages/connectors/teams/context-authority.js'
import { createLiveApplicationServices, createSampleApplicationServices, type ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { principalPartition, type ExecutionPrincipal, type PrincipalIdentity } from '../../../packages/orchestrator/collaboration/principal.js'
import type { ContextAuthority } from '../../../packages/orchestrator/collaboration/contexts.js'
import { registerTeamsBot } from './bot.js'
import { GraphSubscriptionConnector } from '../../../packages/connectors/graph/subscriptions.js'
import { GraphMeetingError } from '../../../packages/connectors/graph/meetings.js'
import { TranscriptEventService } from '../../../packages/orchestrator/collaboration/transcript-events.js'
import { MeetingAcquisitionService } from '../../../packages/orchestrator/collaboration/meeting-acquisition.js'
import { NotificationOutbox } from '../../../packages/orchestrator/collaboration/notifications.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import { WorkflowActivityStore } from '../../../packages/orchestrator/collaboration/activity.js'

export async function startTeamsServer(environment: NodeJS.ProcessEnv = process.env) {
  const configuration = loadTeamsConfiguration(environment)
  const acceptNewWork = loadTeamsAdmission(environment)
  const port = Number(environment['TLC_TEAMS_PORT'] ?? environment['PORT'] ?? 3978)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('The Teams listener port is invalid.')
  const host = environment['TLC_TEAMS_HOST'] ?? (environment['WEBSITE_SITE_NAME'] ? '0.0.0.0' : '127.0.0.1')
  const localPath = environment['TLC_TEAMS_STATE_PATH'] ?? resolve('.tlc', 'teams-state.sqlite')
  const managedIdentity = new ManagedIdentityCredential(environment['AZURE_CLIENT_ID'] ? { clientId: environment['AZURE_CLIENT_ID'] } : {})
  let store: ScopedDocumentStore
  let localStore: SqliteDocumentStore | undefined
  if (configuration.mode === 'sample') {
    if (localPath !== ':memory:') await mkdir(dirname(localPath), { recursive: true })
    localStore = new SqliteDocumentStore(localPath)
    store = localStore
  } else {
    store = new TableDocumentStore(new TableClient(configuration.storageUrl, 'TlcTeams', managedIdentity))
  }
  const lifecycle = new CollaborationLifecycle(store, acceptNewWork)
  const sessions = new Map<string, { services: Promise<ApplicationServices>; tokens: { current: DelegatedTokenProvider }; principal: ExecutionPrincipal; lastUsed: number; generation: number }>()
  const samplePath = environment['TLC_TEAMS_SAMPLE_PATH'] ?? resolve('.tlc', 'teams-sample.sqlite')
  if (configuration.mode === 'sample' && samplePath !== ':memory:') await mkdir(dirname(samplePath), { recursive: true })
  const sample = configuration.mode === 'sample'
    ? await createSampleApplicationServices({ dataPath: samplePath }) : undefined
  const confidential = configuration.mode === 'live' ? new ConfidentialClientApplication({
    auth: {
      clientId: configuration.apiClientId, authority: `https://login.microsoftonline.com/${configuration.tenantId}`,
      clientSecret: configuration.apiCredential
    }
  }) : undefined
  let authority: ContextAuthority
  if (configuration.mode === 'sample') {
    authority = { verify: async (principal) => {
      if (principal.mode !== 'sample') throw new Error('Sample disclosure policy cannot authorize a live user.')
      return { revision: 'sanitized-sample-only', canConfigure: true, canPublish: true, audienceEligible: true }
    } }
  } else {
    const policyPath = environment['TLC_TEAMS_DISCLOSURE_POLICY']
    if (!policyPath) throw new Error('An approved, expiring Teams disclosure policy is required in live mode.')
    const policy: unknown = JSON.parse(await readFile(resolve(policyPath), 'utf8'))
    const metadataClient = new ConfidentialClientApplication({
      auth: { clientId: configuration.botClientId, authority: `https://login.microsoftonline.com/${configuration.tenantId}`, clientSecret: configuration.botCredential }
    })
    authority = new GraphContextAuthority(policy, async () => {
      const result = await metadataClient.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] })
      if (!result?.accessToken) throw new Error('Teams context metadata authorization is unavailable.')
      return result.accessToken
    })
  }
  async function resolveServices(principal: ExecutionPrincipal, assertion: string): Promise<ApplicationServices> {
    if (sample) return sample
    if (configuration.mode !== 'live' || !confidential) throw new Error('Live Teams configuration is unavailable.')
    const key = principalPartition(principal)
    const generation = (await lifecycle.status(principal)).generation
    const provider = createDelegatedTokenProvider(configuration, assertion, (request) => confidential.acquireTokenOnBehalfOf(request), principal.expiresAt ?? Date.now())
    let existing = sessions.get(key)
    if (existing && existing.generation !== generation) {
      await stopOwnedWork(principal)
      existing = undefined
    }
    if (existing) {
      existing.tokens.current = provider; existing.principal = principal; existing.lastUsed = Date.now()
      const services = await existing.services
      services.refreshSource()
      return services
    }
    if (sessions.size >= 50) throw new Error('The live Teams session limit has been reached. Try again later.')
    const tokens = { current: provider }
    const services = createLiveApplicationServices({
      environment, msxResource: configuration.msxResource,
      getToken: async (resource) => {
        await lifecycle.assertGeneration(principal, generation)
        const token = await tokens.current.getToken(resource)
        await lifecycle.assertGeneration(principal, generation)
        return token
      },
      preferences: new ScopedPortfolioPreferenceStore(store, key),
      foundryCredential: managedIdentity
    })
    const entry = { services, tokens, principal, lastUsed: Date.now(), generation }
    sessions.set(key, entry)
    void services.catch(() => { if (sessions.get(key) === entry) sessions.delete(key) })
    return services
  }
  async function stopOwnedWork(identity: PrincipalIdentity): Promise<void> {
    const key = principalPartition(identity)
    const entry = sessions.get(key)
    if (entry) sessions.delete(key)
    const services = sample ?? (entry ? await entry.services : undefined)
    if (!services) return
    for (const run of services.workflows.listRuns({ contractVersion: workflowContractVersion, limit: 100 })) {
      if (run.status === 'queued' || run.status === 'running') {
        const cancelled = services.workflows.cancel({ contractVersion: workflowContractVersion, runId: run.runId })
        await new WorkflowActivityStore(store).record(identity, cancelled)
      }
    }
    if (entry) await services.dispose()
  }
  const web = express()
  web.disable('x-powered-by')
  web.use((_request, response, next) => {
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com https://*.microsoftonline.com; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft; base-uri 'none'; object-src 'none'; form-action 'self'")
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('cache-control', 'no-store')
    next()
  })
  let transport: Awaited<ReturnType<typeof registerTeamsBot>> | undefined
  if (configuration.mode === 'live') {
    const encodedKey = environment['TLC_TEAMS_STATE_KEY'] ?? ''
    const stateKey = Buffer.from(encodedKey, 'base64')
    if (stateKey.length !== 32 || stateKey.toString('base64') !== encodedKey) throw new Error('Live bot credential state requires a securely provisioned 32-byte Base64 encryption key.')
    transport = await registerTeamsBot({ web, configuration, store, stateKey, resolveServices, acceptNewWork, onDeactivate: stopOwnedWork })
  }
  const transcriptEvents = configuration.mode === 'live' ? new TranscriptEventService(
    store, { tenantId: configuration.tenantId, environmentId: configuration.environmentId },
    (principal) => new GraphSubscriptionConnector(configuration.origin, async () => {
      const session = sessions.get(principalPartition(principal))
      if (!session || (session.principal.expiresAt ?? 0) <= Date.now()) throw new Error('The original delegated session requires reauthentication.')
      return session.tokens.current.getToken('graph')
    }),
    async (principal, request, generation, notificationId) => {
      const session = sessions.get(principalPartition(principal))
      if (!session || (session.principal.expiresAt ?? 0) <= Date.now()) throw new GraphMeetingError('auth-required', 'delegated_session_expired')
      await lifecycle.assertActive(session.principal)
      await lifecycle.assertGeneration(session.principal, generation)
      const services = await session.services
      services.refreshSource()
      const result = await new MeetingAcquisitionService(store, {
        readOpportunity: async (_actor, id) => { await services.orchestrator.getOpportunitySnapshot(id) },
        getTranscripts: (_actor, input) => services.acquireTranscripts(input),
        propose: (_actor, id, transcript) => services.proposeTranscript(id, transcript)
      }).acquire(session.principal, request, { notificationId })
      if (result.status.state === 'auth-required') throw new GraphMeetingError('auth-required', 'delegated_session_expired')
      await new NotificationOutbox(store).enqueueAcquisition(session.principal, result)
      await transport?.notify(session.principal)
    }
  ) : undefined
  const handler = createTeamsHandler({
    configuration, store, resolveServices, authority, acceptNewWork, onDeactivate: stopOwnedWork,
    ...(transport ? { deliverPublication: transport.deliverPublication, notify: transport.notify } : {}),
    ...(transcriptEvents ? { transcriptEvents } : {}),
    onError: ({ correlationId, code, method, category }) => console.error(`[teams-api] ${correlationId} ${code} ${method} ${category}`)
  })
  web.use((request, response, next) => {
    void handler(request, response).then((handled) => { if (!handled) next() }).catch(() => {
      console.error('[teams-api] unhandled_transport_error')
      if (!response.headersSent) response.status(500).json({ error: 'transport_failed' })
    })
  })
  web.get('/auth/callback', (_request, response) => response.type('html').send('<!doctype html><html lang="en"><head><title>Microsoft sign-in complete</title></head><body>Return to TLC Assist.</body></html>'))
  web.get('/privacy', (_request, response) => response.type('text').send('TLC Assist uses delegated source permissions. Prompts, tokens, customer details and transcripts are not operational telemetry. Contact your application owner for the approved data and audit retention policy.'))
  web.get('/terms', (_request, response) => response.type('text').send('Internal Microsoft FTE application. Source-system authorization and reviewed-action controls apply. Sample mode uses sanitized data only.'))
  const clientRoot = resolve(environment['TLC_TEAMS_STATIC_ROOT'] ?? fileURLToPath(new URL('./client', import.meta.url)))
  web.use(express.static(clientRoot, { index: false, dotfiles: 'deny', fallthrough: true }))
  web.get('/', (_request, response) => response.sendFile(resolve(clientRoot, 'index.html')))
  web.use((_request, response) => response.status(404).json({ error: 'route_not_found' }))
  const server = createServer(web)
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.removeListener('error', reject); resolveReady() })
  })
  const address = server.address()
  const boundPort = address && typeof address !== 'string' ? address.port : port
  console.info(`TLC Teams ready at http://${host}:${boundPort} (${configuration.mode})`)
  let work = Promise.resolve()
  let processing = false
  let renewAfter = 0
  const interval = transcriptEvents ? setInterval(() => {
    if (processing || !acceptNewWork) return
    processing = true
    work = (async () => {
      const renew = Date.now() >= renewAfter
      if (renew) renewAfter = Date.now() + 60_000
      for (const session of sessions.values()) {
        if ((session.principal.expiresAt ?? 0) > Date.now()) {
          if (renew) {
            const health = await transcriptEvents.maintain(session.principal)
            if (health.some((item) => item.state !== 'active')) console.error('[teams-graph] subscription_renewal_unconfirmed')
          }
          await transcriptEvents.drain(session.principal)
        }
      }
    })().catch(() => { console.error('[teams-graph] event_processing_failed') }).finally(() => { processing = false })
  }, 5000) : undefined
  interval?.unref()
  return {
    server, configuration, store,
    async close() {
      if (interval) clearInterval(interval)
      await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()))
      await work
      for (const session of sessions.values()) await (await session.services).dispose()
      await sample?.dispose()
      localStore?.close()
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startTeamsServer().then((application) => {
    const stop = () => { void application.close().catch(() => { console.error('[teams-host] shutdown_failed'); process.exitCode = 1 }) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  }).catch(() => { console.error('[teams-host] configuration_or_startup_failed'); process.exitCode = 1 })
}
