import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { ConfidentialClientApplication } from '@azure/msal-node'
import { isLocalConfiguration, isNativeConfiguration, loadTeamsAdmission, loadTeamsConfiguration, loadTeamsRuntimeConfiguration, loadTeamsStateKey, loadTeamsTlsConfiguration } from './configuration.js'
import { assertNativeHttpRequest, createTeamsHandler } from './app.js'
import { createDelegatedTokenProvider, type DelegatedTokenProvider } from './authentication.js'
import { createTeamsStateStore, createTeamsWorkloadCredential } from './runtime-resources.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
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
import { createNativeConnection } from './native-connection.js'
import { invokeProtectedOwnerCommand, prepareOwnerDirectory } from './local-owner-control.js'
import { localConnectionVersion, localOwnerCommandSchema } from '../../../packages/common/contracts/local-connection.js'
import { NativeConnectionError } from './native-identity.js'
import { TeamsLaunchMonitor } from './launch-status.js'
import { teamsClientBuildSchema, teamsLaunchIdentitySchema, teamsLaunchVersion } from '../../../packages/common/contracts/teams-launch.js'
import { teamsDataModeSchema } from '../../../packages/common/contracts/teams-data-mode.js'
import { createTeamsPerformanceReporter } from './performance.js'
import { createTeamsDataModeRouter } from './data-mode-router.js'

