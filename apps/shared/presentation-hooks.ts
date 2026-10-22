import { useEffect, useId, useRef } from 'react'
import type { SessionPortfolio } from './session-portfolio.js'
import type { MutationSyncClient } from './mutation-sync.js'

export interface PresentationClient {
  cacheSession?: SessionPortfolio
  mutationSession?: MutationSyncClient
  setActiveReads?(keys: readonly string[], active: boolean, consumer?: string): void | Promise<void>
}

export function usePresentationSession(client: PresentationClient, keys: readonly string[], options: {
  opportunityId?: string
  onChanged(): void | Promise<void>
  onReset?(): void
  onError(error: unknown): void
}): void {
  const current = useRef(options)
  const consumer = useId()
  current.current = options
  const key = keys.join('\n')
  const activeKey = useRef(key)
  activeKey.current = key
  useEffect(() => {
    const cache = client.cacheSession
    if (!cache) return
    let generation = cache.cache.generation
    let dataRevision = cache.getState().dataRevision
    let mutationRevision = client.mutationSession?.getSnapshot().revision
    const changed = () => {
      if (generation !== cache.cache.generation) {
        generation = cache.cache.generation
        client.mutationSession?.reset()
        current.current.onReset?.()
        return
      }
      if (!activeKey.current || document.visibilityState === 'hidden' || !document.hasFocus()) return
      const state = cache.getState()
      const nextMutation = client.mutationSession?.getSnapshot().revision
      if (!state.refreshing && !state.error && (dataRevision !== state.dataRevision || mutationRevision !== nextMutation)) {
        dataRevision = state.dataRevision; mutationRevision = nextMutation
        void Promise.resolve(current.current.onChanged()).catch((error: unknown) => current.current.onError(error))
      }
    }
    const stopCache = cache.subscribe(changed)
    const stopMutations = client.mutationSession?.subscribe(changed)
    void client.mutationSession?.initialize().catch((error: unknown) => current.current.onError(error))
    return () => { stopCache(); stopMutations?.() }
  }, [client])
  useEffect(() => {
    const activeKeys = key ? key.split('\n') : []
    const update = () => {
      void Promise.resolve(client.setActiveReads?.(activeKeys, document.visibilityState !== 'hidden' && document.hasFocus(), consumer))
        .catch((error: unknown) => current.current.onError(error))
    }
    const closing = (event: BeforeUnloadEvent) => {
      if (client.mutationSession?.hasPending()) { event.preventDefault(); event.returnValue = 'Confirmed source changes are still pending.' }
    }
    const editing = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
      const context = target.closest<HTMLElement>('[data-draft-opportunity-id]')
      const opportunityId = context?.dataset.draftOpportunityId ?? current.current.opportunityId
      if (!opportunityId) return
      const editor = target.closest<HTMLElement>('[data-draft-field]')
      const label = `${target.getAttribute('aria-label') ?? ''} ${[...(target.labels ?? [])].map((item) => item.textContent).join(' ')}`
      const field = editor?.dataset.draftField ?? (/risk|blocker/i.test(label) ? 'riskDetails' : /comment|note/i.test(label) ? 'comments'
        : /commitment/i.test(label) ? 'commitment' : /status/i.test(label) ? 'status'
          : target instanceof HTMLInputElement && target.type === 'date' ? 'targetDate' : undefined)
      if (!field) return
      const milestoneId = target.closest<HTMLElement>('[data-draft-milestone-id]')?.dataset.draftMilestoneId
      client.cacheSession?.captureField(opportunityId, field, field === 'recordedStage' ? Number(editor?.dataset.draftSourceValue) : target.value,
        milestoneId ? { milestoneId } : {})
    }
    update()
    window.addEventListener('focus', update); window.addEventListener('blur', update)
    window.addEventListener('online', update); document.addEventListener('visibilitychange', update)
    window.addEventListener('beforeunload', closing); document.addEventListener('focusin', editing)
    return () => {
      void Promise.resolve(client.setActiveReads?.([], false, consumer)).catch((error: unknown) => current.current.onError(error))
      window.removeEventListener('focus', update); window.removeEventListener('blur', update)
      window.removeEventListener('online', update); document.removeEventListener('visibilitychange', update)
      window.removeEventListener('beforeunload', closing); document.removeEventListener('focusin', editing)
    }
  }, [client, key, consumer])
}
