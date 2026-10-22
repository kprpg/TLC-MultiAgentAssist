import { useSyncExternalStore } from 'react'
import type { CacheReadState } from '../../packages/common/contracts/cache-sync.js'

export interface ReactiveSessionData {
  subscribe(listener: () => void): () => void
  getRevision(): number
  getState(): CacheReadState
}

export function useSessionState(store: ReactiveSessionData): CacheReadState {
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision)
  return store.getState()
}
