import { randomUUID } from 'node:crypto'
import type { Application } from 'express'
import { App, ExpressAdapter, type IActivityContext } from '@microsoft/teams.apps'
import { z } from 'zod'
import type { ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import type { ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { NotificationOutbox } from '../../../packages/orchestrator/collaboration/notifications.js'
import { principalPartition, type ExecutionPrincipal, type PrincipalIdentity } from '../../../packages/orchestrator/collaboration/principal.js'
import { CollaborationLifecycle } from '../../../packages/orchestrator/collaboration/lifecycle.js'
import type { ContextBinding } from '../../../packages/common/contracts/collaboration.js'
import type { SharedProjection } from '../../../packages/orchestrator/collaboration/publications.js'
import type { TeamsLiveConfiguration } from './configuration.js'
import { createTeamsAuthenticator } from './authentication.js'
import { EncryptedSdkState } from './credential-state.js'
import { assertActivityActor, routeTeamsCommand } from './bot-commands.js'
import { UserRequestBudget } from '../../../packages/orchestrator/collaboration/request-budget.js'
import { WorkflowActivityStore } from '../../../packages/orchestrator/collaboration/activity.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'
import { updateVerifiedTeamsInstallation } from './installation-lifecycle.js'

class RedactedLogger {
  debug(): void {}
  trace(): void {}
  info(): void {}
  warn(): void { console.warn('[teams-sdk] warning') }
  error(): void { console.error('[teams-sdk] operation_failed') }
  log(level: 'error' | 'warn' | 'info' | 'debug' | 'trace'): void {
    if (level === 'error') this.error()
    else if (level === 'warn') this.warn()
  }
  child(): RedactedLogger { return this }
}

export async function registerTeamsBot(options: {
  web: Application
  configuration: TeamsLiveConfiguration
  store: ScopedDocumentStore
  stateKey: Buffer
  resolveServices(principal: ExecutionPrincipal, assertion: string): Promise<ApplicationServices>
  acceptNewWork?: boolean
  onDeactivate?(identity: PrincipalIdentity): Promise<void>
}) {
  const { configuration, store } = options
  const authenticate = createTeamsAuthenticator(configuration)
  const lifecycle = new CollaborationLifecycle(store, options.acceptNewWork ?? true)
  const credentialState = new EncryptedSdkState(store, `${configuration.tenantId}:${configuration.environmentId}:bot-credentials`, options.stateKey)
  const bot = new App({
    clientId: configuration.botClientId, clientSecret: configuration.botCredential, tenantId: configuration.tenantId,
    applicationIdUri: `api://botid-${configuration.botClientId}`,
    httpServerAdapter: new ExpressAdapter(options.web, { logger: new RedactedLogger() }),
    dangerouslyAllowUnauthenticatedRequests: false,
    telemetry: { agent365: false },
    storage: credentialState, state: { storage: {
      get: async (key) => {
        const value = await credentialState.get(key)
        return value === undefined ? undefined : z.string().parse(value)
      },
      set: (key, value) => credentialState.set(key, value),
      delete: (key) => credentialState.delete(key)
    } }, logger: new RedactedLogger()
  })
  const flow = bot.addOAuthFlow('tlc-api', { oauthCardText: 'Sign in to TLC Assist with your authorized corporate FTE account.', signInButtonText: 'Sign in to TLC Assist' })
  const deliveryPartition = `${configuration.tenantId}:${configuration.environmentId}:delivery`
  async function saveReference(key: string, conversationId: string, teamId?: string): Promise<void> {
    const row = await store.read(deliveryPartition, key)
    const previous = row ? z.object({ disabled: z.boolean(), installationEventAt: z.string().optional() }).passthrough().parse(row.value) : undefined
    const value = { ...previous, conversationId, disabled: previous?.disabled ?? false, ...(teamId ? { teamId } : {}) }
    if (row ? !await store.replace(deliveryPartition, key, row.revision, value) : !await store.insert(deliveryPartition, key, value)) {
      throw new Error('The verified conversation reference changed concurrently.')
    }
  }
  async function installation(context: IActivityContext, action: 'add' | 'remove'): Promise<void> {
      try {
        await updateVerifiedTeamsInstallation({
          store, scope: { tenantId: configuration.tenantId, environmentId: configuration.environmentId },
          ...(options.onDeactivate ? { onDeactivate: options.onDeactivate } : {})
        }, {
          tenantId: context.activity.channelData?.tenant?.id, userId: context.activity.from.aadObjectId,
          conversationType: context.activity.conversation.conversationType, conversationId: context.activity.conversation.id,
          channelId: context.activity.channelData?.channel?.id, teamId: context.activity.channelData?.team?.id,
          timestamp: context.activity.timestamp
        }, action)
        if (action === 'remove' && context.activity.conversation.conversationType === 'personal') await flow.signOut(context)
      } catch (error) {
        console.error('[teams-installation] lifecycle_change_unconfirmed')
        throw error
      }
  }
  bot.on('install.add', (context) => installation(context, 'add'))
  bot.on('install.remove', (context) => installation(context, 'remove'))
  bot.on('message', async (context) => {
    if (context.activity.channelData?.tenant?.id !== configuration.tenantId) return
    const conversationType = context.activity.conversation.conversationType
    if (conversationType !== 'personal') {
      const channelId = context.activity.channelData?.channel?.id
      if (channelId) await saveReference(`channel:${channelId}`, context.activity.conversation.id, context.activity.channelData?.team?.id)
      else await saveReference(`chat:${context.activity.conversation.id}`, context.activity.conversation.id)
      await context.send({ type: 'message', textFormat: 'plain', text: `Open your private TLC Assist workbench to sign in and review business information: ${configuration.origin}/` })
      return
    }
    try {
      const assertion = await flow.signIn(context)
      if (!assertion) return
      const principal = await authenticate(assertion)
      assertActivityActor(principal, { userId: context.activity.from.aadObjectId, tenantId: context.activity.channelData?.tenant?.id })
      if (context.activity.text?.trim().toLowerCase() === 'signout') {
        await lifecycle.deactivate(principal)
        await options.onDeactivate?.(principal)
        await flow.signOut(context)
        await context.send({ type: 'message', textFormat: 'plain', text: 'Your TLC bot connection is signed out. This does not sign you out of Teams.' })
        return
      }
      await lifecycle.assertActive(principal)
      await new UserRequestBudget(store).consume(principal, 'requests', 60)
      if (/^\s*(?:ask|workflow)\s/i.test(context.activity.text ?? '')) await new UserRequestBudget(store).consume(principal, 'agent', 4)
      await saveReference(`personal:${principal.userId}`, context.activity.conversation.id)
      const ownerKey = `conversation-owner:${context.activity.conversation.id}`
      const owner = await store.read(deliveryPartition, ownerKey)
      if (owner ? !await store.replace(deliveryPartition, ownerKey, owner.revision, { userId: principal.userId })
        : !await store.insert(deliveryPartition, ownerKey, { userId: principal.userId })) throw new Error('The conversation owner changed concurrently.')
      const services = await options.resolveServices(principal, assertion)
      const reply = await routeTeamsCommand({ principal, conversationType: 'personal', text: context.activity.text ?? 'help' }, services, configuration.origin)
      const activity = new WorkflowActivityStore(store)
      for (const run of services.workflows.listRuns({ contractVersion: workflowContractVersion, limit: 20 })) await activity.record(principal, run)
      await context.send({ type: 'message', textFormat: 'plain', text: `${reply.text}\n${reply.openUrl}` })
      await notify(principal)
    } catch {
      console.error('[teams-bot] delegated_operation_failed')
      await context.send({ type: 'message', textFormat: 'plain', text: `TLC could not authorize or complete this request. Open your private workbench for connection status: ${configuration.origin}/` })
    }
  })
  flow.onSignInComplete(async (context) => {
    await context.send({ type: 'message', textFormat: 'plain', text: 'Sign-in completed. Send your TLC request again; source permissions are checked for that request.' })
  })
  flow.onSignInFailure(async (context) => {
    await context.send({ type: 'message', textFormat: 'plain', text: 'TLC sign-in did not complete. Your tenant consent and FTE assignment may require administrator review.' })
  })
  bot.on('message.ext.query', async (context) => {
    const handoff = { composeExtension: {
      type: 'result' as const, attachmentLayout: 'list' as const,
      attachments: [{ contentType: 'application/vnd.microsoft.card.hero', content: {
        title: 'TLC Assist', text: 'Open the private workbench to sign in or prepare an approved shared summary.',
        buttons: [{ type: 'openUrl', title: 'Open TLC Assist', value: configuration.origin }]
      } }]
    } }
    if (context.activity.channelData?.tenant?.id !== configuration.tenantId) return handoff
    try {
      const assertion = await flow.getToken(context)
      if (!assertion) return handoff
      const principal = await authenticate(assertion)
      assertActivityActor(principal, { userId: context.activity.from.aadObjectId, tenantId: context.activity.channelData?.tenant?.id })
      await new UserRequestBudget(store).consume(principal, 'requests', 60)
      const parameter = context.activity.value.parameters?.find((item) => item.name === 'search')
      await lifecycle.assertReadable(principal)
      const query = z.string().trim().min(2).max(100).parse(parameter?.value)
      const services = await options.resolveServices(principal, assertion)
      const candidates = await services.orchestrator.searchAccounts({ query, matchBy: 'name' })
      const attachments = []
      for (const candidate of candidates.slice(0, 10)) {
        const referenceId = randomUUID()
        if (!await store.insert(principalPartition(principal), `reference:${referenceId}`, { accountId: candidate.id, query })) throw new Error('The private account reference could not be saved.')
        attachments.push({
          contentType: 'application/vnd.microsoft.card.hero',
          content: { title: 'Private TLC account reference', text: 'Sign in to view with your own source permissions.', buttons: [
            { type: 'openUrl', title: 'Open private account', value: `${configuration.origin}/?referenceId=${encodeURIComponent(referenceId)}` }
          ] },
          preview: { contentType: 'application/vnd.microsoft.card.thumbnail', content: { title: candidate.name, text: 'Private search result. Insertion shares an authenticated link, not this account data.' } }
        })
      }
      return { composeExtension: { type: 'result' as const, attachmentLayout: 'list' as const, attachments } }
    } catch {
      console.error('[teams-message-extension] authorization_or_query_failed')
      return handoff
    }
  })
  bot.event('error', () => { console.error('[teams-sdk] activity_failed') })
  await bot.initialize()

  async function notify(principal: ExecutionPrincipal): Promise<void> {
    if (!(await lifecycle.status(principal)).acceptingNewWork) return
    const row = await store.read(deliveryPartition, `personal:${principal.userId}`)
    if (!row) return
    const reference = z.object({ conversationId: z.string(), disabled: z.boolean() }).parse(row.value)
    if (reference.disabled) return
    await new NotificationOutbox(store).deliver(principal, async (notification) => {
      await lifecycle.assertActive(principal)
      await bot.send(reference.conversationId, { type: 'message', textFormat: 'plain', text: `${notification.title}. Open your private Activity view: ${configuration.origin}/` })
    })
  }
  return {
    bot, notify,
    async deliverPublication(_principal: ExecutionPrincipal, binding: ContextBinding, projection: SharedProjection) {
      await lifecycle.assertActive(_principal)
      const row = await store.read(deliveryPartition, `${binding.kind}:${binding.contextId}`)
      if (!row) throw new Error('The bot must be installed and receive an activity in the approved context before publication.')
      const reference = z.object({ conversationId: z.string(), disabled: z.boolean(), teamId: z.string().optional() }).parse(row.value)
      if (reference.disabled) throw new Error('The Teams delivery context is disabled.')
      if (reference.teamId) {
        const team = await store.read(deliveryPartition, `team:${reference.teamId}`)
        if (team && z.object({ disabled: z.boolean() }).parse(team.value).disabled) throw new Error('The destination installation was removed.')
      }
      const message = await bot.send(reference.conversationId, {
        type: 'message', textFormat: 'plain', text: `${projection.title}\n${projection.text}\nReviewed snapshot. Source permissions apply to live details: ${configuration.origin}/`
      })
      return { messageId: message.id }
    }
  }
}
