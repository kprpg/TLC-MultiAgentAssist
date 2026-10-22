import { cachePolicySchema, type CachePolicy, type CacheReadState } from '../../packages/common/contracts/cache-sync.js'

export class CacheCapacityError extends Error {
  constructor() { super('The complete source snapshot exceeds the supported memory cache. Reduce the source scope before retrying.'); this.name = 'CacheCapacityError' }
}
const aborted = () => new DOMException('The source session changed.', 'AbortError')
const status = (error: unknown): number | undefined => error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
const waitForRetry = (delay: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, Math.max(1, delay))
  timer.unref?.()
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
})

export interface SessionCacheOptions {
  policy?: Partial<CachePolicy>
  now?: () => number
  active?: boolean
}

export class SessionCache {
  readonly policy: CachePolicy
  readonly now: () => number
  generation = 0
  private revision = 0
  private dataRevision = 0
  private state: CacheReadState = { revision: 0, dataRevision: 0, generation: 0, refreshing: false, stale: false }
  private readonly entries = new Map<string, SessionCacheValue<unknown>>()
  private readonly listeners = new Set<() => void>()
  private active: boolean
  private activeKeys = new Set<string>()
  private pinnedKeys = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshJob: Promise<void> | undefined
  private disposed = false
  private batchDepth = 0
  private batchChanged = false
  private scopeError: unknown
  private lifetime = new AbortController()
  private sourceState: CacheReadState | undefined

