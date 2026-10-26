import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

export class InferenceAdmissionError extends Error {
  constructor(readonly reason: 'quota' | 'configuration', message: string) { super(message); this.name = 'InferenceAdmissionError' }
}

export interface InferenceAdmission { acquire(): () => void }
const requireModule = createRequire(import.meta.url)

/** One writable ledger per deployment slot; deliberately separate from resettable sample records. */
export class SampleInferenceBudget implements InferenceAdmission {
  private db: InstanceType<typeof import('node:sqlite').DatabaseSync> | undefined
  private active = 0
  constructor(private readonly path: string, private readonly now = Date.now,
    private readonly limits = { concurrent: 25, minute: 20, day: 500 }) {}

  acquire(): () => void {
    if (this.active >= this.limits.concurrent) throw new InferenceAdmissionError('quota', 'Sample AI concurrency limit reached.')
    try {
      if (!this.db) {
        if (!this.path.trim()) throw new Error('Missing budget path.')
        if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true })
        const { DatabaseSync } = requireModule('node:sqlite') as typeof import('node:sqlite')
        this.db = new DatabaseSync(this.path)
        this.db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS inference_quota (window TEXT PRIMARY KEY, count INTEGER NOT NULL)')
      }
      const timestamp = this.now()
      const windows = [
        { key: `minute:${Math.floor(timestamp / 60_000)}`, maximum: this.limits.minute },
        { key: `day:${new Date(timestamp).toISOString().slice(0, 10)}`, maximum: this.limits.day }
      ]
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const window of windows) {
          const count = this.db.prepare('SELECT count FROM inference_quota WHERE window=?').get(window.key)?.['count'] ?? 0
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid usage counter.')
          if (Number(count) >= window.maximum) throw new InferenceAdmissionError('quota', 'Sample AI request quota exhausted.')
        }
        for (const window of windows) this.db.prepare('INSERT INTO inference_quota(window,count) VALUES (?,1) ON CONFLICT(window) DO UPDATE SET count=count+1').run(window.key)
        this.db.prepare('DELETE FROM inference_quota WHERE window NOT IN (?,?)').run(windows[0]!.key, windows[1]!.key)
        this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    } catch (error) {
      if (error instanceof InferenceAdmissionError) throw error
      throw new InferenceAdmissionError('configuration', 'Sample AI usage storage is unavailable; real inference was denied.')
    }
    this.active++
    let released = false
    return () => { if (!released) { released = true; this.active-- } }
  }

  close(): void { this.db?.close(); this.db = undefined }
}

export function guardedInferenceFetch(endpoint: string, options: {
  admission?: InferenceAdmission
  fetcher?: typeof fetch
  timeoutMs?: number
} = {}): typeof fetch {
  const project = new URL(endpoint)
  if (project.protocol !== 'https:' || project.username || project.password) {
    throw new InferenceAdmissionError('configuration', 'Sample inference requires a credential-free HTTPS project endpoint.')
  }
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== project.origin || !url.pathname.startsWith(`${project.pathname.replace(/\/$/, '')}/`)
      || request.method !== 'POST' || !/\/(responses|chat\/completions)$/.test(url.pathname)) {
      throw new InferenceAdmissionError('configuration', 'Only configured Foundry inference endpoints are allowed.')
    }
    const text = await request.text()
    if (Buffer.byteLength(text) > 750_000) throw new InferenceAdmissionError('configuration', 'The sample inference input exceeds its bounded context size.')
    const body: unknown = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InferenceAdmissionError('configuration', 'Invalid inference request.')
    const payload: Record<string, unknown> = { ...body, tools: [], tool_choice: 'none' }
    if ('tools' in body && (!Array.isArray(body.tools) || body.tools.length)) {
      throw new InferenceAdmissionError('configuration', 'Sample inference cannot request remote tools.')
    }
    if (url.pathname.endsWith('/responses')) payload['max_output_tokens'] = Math.min(Number(payload['max_output_tokens']) || 18_000, 18_000)
    else payload['max_completion_tokens'] = Math.min(Number(payload['max_completion_tokens']) || 8192, 8192)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)])
    signal.throwIfAborted()
    const complete = options.admission?.acquire() ?? (() => {})
    let released = false
    const release = () => { if (!released) { released = true; complete() } }
    try {
      const response = await (options.fetcher ?? fetch)(new Request(request, { body: JSON.stringify(payload), signal, redirect: 'error' }))
      if (!response.body) { release(); return response }
      const reader = response.body.getReader()
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read()
            if (next.done) { release(); controller.close() }
            else controller.enqueue(next.value)
          } catch (error) { release(); controller.error(error) }
        },
        async cancel(reason) { try { await reader.cancel(reason) } finally { release() } }
      }), { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) { release(); throw error }
  }
}
