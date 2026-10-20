import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startOwnerControlTransport, sendOwnerCommand } from '../../../apps/teams/src/local-owner-control.js'
import { localConnectionVersion, nativeCapabilities } from '../../../packages/common/contracts/local-connection.js'
import { canonicalJson } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const key = randomBytes(32)
  const record = { contractVersion: localConnectionVersion, instanceId: randomUUID(), processId: process.pid, origin: 'https://localhost:3978' }
  const execute = vi.fn(async () => ({
    contractVersion: localConnectionVersion, ok: true as const,
    status: { contractVersion: localConnectionVersion, state: 'sign-in-required' as const, detail: 'Owner action required.', resources: [], capabilities: nativeCapabilities },
    pending: []
  }))
  const transport = await startOwnerControlTransport({ key, instanceId: record.instanceId, execute })
  cleanup.push(() => transport.close())
  return { key, record, execute }
}
describe('protected owner control transport', () => {
  it('mutually authenticates one explicit owner command without transmitting the control key', async () => {
    const { key, record, execute } = await fixture()
    const result = await sendOwnerCommand({ key, record, command: { contractVersion: localConnectionVersion, action: 'status' } })
    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledExactlyOnceWith({ contractVersion: localConnectionVersion, action: 'status' })
    expect(JSON.stringify(result)).not.toContain(key.toString('base64'))
  })
  it('rejects a different OS-user control key before any native action', async () => {
    const { record, execute } = await fixture()
    await expect(sendOwnerCommand({ key: randomBytes(32), record, command: { contractVersion: localConnectionVersion, action: 'connect', resource: 'msx' } })).rejects.toThrow(/owner/i)
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects unknown commands and browser-supplied privileges before dispatch', async () => {
    const { key, record, execute } = await fixture()
    await expect(sendOwnerCommand({ key, record, command: { contractVersion: localConnectionVersion, action: 'approve', userCode: 'ABCDEF12', isFte: true } })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
  it('does not replay a captured valid owner message on a fresh connection nonce', async () => {
    const { key, record, execute } = await fixture()
    const nonces: string[] = []
    const exchange = (replay?: string) => new Promise<string>((done, fail) => {
      const path = process.platform === 'win32' ? `\\\\.\\pipe\\tlc-teams-owner-${record.instanceId}` : join(tmpdir(), `tlc-owner-${record.instanceId}.sock`)
      const socket = createConnection(path)
      socket.setEncoding('utf8')
      socket.setTimeout(5000, () => socket.destroy(new Error('Owner fixture timed out.')))
      let buffer = ''
      let sent = ''
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const value: unknown = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (!sent) {
          const hello = z.object({ instanceId: z.uuid(), nonce: z.string() }).strict().parse(value)
          nonces.push(hello.nonce)
          const command = { contractVersion: localConnectionVersion, action: 'status' }
          const mac = createHmac('sha256', key).update(canonicalJson({
            version: localConnectionVersion, kind: 'request', instanceId: record.instanceId, nonce: hello.nonce, value: command
          })).digest('base64url')
          sent = replay ?? JSON.stringify({ nonce: hello.nonce, command, mac })
          socket.write(sent + '\n')
        } else socket.end()
      })
      socket.on('end', () => { socket.destroy(); done(sent) })
      socket.on('error', fail)
    })
    const captured = await exchange()
    await exchange(captured)
    expect(nonces).toHaveLength(2)
    expect(nonces[0]).not.toBe(nonces[1])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