  constructor(options: SessionCacheOptions = {}) {
    this.policy = cachePolicySchema.parse(options.policy ?? {})
    this.now = options.now ?? Date.now
    this.active = options.active ?? false
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly getRevision = (): number => this.revision
  readonly getState = (): CacheReadState => this.state

  value<T>(key: string, reference = false): SessionCacheValue<T> {
    const existing = this.entries.get(key)
    if (existing) return existing as SessionCacheValue<T>
    const entry = new SessionCacheValue<T>(this, key, reference)
    this.entries.set(key, entry as SessionCacheValue<unknown>)
    this.admit(entry as SessionCacheValue<unknown>, 0)
    return entry
  }
  existing<T>(key: string): SessionCacheValue<T> | undefined { return this.entries.get(key) as SessionCacheValue<T> | undefined }

  setActive(active: boolean): void { this.active = active; this.changed() }
  setActiveKeys(keys: readonly string[]): void { this.activeKeys = new Set(keys); this.changed() }
  setPinnedKeys(keys: readonly string[]): void { this.pinnedKeys = new Set(keys); this.changed() }
  has(key: string): boolean { return this.entries.get(key)?.loaded ?? false }
  invalidate(key: string): void { this.entries.get(key)?.invalidate() }
  updateMatching(prefix: string, update: (value: unknown) => unknown): void {
    this.batch(() => {
      for (const entry of this.entries.values()) if (entry.key.startsWith(prefix) && (entry.loaded || entry.refreshing)) entry.update(update)
    })
  }
  invalidateAll(): void { this.batch(() => { for (const entry of this.entries.values()) entry.invalidate() }) }
  clear(error?: unknown): void {
    this.generation++
    this.lifetime.abort(aborted())
    this.lifetime = new AbortController()
    this.scopeError = error
    this.sourceState = undefined
    for (const entry of this.entries.values()) entry.clear()
    this.dataChanged()
  }
  dispose(): void { this.disposed = true; this.clear(); this.listeners.clear(); if (this.timer) clearTimeout(this.timer) }

  changed(): void {
    if (this.batchDepth) { this.batchChanged = true; return }
    const entries = [...this.entries.values()]
    const fetched = entries.flatMap((entry) => entry.fetchedAt === undefined ? [] : [entry.fetchedAt])
    const error = this.scopeError ?? this.sourceState?.error ?? entries.find((entry) => entry.error)?.error
    this.state = {
      revision: ++this.revision, dataRevision: this.dataRevision, generation: this.generation,
      refreshing: this.sourceState?.refreshing === true || entries.some((entry) => entry.refreshing),
      stale: this.sourceState?.stale ?? entries.some((entry) => entry.loaded && entry.isStale()),
      ...(this.sourceState?.validatedAt !== undefined
        ? { validatedAt: this.sourceState.validatedAt, ...(this.sourceState.fetchedAt === undefined ? {} : { fetchedAt: this.sourceState.fetchedAt }) }
        : fetched.length ? { fetchedAt: Math.max(...fetched), validatedAt: Math.max(...fetched) } : {}),
      ...(error ? { error: error instanceof Error ? error.message : 'Source refresh failed.' } : {})
    }
    for (const listener of this.listeners) listener()
    this.schedule()
  }

  recovered(): void { this.scopeError = undefined }
  dataChanged(): void { this.dataRevision++; this.changed() }
  reportError(error: unknown): void { this.scopeError = error; this.changed() }
  observeSourceState(state: CacheReadState): void { this.sourceState = state; this.changed() }

  batch(action: () => void): void {
    this.batchDepth++
    try { action() } finally {
      this.batchDepth--
      if (!this.batchDepth && this.batchChanged) { this.batchChanged = false; this.changed() }
    }
  }

  admit(entry: SessionCacheValue<unknown>, bytes: number): void {
    const candidates = [...this.entries.values()].filter((item) =>
      item !== entry && !item.refreshing && !this.activeKeys.has(item.key)
      && !this.pinnedKeys.has(item.key) && !['portfolio', 'discovery'].includes(item.key)).sort((a, b) => a.accessedAt - b.accessedAt)
    let total = [...this.entries.values()].reduce((sum, item) => sum + (item === entry ? bytes : entry.derivedKeys.includes(item.key) ? 0 : item.bytes), 0)
    let inactive = candidates.length + Number(!this.activeKeys.has(entry.key) && !['portfolio', 'discovery'].includes(entry.key))
    for (const candidate of candidates) {
      if (total <= this.policy.maxSerializedBytes && inactive <= this.policy.maxInactiveEntries) break
      total -= candidate.bytes; inactive--
      candidate.clear()
      this.entries.delete(candidate.key)
    }
    if (total > this.policy.maxSerializedBytes) throw new CacheCapacityError()
  }

  canRefresh(key: string, derivedKeys: readonly string[]): boolean {
    return this.active && !this.disposed && (this.activeKeys.has(key) || derivedKeys.some((value) => this.activeKeys.has(value)))
  }

  async runRead<T>(load: () => Promise<T>, options: {
    retryAllowed?(): boolean
    notBefore?(): number
    onRetryDelay?(delay: number): void
  } = {}): Promise<T> {
    const generation = this.generation
    const signal = this.lifetime.signal
    for (let attempt = 0; ; attempt++) {
      if (this.disposed || generation !== this.generation) throw aborted()
      const notBefore = options.notBefore?.() ?? 0
      if (notBefore > this.now()) await waitForRetry(notBefore - this.now(), signal)
      if (options.retryAllowed && !options.retryAllowed()) throw aborted()
      try { return await load() } catch (error) {
        const code = status(error)
        if (code === 401 || code === 403) { this.clear(error); throw error }
        if (!(code === 429 || code !== undefined && code >= 500 || error instanceof TypeError)) throw error
        const retry = error !== null && typeof error === 'object' && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number'
          ? error.retryAfterMs : 500 * 2 ** attempt
        if (!Number.isFinite(retry) || retry > 2_147_483_647) throw error
        options.onRetryDelay?.(Math.max(1, retry))
        if (attempt >= this.policy.readRetries) throw error
        await waitForRetry(retry, signal)
      }
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.active || this.disposed || this.refreshJob) return
    const entries = [...this.entries.values()]
    const eligible = entries.filter((entry) => entry.loaded && !entry.refreshing
      && (this.activeKeys.has(entry.key) || entry.derivedKeys.some((key) => this.activeKeys.has(key)))
      && !entries.some((parent) => parent !== entry && parent.loaded && parent.derivedKeys.includes(entry.key)))
    const due = Math.min(...eligible.map((entry) => entry.nextDue()))
    if (!Number.isFinite(due)) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const pending = eligible.filter((entry) => entry.loaded && entry.isStale() && entry.nextDue() <= this.now())
      this.refreshJob = (async () => {
        for (const entry of pending) {
          if (!this.active || this.disposed) break
          if (!this.activeKeys.has(entry.key) && !entry.derivedKeys.some((key) => this.activeKeys.has(key))) continue
          try { await entry.revalidate(true) } catch { /* The entry publishes the failed/stale state to subscribers. */ }
        }
      })()
      void this.refreshJob.finally(() => { this.refreshJob = undefined; this.schedule() })
    }, Math.max(10, due - this.now()))
    this.timer.unref?.()
  }
}

export class SessionCacheValue<T> {
  private value: T | undefined
  private pending: Promise<T> | undefined
  private load: (() => Promise<T>) | undefined
  private generation = 0
  private updates: Array<(value: T) => T> = []
  private forced = false
  private requested = false
  private failedAt: number | undefined
  private retryNotBefore = 0
  fetchedAt: number | undefined
  accessedAt = 0
  bytes = 0
  error: unknown
  onLoad: ((value: T, sourceValue: T) => void) | undefined
  derivedKeys: readonly string[] = []
  get loaded(): boolean { return this.value !== undefined }
  get refreshing(): boolean { return this.pending !== undefined }