export async function startTeamsServer(environment: NodeJS.ProcessEnv = process.env) {
  const configuration = loadTeamsConfiguration(environment)
  const hosted = configuration.mode === 'live' && !isLocalConfiguration(configuration) ? configuration : undefined
  const tlsConfiguration = loadTeamsTlsConfiguration(environment, configuration.origin)
  const tls = tlsConfiguration ? {
    cert: await readFile(tlsConfiguration.certificatePath),
    key: await readFile(tlsConfiguration.keyPath)
  } : undefined
  const acceptNewWork = loadTeamsAdmission(environment)
  const port = Number(environment['TLC_TEAMS_PORT'] ?? environment['PORT'] ?? 3978)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('The Teams listener port is invalid.')
  const host = environment['TLC_TEAMS_HOST'] ?? (environment['WEBSITE_SITE_NAME'] ? '0.0.0.0' : '127.0.0.1')
  if (isLocalConfiguration(configuration) && (!tls || !['localhost', '127.0.0.1', '::1'].includes(host) ||
      port !== Number(new URL(configuration.origin).port || 443))) throw new Error('Native Teams requires trusted loopback HTTPS on the exact configured origin port.')
  const clientRoot = resolve(environment['TLC_TEAMS_STATIC_ROOT'] ?? fileURLToPath(new URL('./client', import.meta.url)))
  const build = environment['TLC_TEAMS_RUN_ID'] || environment['TLC_TEAMS_CLIENT_BUILD_ID']
    ? teamsClientBuildSchema.parse(JSON.parse(await readFile(resolve(clientRoot, 'build.json'), 'utf8'))) : undefined
  if (environment['TLC_TEAMS_CLIENT_BUILD_ID'] && environment['TLC_TEAMS_CLIENT_BUILD_ID'] !== build?.buildId) {
    throw new Error('The configured client build does not match the served Teams client.')
  }
  const native = isLocalConfiguration(configuration) ? await createNativeConnection(configuration, environment) : undefined
  const launch = build
    ? new TeamsLaunchMonitor(teamsLaunchIdentitySchema.parse({
      contractVersion: teamsLaunchVersion, runId: environment['TLC_TEAMS_RUN_ID'],
      clientBuildId: build.buildId, packageId: environment['TLC_TEAMS_PACKAGE_ID'],
      packageVersion: environment['TLC_TEAMS_PACKAGE_VERSION'], origin: configuration.origin, mode: configuration.mode,
      authentication: isLocalConfiguration(configuration) ? configuration.authentication : 'hosted-obo'
    }), native ? (code) => native.pairing.hasPage(code) : undefined) : undefined
  const runtimeEnvironment: NodeJS.ProcessEnv = native?.environment ?? environment
  const performanceReporter = createTeamsPerformanceReporter(runtimeEnvironment)
  const runtime = loadTeamsRuntimeConfiguration(runtimeEnvironment, configuration)
  const stateKey = configuration.mode === 'live' ? loadTeamsStateKey(runtimeEnvironment) : undefined
  const foundry = hosted || isNativeConfiguration(configuration) && configuration.guidanceMode === 'foundry'
    ? await loadFoundryEnvironmentFromEnvironment(runtimeEnvironment) : undefined
  const foundryCredential = foundry ? createTeamsWorkloadCredential(runtime, foundry.authentication.foundryTenantId, runtimeEnvironment) : undefined
  const initialMode = teamsDataModeSchema.parse(environment['TLC_TEAMS_INITIAL_MODE'] ?? configuration.mode)
  if (initialMode === 'live' && configuration.mode !== 'live') throw new Error('Live mode is not configured for this runtime.')
  const resources = await createTeamsStateStore(configuration, runtime, runtimeEnvironment)
  const { store } = resources
  const sampleConfiguration = { mode: 'sample' as const, origin: configuration.origin, environmentId: 'sample' }
  const sampleStatePath = runtime.samplePath === ':memory:' ? ':memory:' : `${runtime.samplePath}.state.sqlite`
  let sampleResources: typeof resources
  try {
    sampleResources = configuration.mode === 'sample' ? resources : await createTeamsStateStore(sampleConfiguration, {
      ...runtime, state: { kind: 'sqlite', path: sampleStatePath }
    }, {})
  } catch (error) { resources.close(); throw error }
  let sample: ApplicationServices | undefined
  try {
  const lifecycle = new CollaborationLifecycle(store, acceptNewWork)
  const sessions = new Map<string, { services: Promise<ApplicationServices>; tokens: { current: DelegatedTokenProvider }; principal: ExecutionPrincipal; lastUsed: number; generation: number; nativeGeneration: number }>()
  const samplePath = runtime.samplePath
  if (samplePath !== ':memory:') await mkdir(dirname(samplePath), { recursive: true })
  sample = await createSampleApplicationServices({ dataPath: samplePath })
  const confidential = hosted ? new ConfidentialClientApplication({
    auth: {
      clientId: hosted.apiClientId, authority: `https://login.microsoftonline.com/${hosted.tenantId}`,
      clientSecret: hosted.apiCredential
    }
  }) : undefined
  let authority: ContextAuthority
  if (configuration.mode === 'sample') {
    authority = { verify: async (principal) => {
      if (principal.mode !== 'sample') throw new Error('Sample disclosure policy cannot authorize a live user.')
      return { revision: 'sanitized-sample-only', canConfigure: true, canPublish: true, audienceEligible: true }
    } }
  } else if (hosted) {
    const policyPath = environment['TLC_TEAMS_DISCLOSURE_POLICY']
    if (!policyPath) throw new Error('An approved, expiring Teams disclosure policy is required in live mode.')
    const policy: unknown = JSON.parse(await readFile(resolve(policyPath), 'utf8'))
    const metadataClient = new ConfidentialClientApplication({
      auth: { clientId: hosted.botClientId, authority: `https://login.microsoftonline.com/${hosted.tenantId}`, clientSecret: hosted.botCredential }
    })
    authority = new GraphContextAuthority(policy, async () => {
      const result = await metadataClient.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] })
      if (!result?.accessToken) throw new Error('Teams context metadata authorization is unavailable.')
      return result.accessToken
    })
  } else authority = { verify: async () => { throw new Error('Private local source access is not cross-device publication authority.') } }
  async function resolveServices(principal: ExecutionPrincipal, assertion: string): Promise<ApplicationServices> {
    if (principal.mode !== configuration.mode) throw new Error('The source mode does not match the execution principal.')
    if (configuration.mode === 'sample' && principal.mode === 'sample') return sample!
    if (configuration.mode !== 'live' || !native && (!hosted || !confidential || !foundryCredential)) throw new Error('Live Teams configuration is unavailable.')
    const key = principalPartition(principal)
    const generation = (await lifecycle.status(principal)).generation
    const nativeGeneration = native?.provider.generation ?? 0
    const provider = native?.provider ?? (hosted && confidential ? createDelegatedTokenProvider(hosted, assertion, (request) => confidential.acquireTokenOnBehalfOf(request), principal.expiresAt ?? Date.now()) : undefined)
    if (!provider) throw new Error('The configured live source credential is unavailable.')
    let existing = sessions.get(key)
    if (existing && (existing.generation !== generation || existing.nativeGeneration !== nativeGeneration)) {
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
    const assertNativeOwner = () => {
      const identity = native?.provider.identity()
      if (native && (!identity || identity.generation !== nativeGeneration || principalPartition(identity.principal) !== key)) throw new NativeConnectionError('native_connection_changed')
    }
    const services = createLiveApplicationServices({
      environment: runtimeEnvironment, msxResource: configuration.msxResource,
      ...(performanceReporter ? { performanceReporter } : {}),
      ...(native ? {
        guidanceMode: isNativeConfiguration(configuration) ? configuration.guidanceMode : 'deterministic',
        fetchImplementation: async (input, init) => {
          assertNativeOwner()
          const response = await native.fetchImplementation(input, init)
          assertNativeOwner()
          return response
        }
      } : {}),
      getToken: async (resource) => {
        assertNativeOwner()
        await lifecycle.assertGeneration(principal, generation)
        const token = await tokens.current.getToken(resource)
        assertNativeOwner()
        await lifecycle.assertGeneration(principal, generation)
        return token
      },
      reportingIdentity: async () => ({ key: `teams:${key}`, objectId: principal.userId }),
      ...(runtimeEnvironment['TLC_SE_REPORTING_ENABLED'] === '1' ? {
        getReportingToken: async (resource: import('../../../packages/common/contracts/se-reporting.js').SeReportingResource) => {
          assertNativeOwner()
          await lifecycle.assertGeneration(principal, generation)
          if (!tokens.current.getReportingToken) throw new NativeConnectionError('native_resource_unavailable')
          const result = await tokens.current.getReportingToken(resource)
          assertNativeOwner()
          await lifecycle.assertGeneration(principal, generation)
          return result
        },
        reportingFetcher: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          assertNativeOwner()
          const response = await fetch(input, init)
          assertNativeOwner()
          return response
        }
      } : {}),
      preferences: new ScopedPortfolioPreferenceStore(store, key),
      ...(foundryCredential ? { foundryCredential } : {})
    })
    const entry = { services, tokens, principal, lastUsed: Date.now(), generation, nativeGeneration }
    sessions.set(key, entry)
    void services.catch(() => { if (sessions.get(key) === entry) sessions.delete(key) })
    return services
  }
  async function stopOwnedWork(identity: PrincipalIdentity, sampleOnly = configuration.mode === 'sample'): Promise<void> {
    const key = principalPartition(identity)
    const entry = sampleOnly ? undefined : sessions.get(key)
    if (entry) sessions.delete(key)
    const services = sampleOnly ? sample : entry ? await entry.services : undefined
    if (!services) return
    for (const run of services.workflows.listRuns({ contractVersion: workflowContractVersion, limit: 100 })) {
      if (run.status === 'queued' || run.status === 'running') {
        const cancelled = services.workflows.cancel({ contractVersion: workflowContractVersion, runId: run.runId })
        await new WorkflowActivityStore(sampleOnly ? sampleResources.store : store).record(identity, cancelled)
      }
    }
    if (entry) await services.dispose()
  }
  let ready = false
  const web = express()
  web.disable('x-powered-by')
  web.use((request, response, next) => {
    if (native) {
      try { assertNativeHttpRequest(request, configuration.origin) }
      catch { response.status(403).json({ error: 'local_origin_denied' }); return }
    }
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com https://*.microsoftonline.com https://res.cdn.office.net/teams-js/validDomains/json/validDomains.json; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft; base-uri 'none'; object-src 'none'; form-action 'self'")
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('cache-control', 'no-store')
    if (!ready && (request.path === '/api/health' || request.path.startsWith('/api/teams/'))) {
      response.status(503).json({ error: 'runtime_starting' })
      return
    }
    next()
  })
  let transport: Awaited<ReturnType<typeof registerTeamsBot>> | undefined
  if (hosted) {
    if (!stateKey) throw new Error('Live bot credential state requires its configured encryption key.')
    transport = await registerTeamsBot({ web, configuration: hosted, store, stateKey, resolveServices, acceptNewWork, onDeactivate: stopOwnedWork })
  }
  const transcriptEvents = hosted ? new TranscriptEventService(
    store, { tenantId: hosted.tenantId, environmentId: hosted.environmentId },
    (principal) => new GraphSubscriptionConnector(hosted.origin, async () => {
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
  const configuredHandler = createTeamsHandler({
    configuration, store, resolveServices, authority, acceptNewWork, onDeactivate: stopOwnedWork,
    backgroundSync: runtimeEnvironment['TLC_BACKGROUND_SYNC'] === '1',
    durableMutationState: runtime.state.kind === 'table' || runtime.state.path !== ':memory:',
    ...(transport ? { deliverPublication: transport.deliverPublication, notify: transport.notify } : {}),
    ...(transcriptEvents ? { transcriptEvents } : {}),
    ...(native ? { localConnection: native } : {}),
    ...(launch ? { launch } : {}),
    onError: ({ correlationId, code, method, category }) => console.error(`[teams-api] ${correlationId} ${code} ${method} ${category}`)
  })
  const sampleHandler = configuration.mode === 'sample' ? configuredHandler : createTeamsHandler({
    configuration: sampleConfiguration, store: sampleResources.store, acceptNewWork,
    backgroundSync: runtimeEnvironment['TLC_BACKGROUND_SYNC'] === '1',
    durableMutationState: samplePath !== ':memory:',
    onDeactivate: (principal) => stopOwnedWork(principal, true),
    resolveServices: async (principal) => {
      if (principal.mode !== 'sample' || !sample) throw new Error('Sample services require Sample admission.')
      return sample
    },
    authority: { verify: async (principal) => {
      if (principal.mode !== 'sample') throw new Error('Sample disclosure cannot authorize a live user.')
      return { revision: 'sanitized-sample-only', canConfigure: true, canPublish: true, audienceEligible: true }
    } },
    ...(launch ? { launch } : {}),
    onError: ({ correlationId, code, method, category }) => console.error(`[teams-sample-api] ${correlationId} ${code} ${method} ${category}`)
  })
  const handler = createTeamsDataModeRouter({
    configuration, initialMode, sample: sampleHandler,
    ...(configuration.mode === 'live' ? { live: configuredHandler } : {})
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
  web.use(express.static(clientRoot, {
    index: false, dotfiles: 'deny', fallthrough: true,
    setHeaders: (response, path) => {
      if (/[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg)$/.test(path)) {
        response.setHeader('cache-control', 'public, max-age=31536000, immutable')
      }
    }
  }))
  web.get('/', (_request, response) => response.sendFile(resolve(clientRoot, 'index.html')))
  web.use((_request, response) => response.status(404).json({ error: 'route_not_found' }))
  const server = tls ? createHttpsServer(tls, web) : createServer(web)
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.removeListener('error', reject); resolveReady() })
  })
  const address = server.address()
  const boundPort = address && typeof address !== 'string' ? address.port : port
  let ownerControl: Awaited<ReturnType<NonNullable<typeof native>['startOwnerControl']>> | undefined
  if (native) {
    try {
      ownerControl = await native.startOwnerControl(async () => {
        for (const entry of [...sessions.values()]) await stopOwnedWork(entry.principal)
      })
    }
    catch (error) {
      await new Promise<void>((closed) => server.close(() => closed()))
      throw error
    }
  }
  ready = true
  console.info(`TLC Teams ready at ${tls ? 'https' : 'http'}://${host}:${boundPort} (${configuration.mode})`)
  console.info(`[teams-host] profile=${runtime.profile} state=${runtime.state.kind} source-identity=${configuration.mode === 'live' ? 'delegated-user' : 'sanitized-sample'}`)
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
  let closing: Promise<void> | undefined
  return {
    server, configuration, store,
    close(): Promise<void> {
      closing ??= (async () => {
      ready = false
      if (interval) clearInterval(interval)
      try {
        await Promise.all([configuredHandler.drainMutations(), ...(sampleHandler === configuredHandler ? [] : [sampleHandler.drainMutations()])])
        try { await ownerControl?.close() }
        finally {
          try { if (native) { native.pairing.invalidate(); await native.provider.disconnect() } }
          finally {
            await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()))
            await work
            for (const session of sessions.values()) await (await session.services).dispose()
            await sample?.dispose()
          }
        }
      } finally { if (sampleResources !== resources) sampleResources.close(); resources.close() }
      })()
      return closing
    }
  }
  } catch (error) {
    try { await sample?.dispose() } finally { if (sampleResources !== resources) sampleResources.close(); resources.close() }
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--local-owner') {
    const action = process.argv[3]
    const directory = process.argv[4]
    void (async () => {
      if (!directory) throw new Error('A protected owner directory is required.')
      if (action === 'prepare') { await prepareOwnerDirectory(directory); console.info('Protected native owner directory prepared. No source sign-in or data access occurred.'); return }
      const command = localOwnerCommandSchema.parse({
        contractVersion: localConnectionVersion, action,
        ...(action === 'connect' ? { resource: process.argv[5] ?? 'msx' } : {}),
        ...(action === 'approve' ? { userCode: process.argv[5] } : {})
      })
      const result = await invokeProtectedOwnerCommand(directory, command)
      if (!result.ok) throw new Error(result.error)
      console.info(JSON.stringify(result, null, 2))
    })().catch((error: unknown) => {
      const code = error instanceof Error && /^[a-z_]{1,100}$/.test(error.message) ? error.message : 'owner_command_failed'
      console.error(`[teams-owner] ${code}; check the protected directory, native registration/eligibility and resource grants. No source write was performed.`)
      process.exitCode = 1
    })
  } else startTeamsServer().then((application) => {
    const stop = () => { void application.close().catch(() => { console.error('[teams-host] shutdown_failed'); process.exitCode = 1 }) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  }).catch(() => { console.error('[teams-host] configuration_or_startup_failed'); process.exitCode = 1 })
}
