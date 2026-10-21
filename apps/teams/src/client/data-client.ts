import { z } from 'zod'
import type { TeamsApiBasePath, TeamsDataMode } from '../../../../packages/common/contracts/teams-data-mode.js'
import {
  actionApprovalSchema, actionPreviewSchema, actionReceiptSchema, collaborationVersion, teamsSessionSchema,
  type ActionPreview, type ActionReceipt
} from '../../../../packages/common/contracts/collaboration.js'

export class TeamsRequestError extends Error {
  constructor(readonly code: string, readonly correlationId?: string, readonly claims?: string) {
    super(`${code.replaceAll('_', ' ')}${correlationId ? ` (reference ${correlationId})` : ''}`)
    this.name = 'TeamsRequestError'
  }
}
export class TeamsApiClient {
  private readonly disposed = new AbortController()
  private readonly reads = new Map<string, { controller: AbortController; promise: Promise<unknown>; users: number }>()
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly onAuthenticationRequired?: (claims?: string) => void,
    private readonly isCurrentToken?: (token: string) => boolean,
    private readonly apiBasePath: TeamsApiBasePath = '/api/teams',
    private readonly expectedMode?: TeamsDataMode
  ) {}
  private assertCurrentToken(token: string): void {
    if (this.disposed.signal.aborted) throw new TeamsRequestError('data_mode_changed')
    if (this.isCurrentToken && !this.isCurrentToken(token)) throw new TeamsRequestError('local_connection_changed')
  }
  async request<T>(path: string, schema: z.ZodType<T>, input?: unknown, signal?: AbortSignal): Promise<T> {
    const { response, token } = await this.fetchResponse(path, input, signal)
    const value: unknown = await response.json()
    this.assertCurrentToken(token)
    return schema.parse(value)
  }
  private async fetchResponse(path: string, input?: unknown, signal?: AbortSignal): Promise<{ response: Response; token: string }> {
    const token = await this.getToken()
    this.assertCurrentToken(token)
    const response = await fetch(`${this.apiBasePath}/${path}`, {
      method: input === undefined ? 'GET' : 'POST', credentials: 'omit',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(input === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.any([this.disposed.signal, ...(signal ? [signal] : [])])
    })
    this.assertCurrentToken(token)
    if (!response.ok) {
      const error = z.object({ error: z.string(), correlationId: z.string().optional(), claims: z.string().max(8192).optional() }).parse(await response.json())
      this.assertCurrentToken(token)
      if (response.status === 401) this.onAuthenticationRequired?.(error.claims)
      throw new TeamsRequestError(error.error, error.correlationId, error.claims)
    }
    return { response, token }
  }
  async download(path: string, input: unknown, name: string): Promise<void> {
    const { response, token } = await this.fetchResponse(path, input)
    const blob = await response.blob()
    this.assertCurrentToken(token)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  async session() {
    const session = await this.request('session', teamsSessionSchema)
    if (this.expectedMode && session.mode !== this.expectedMode) throw new TeamsRequestError('data_mode_session_mismatch')
    return session
  }
  operation<T>(name: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    if (!['getPortfolioIndex', 'getPortfolioWorkspace', 'discoverOpportunities', 'listMilestones', 'listDiscoverableMilestones'].includes(name)) {
      return this.request(`operations/${encodeURIComponent(name)}`, schema, input, signal)
    }
    if (signal?.aborted) return Promise.reject(signal.reason)
    const key = `${name}:${JSON.stringify(input)}`
    let pending = this.reads.get(key)
    if (!pending) {
      const controller = new AbortController()
      pending = { controller, promise: this.request(`operations/${encodeURIComponent(name)}`, z.unknown(), input, controller.signal), users: 0 }
      this.reads.set(key, pending)
      const current = pending
      const cleanup = () => { if (this.reads.get(key) === current) this.reads.delete(key) }
      void pending.promise.then(cleanup, cleanup)
    }
    const current = pending
    current.users++
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const release = () => {
        if (finished) return false
        finished = true; signal?.removeEventListener('abort', abort)
        if (--current.users === 0) {
          current.controller.abort()
          if (this.reads.get(key) === current) this.reads.delete(key)
        }
        return true
      }
      const abort = () => { if (release()) reject(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      void current.promise.then((value) => {
        if (!release()) return
        try { resolve(schema.parse(value)) } catch (error) { reject(error) }
      }, (error: unknown) => { if (release()) reject(error) })
    })
  }
  preview(operation: string, input: unknown): Promise<ActionPreview> {
    return this.request('actions/preview', actionPreviewSchema, { operation, input })
  }
  commit(preview: ActionPreview, reason: string): Promise<ActionReceipt> {
    const approval = actionApprovalSchema.parse({ contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason })
    return this.request('actions/commit', actionReceiptSchema, approval)
  }
  dispose(): void { this.disposed.abort() }
}
export type ReviewAction = (operation: string, input: Record<string, unknown>) => Promise<ActionReceipt>
export type ReviewPreview = (preview: ActionPreview) => Promise<ActionReceipt>
