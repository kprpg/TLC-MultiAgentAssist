import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccessToken } from '@azure/core-auth'

interface FoundrySignIn {
    attempts: number
    signal?: AbortSignal
    failure?: Error
    pending: Map<object, Map<string, Promise<AccessToken>>>
}

const signIn = new AsyncLocalStorage<FoundrySignIn>()

export function currentFoundrySignIn(): FoundrySignIn | undefined { return signIn.getStore() }

export function withFoundrySignIn<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signIn.getStore()) return operation()
    return signIn.run({ attempts: 0, pending: new Map(), ...(signal ? { signal } : {}) }, operation)
}
