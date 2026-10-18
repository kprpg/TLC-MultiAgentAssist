import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createSampleApplicationServices, type ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { createTeamsHandler } from '../../../apps/teams/src/app.js'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createWorkflowIpcHandlers, workflowIpcChannels } from '../../../apps/desktop/electron/main/workflow-ipc.js'
import { createLocalStoreDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { successResponse } from '../../../apps/vscode-extension/src/message-contracts.js'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'

describe('four-surface core parity', () => {
  it('keeps canonical account and workflow contracts equivalent across Teams, Web, Electron IPC and VS Code bridge', async () => {
    const services = await createSampleApplicationServices()
    const extension = createLocalStoreDataProvider()
    const store = new SqliteDocumentStore()
    const runtime: WebRuntime = Object.assign(services.orchestrator, {
      listMeetingTranscripts: async () => { throw new Error('Not used by this parity scenario.') },
      getMeetingTranscript: async () => { throw new Error('Not used by this parity scenario.') },
      proposeMeetingChangeSet: async () => { throw new Error('Not used by this parity scenario.') },
      applyMeetingChangeSet: (input: Parameters<ApplicationServices['meetings']['applyMeetingChangeSet']>[0]) => services.meetings.applyMeetingChangeSet(input)
    })
    const teams = createTeamsHandler({
      configuration: { mode: 'sample', origin: 'http://127.0.0.1', environmentId: 'sample' }, store,
      resolveServices: async () => services,
      authority: { verify: async () => ({ revision: 'sample', canConfigure: true, canPublish: true, audienceEligible: true }) }
    })
    const web = buildWebApiHandler({ createRuntime: () => runtime, resolveWorkflowHost: () => services.workflows })
    const serve = (handler: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>) => createServer((request, response) => { void handler(request, response) })
    const servers = [serve(teams), serve(web)]
    const urls: string[] = []
    try {
      for (const server of servers) {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing parity listener')
        urls.push(`http://127.0.0.1:${address.port}`)
      }
      const expected = await createApplicationOperations(services).invoke('listAccounts', {})
      const teamAccounts = await (await fetch(`${urls[0]}/api/teams/operations/listAccounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
      const webAccounts = await (await fetch(`${urls[1]}/api/accounts`, { headers: {
        'x-ms-client-principal': 'trusted-test-principal', 'x-ms-client-principal-name': 'sample@example.com', 'x-ms-token-aad-access-token': 'delegated-test-token'
      } })).json()
      expect(teamAccounts).toEqual(expected)
      expect(webAccounts).toEqual(expected)
      expect(await routeBridgeMessage(extension, { kind: 'request', id: 'parity', method: 'listAccounts', params: {} })).toEqual(successResponse('parity', expected))
      const input = { contractVersion: workflowContractVersion, scope: 'portfolio' }
      const definitions = await createApplicationOperations(services).invoke('workflows.list', input)
      const ipc = createWorkflowIpcHandlers(services.workflows)
      expect(ipc[workflowIpcChannels.list]!(input)).toEqual(definitions)
      expect(await routeBridgeMessage(extension, { kind: 'request', id: 'workflow-parity', method: 'listWorkflowDefinitions', params: { scope: 'portfolio' } }))
        .toEqual(successResponse('workflow-parity', definitions))
    } finally {
      for (const server of servers) await new Promise<void>((resolve) => { server.close(() => resolve()) })
      await extension.dispose(); await services.dispose(); store.close()
    }
  })
})
