export function sourceHttpFailure(error: unknown): { status: 401 | 403 | 429 | 503; retryAfterSeconds?: number } | undefined {
  if (!(error instanceof Error) || error.name !== 'MsxRequestError' || !('status' in error) || typeof error.status !== 'number') return undefined
  const code = error.status
  if (!Number.isInteger(code) || ![401, 403, 429].includes(code) && (code < 500 || code > 599)) return undefined
  const status = code === 401 ? 401 : code === 403 ? 403 : code === 429 ? 429 : 503
  const delay = 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
    ? Math.ceil(error.retryAfterMs / 1000) : undefined
  return { status, ...(delay === undefined ? {} : { retryAfterSeconds: delay }) }
}
