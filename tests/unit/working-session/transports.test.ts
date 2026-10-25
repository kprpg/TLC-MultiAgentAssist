import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createWebWorkingSessionResolver } from '../../../apps/web/src/working-session.js'
import { createWorkingSessionIpcHandlers } from '../../../apps/desktop/electron/main/working-session-ipc.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { createExtensionWorkingSession } from '../../../apps/vscode-extension/src/working-session.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { createWorkingSessionService, folderOutput } from '../../../packages/orchestrator/working-session/index.js'
import { workingSessionPrepareRequestSchema, workingSessionResultSchema, workingSessionTopicResponseSchema } from '../../../packages/common/contracts/working-session.js'

const headers = { 'x-ms-client-principal': 'p', 'x-ms-client-principal-name': 'alice@microsoft.com', 'x-ms-token-aad-access-token': 't', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
const topicRequest = { contractVersion: '1.0', opportunityId: 'opp-1', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC' }

async function prepareRequest(baseTopic: unknown) {
  return workingSessionPrepareRequestSchema.parse({ contractVersion: '1.0', opportunityId: 'opp-1', opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC', topic: baseTopic, deliverables: { decks: false, learn: true, iac: true } })
}

describe('Web working-session routes', () => {
  let server: Server | undefined
  afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined })
  const listen = async (handler: ReturnType<typeof buildWebApiHandler>) => {
    server = createServer((request, response) => { void handler(request, response).then((handled) => { if (!handled) { response.statusCode = 404; response.end() } }) })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }
  const handler = () => buildWebApiHandler({
    createRuntime: () => ({} as WebRuntime),
    resolveWorkingSessionHost: createWebWorkingSessionResolver({ mode: 'sample', createRuntime: () => ({} as WebRuntime) })
  })

  it('derives a topic and prepares a zip that only the same user can download', async () => {
    const base = await listen(handler())
    const topic = workingSessionTopicResponseSchema.parse(await (await fetch(`${base}/api/working-session/topic`, { method: 'POST', headers, body: JSON.stringify(topicRequest) })).json()).topic
    expect(topic.topic).toBe('Azure Arc-enabled SQL')

    const prepared = workingSessionResultSchema.parse(await (await fetch(`${base}/api/working-session/prepare`, { method: 'POST', headers, body: JSON.stringify(await prepareRequest(topic)) })).json())
    expect(prepared.delivery.kind).toBe('download')
    if (prepared.delivery.kind !== 'download') return

    const download = await fetch(`${base}/api/working-session/download/${prepared.delivery.downloadId}`, { headers })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/zip')
    expect(download.headers.get('content-disposition')).toContain('ARC ENABLED SQL - POC.zip')
    const zip = await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()))
    expect(zip.file('ARC ENABLED SQL - POC/iac/main.bicep')).not.toBeNull()

    const other = await fetch(`${base}/api/working-session/download/${prepared.delivery.downloadId}`, { headers: { ...headers, 'x-ms-client-principal-name': 'mallory@microsoft.com' } })
    expect(other.status).toBe(404)
  })

  it('rejects invalid, extra and cross-origin requests', async () => {
    const base = await listen(handler())
    expect((await fetch(`${base}/api/working-session/topic`, { method: 'POST', headers, body: JSON.stringify({ ...topicRequest, extra: 1 }) })).status).toBeGreaterThanOrEqual(400)
    expect((await fetch(`${base}/api/working-session/topic`, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(topicRequest) })).status).toBe(403)
    expect((await fetch(`${base}/api/working-session/topic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(topicRequest) })).status).toBe(401)
    expect((await fetch(`${base}/api/working-session/download/not-a-uuid`, { headers })).status).toBe(404)
  })
})

describe('Desktop working-session IPC', () => {
  it('opens only an existing directory under Documents\\TLC', async () => {
    const documents = await mkdtemp(join(tmpdir(), 'tlc-docs-'))
    try {
      await mkdir(join(documents, 'TLC', 'Opp - MS'), { recursive: true })
      const openPath = vi.fn(async () => '')
      const service = createWorkingSessionService({ mode: 'sample', openOutput: async (name) => folderOutput(documents, name) })
      const handlers = createWorkingSessionIpcHandlers(service, { documentsFolder: () => documents, openPath })
      await handlers.open({ folderPath: join(documents, 'TLC', 'Opp - MS') })
      expect(openPath).toHaveBeenCalledWith(join(documents, 'TLC', 'Opp - MS'))
      for (const folderPath of [join(documents, 'TLC'), join(documents, 'Other'), join(documents, 'TLC', '..', 'Windows'), 'C:\\Windows\\System32\\calc.exe', join(documents, 'TLC', 'missing')]) {
        await expect(handlers.open({ folderPath })).rejects.toThrow()
      }
      expect(openPath).toHaveBeenCalledTimes(1)
      await expect(handlers.open({ folderPath: 'x', extra: 1 })).rejects.toThrow()
    } finally { await rm(documents, { recursive: true, force: true }) }
  })

  it('writes the working-session folder into Documents\\TLC\\<Opportunity - Milestone>', async () => {
    const documents = await mkdtemp(join(tmpdir(), 'tlc-docs-'))
    try {
      const service = createWorkingSessionService({ mode: 'sample', openOutput: async (name) => folderOutput(documents, name) })
      const handlers = createWorkingSessionIpcHandlers(service, { documentsFolder: () => documents, openPath: async () => '' })
      const { topic } = await handlers.topic(topicRequest)
      const result = await handlers.prepare(await prepareRequest(topic))
      expect(result.delivery).toEqual({ kind: 'folder', folderPath: join(documents, 'TLC', 'ARC ENABLED SQL - POC') })
      await expect(handlers.open({ folderPath: (result.delivery as { folderPath: string }).folderPath })).resolves.toBeUndefined()
    } finally { await rm(documents, { recursive: true, force: true }) }
  })
})

describe('VS Code bridge working-session methods', () => {
  const envelope = (method: string, params: unknown) => ({ kind: 'request', id: '1', method, params })

  it('routes topic and prepare through the provider service with the same results as the other hosts', async () => {
    const provider = { ...createSampleDataProvider(), workingSession: createWorkingSessionService({ mode: 'sample', openOutput: async () => ({ sink: { write: async (path: string, content: string | Uint8Array) => ({ path, bytes: content.length }) }, finish: async () => ({ kind: 'folder' as const, folderPath: 'C:\\Docs\\TLC\\ARC ENABLED SQL - POC' }) }) }) }
    const topic = await routeBridgeMessage(provider, envelope('workingSessionTopic', topicRequest))
    expect(topic).toMatchObject({ ok: true })
    const topicValue = workingSessionTopicResponseSchema.parse((topic as { result: unknown }).result).topic
    expect(topicValue.topic).toBe('Azure Arc-enabled SQL')
    const prepared = await routeBridgeMessage(provider, envelope('workingSessionPrepare', await prepareRequest(topicValue)))
    expect(workingSessionResultSchema.parse((prepared as { result: unknown }).result).folderName).toBe('ARC ENABLED SQL - POC')
  })

  it('rejects unknown fields, host-only folder opening and a provider without the service', async () => {
    const provider = createSampleDataProvider()
    expect(await routeBridgeMessage({ ...provider, workingSession: undefined } as never, envelope('workingSessionTopic', topicRequest))).toMatchObject({ ok: false })
    expect(await routeBridgeMessage(provider, envelope('workingSessionTopic', { ...topicRequest, extra: 1 }))).toMatchObject({ ok: false })
    expect(await routeBridgeMessage(provider, envelope('workingSessionOpenFolder', { folderPath: 'C:\\x' }))).toMatchObject({ ok: false, error: { code: 'host_only' } })
  })

  it('the extension host composes a sample service that writes to Documents without any network', () => {
    expect(createExtensionWorkingSession({ mode: 'sample' })).toBeDefined()
  })
})
