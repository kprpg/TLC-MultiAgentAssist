export function verifyAnonymousSample(baseUrl: string, options?: { sqlite?: boolean; fetchFn?: typeof fetch; aiMode?: string | undefined }): Promise<void>
export function verifyWebAccess(baseUrl: string, options?: { protectedAccess?: boolean; fetchFn?: typeof fetch }): Promise<void>
export function smokeWebRelease(packageRoot?: string, options?: {
  sqlite?: boolean
  entryPoint?: string
  onReady?: (baseUrl: string) => Promise<void>
  environment?: NodeJS.ProcessEnv
  nodeArguments?: string[]
}): Promise<void>
export function fetchWithRetry(
  url: string,
  options?: { attempts?: number; delayMs?: number; fetchFn?: typeof fetch; signal?: AbortSignal }
): Promise<Response>
