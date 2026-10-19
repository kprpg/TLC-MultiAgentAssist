import { z } from 'zod'
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
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly onAuthenticationRequired?: (claims?: string) => void,
    private readonly isCurrentToken?: (token: string) => boolean
  ) {}
  private assertCurrentToken(token: string): void {
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
    const response = await fetch(`/api/teams/${path}`, {
      method: input === undefined ? 'GET' : 'POST', credentials: 'omit',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(input === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      ...(signal ? { signal } : {})
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
  session() { return this.request('session', teamsSessionSchema) }
  operation<T>(name: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.request(`operations/${encodeURIComponent(name)}`, schema, input, signal)
  }
  preview(operation: string, input: unknown): Promise<ActionPreview> {
    return this.request('actions/preview', actionPreviewSchema, { operation, input })
  }
  commit(preview: ActionPreview, reason: string): Promise<ActionReceipt> {
    const approval = actionApprovalSchema.parse({ contractVersion: collaborationVersion, id: preview.id, digest: preview.digest, reason })
    return this.request('actions/commit', actionReceiptSchema, approval)
  }
}
export type ReviewAction = (operation: string, input: Record<string, unknown>) => Promise<ActionReceipt>
export type ReviewPreview = (preview: ActionPreview) => Promise<ActionReceipt>
