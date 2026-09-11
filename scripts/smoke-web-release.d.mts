export function smokeWebRelease(packageRoot?: string): Promise<void>
export function fetchWithRetry(
  url: string,
  options?: { attempts?: number; delayMs?: number; fetchFn?: typeof fetch }
): Promise<Response>