  constructor(private readonly owner: SessionCache, readonly key: string, private readonly reference = false) {}
  peek(): T | undefined { return this.value }
  isStale(): boolean { return this.forced || this.fetchedAt !== undefined && this.owner.now() >= this.fetchedAt + this.ttl() }
  nextDue(): number { return Math.max(this.forced ? this.owner.now() : (this.fetchedAt ?? this.owner.now()) + this.ttl(), this.failedAt === undefined ? 0 : this.failedAt + 30_000, this.retryNotBefore) }
  private ttl(): number { return this.reference ? this.owner.policy.referenceFreshMs : this.owner.policy.mutableFreshMs }

  read(load: () => Promise<T>): Promise<T> {
    this.load = load; this.accessedAt = this.owner.now()
    if (this.value !== undefined && !this.forced && !this.requested) {
      const generation = this.generation, scope = this.owner.generation
      return Promise.resolve().then(() => {
        if (generation !== this.generation || scope !== this.owner.generation || this.value === undefined) throw aborted()
        return structuredClone(this.value)
      })
    }
    const generation = this.generation, scope = this.owner.generation
    if (this.forced && this.pending) return this.revalidate().then(() => this.read(load))
    return this.revalidate().catch((error: unknown) => {
      if (generation === this.generation && scope === this.owner.generation) this.forced = true
      throw error
    })
  }

  revalidate(background = false): Promise<T> {
    const generation = this.generation, scope = this.owner.generation
    if (this.pending) return this.pending.then((value) => {
      if (generation !== this.generation || scope !== this.owner.generation) throw aborted()
      return structuredClone(this.value ?? value)
    })
    if (!this.load) return Promise.reject(new Error('This dataset has not been loaded.'))
    this.forced = false
    const promise = this.owner.runRead(this.load, {
      ...(background ? { retryAllowed: () => this.owner.canRefresh(this.key, this.derivedKeys) } : {}),
      notBefore: () => this.retryNotBefore,
      onRetryDelay: (delay) => { this.retryNotBefore = this.owner.now() + delay }
    }).then((value) => {
      if (generation !== this.generation || scope !== this.owner.generation) throw aborted()
      const updated = this.updates.reduce((current, update) => update(current), value)
      const json = JSON.stringify(updated)
      if (json === undefined) throw new Error('The source returned no cacheable JSON data.')
      const bytes = new TextEncoder().encode(json).byteLength
      this.owner.admit(this as SessionCacheValue<unknown>, bytes)
      this.owner.batch(() => {
        this.value = updated; this.bytes = bytes; this.fetchedAt = this.owner.now()
        if (!this.forced) this.requested = false
        this.error = undefined; this.failedAt = undefined; this.retryNotBefore = 0; this.updates = []
        this.owner.recovered()
        this.onLoad?.(updated, value)
        this.owner.dataChanged()
      })
      return updated
    }).catch((error: unknown) => {
      if (generation === this.generation && scope === this.owner.generation) {
        if (background && error instanceof DOMException && error.name === 'AbortError') {
          this.forced = true; this.failedAt = undefined
        } else { this.error = error; this.failedAt = this.owner.now() }
        this.updates = []
      }
      throw error
    }).finally(() => {
      if (this.pending === promise) { this.pending = undefined; this.owner.changed() }
    })
    this.pending = promise
    this.owner.changed()
    return promise.then((value) => {
      if (generation !== this.generation || scope !== this.owner.generation) throw aborted()
      return structuredClone(this.value ?? value)
    })
  }

  update(update: (value: T) => T): void {
    const loaded = this.value !== undefined
    if (this.value !== undefined) {
      const next = update(this.value)
      const bytes = new TextEncoder().encode(JSON.stringify(next)).byteLength
      this.owner.admit(this as SessionCacheValue<unknown>, bytes)
      this.value = next; this.bytes = bytes
    }
    if (this.pending) this.updates.push(update)
    if (loaded) this.owner.dataChanged()
    else this.owner.changed()
  }
  seed(value: T): void {
    if (this.value === undefined && !this.pending) {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
      this.owner.admit(this as SessionCacheValue<unknown>, bytes)
      this.value = structuredClone(value); this.bytes = bytes; this.fetchedAt = this.owner.now(); this.owner.dataChanged()
    }
  }
  replace(value: T): void { this.update(() => structuredClone(value)); this.seed(value) }
  replaceDerived(value: T, current = true): void {
    if (this.pending) this.updates.push(() => value)
    this.value = value; this.bytes = 0; this.fetchedAt = this.owner.now()
    if (current) { this.forced = false; this.requested = false; this.error = undefined; this.failedAt = undefined }
    this.owner.dataChanged()
  }
  invalidate(): void { this.forced = true; this.requested = true; this.failedAt = undefined; this.owner.dataChanged() }
  clear(): void {
    this.generation++; this.value = undefined; this.pending = undefined; this.updates = []
    this.forced = false; this.requested = false; this.bytes = 0; this.fetchedAt = undefined; this.failedAt = undefined; this.retryNotBefore = 0; this.error = undefined
  }
}
