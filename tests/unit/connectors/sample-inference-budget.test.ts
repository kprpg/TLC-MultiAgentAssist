import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardedInferenceFetch, SampleInferenceBudget } from '../../../packages/connectors/foundry/sample-budget.js'

const directories: string[] = []
const budgets: SampleInferenceBudget[] = []
afterEach(async () => {
  for (const budget of budgets.splice(0)) budget.close()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
function budget(path = ':memory:', now = Date.now) {
  const instance = new SampleInferenceBudget(path, now)
  budgets.push(instance)
  return instance
}

describe('sample-only inference admission', () => {
  it('admits 20 provider attempts per minute and no more than 25 concurrent calls', () => {
    let now = Date.UTC(2026, 0, 1)
    const store = budget(':memory:', () => now)
    const releases = Array.from({ length: 20 }, () => store.acquire())
    expect(() => store.acquire()).toThrow('quota exhausted')
    now += 60_000
    releases.push(...Array.from({ length: 5 }, () => store.acquire()))
    expect(() => store.acquire()).toThrow('concurrency')
    releases[0]!()
    releases[0]!()
    const release = store.acquire()
    expect(() => store.acquire()).toThrow('concurrency')
    release()
    for (const done of releases) done()
  })

  it('admits exactly 500 daily attempts, preserves them across restarts and resets at UTC rollover', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-inference-quota-'))
    directories.push(directory)
    let now = Date.UTC(2026, 0, 1)
    const path = join(directory, 'usage.sqlite')
    const first = budget(path, () => now)
    for (let index = 0; index < 500; index++) {
      if (index && index % 20 === 0) now += 60_000
      first.acquire()()
    }
    first.close()
    now += 60_000
    const restarted = budget(path, () => now)
    expect(() => restarted.acquire()).toThrow('quota exhausted')
    now = Date.UTC(2026, 0, 2)
    expect(() => restarted.acquire()()).not.toThrow()
  }, 15_000)

  it('fails closed when usage storage cannot be opened', () => {
    expect(() => budget('').acquire()).toThrow('storage is unavailable')
  })

  it('guards real transport attempts, disables tools and holds concurrency until the response is consumed', async () => {
    const release = vi.fn()
    const admission = { acquire: vi.fn(() => release) }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: done\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const send = guardedInferenceFetch('https://example.services.ai.azure.com/api/projects/demo', { admission, fetcher })
    const response = await send('https://example.services.ai.azure.com/api/projects/demo/openai/v1/responses', {
      method: 'POST', body: JSON.stringify({ input: 'synthetic context', max_output_tokens: 99_999 })
    })
    expect(admission.acquire).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    const request = fetcher.mock.calls[0]![0]
    expect(request).toBeInstanceOf(Request)
    expect((request as Request).redirect).toBe('error')
    expect(await (request as Request).json()).toMatchObject({ tools: [], tool_choice: 'none', max_output_tokens: 18_000 })
    await response.text()
    expect(release).toHaveBeenCalledOnce()
    await expect(send('https://unapproved.example.test/responses', { method: 'POST', body: '{}' })).rejects.toThrow('Only configured')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('releases active admission on cancellation or connection failure, never admitting non-HTTPS projects or tools', async () => {
    const release = vi.fn()
    const admission = { acquire: vi.fn(() => release) }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream()))
      .mockRejectedValueOnce(new Error('synthetic connection failure'))
    const endpoint = 'https://example.services.ai.azure.com/api/projects/demo'
    const send = guardedInferenceFetch(endpoint, { admission, fetcher })
    const url = `${endpoint}/openai/v1/responses`
    const response = await send(url, { method: 'POST', body: '{}' })
    await response.body!.cancel()
    expect(release).toHaveBeenCalledOnce()
    await expect(send(url, { method: 'POST', body: '{}' })).rejects.toThrow('connection failure')
    expect(release).toHaveBeenCalledTimes(2)
    await expect(send(url, { method: 'POST', body: JSON.stringify({ tools: [{ type: 'web_search' }] }) })).rejects.toThrow('cannot request remote tools')
    expect(admission.acquire).toHaveBeenCalledTimes(2)
    await expect(send(url, { method: 'POST', body: '{}', signal: AbortSignal.abort() })).rejects.toThrow()
    expect(admission.acquire).toHaveBeenCalledTimes(2)
    expect(() => guardedInferenceFetch('http://example.test/projects/demo')).toThrow('HTTPS')
  })
})
