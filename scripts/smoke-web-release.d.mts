export function smokeWebRelease(packageRoot?: string): Promise<void>

export interface FetchWithRetryOptions {
  attempts?: number
  delayMs?: number
  fetchFn?: typeof fetch
}

export function fetchWithRetry(url: string, options?: FetchWithRetryOptions): Promise<Response>
