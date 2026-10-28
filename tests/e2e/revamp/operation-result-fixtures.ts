export function deferredSignal() {
    let resolve!: () => void
    const promise = new Promise<void>((complete) => { resolve = complete })
    return { promise, resolve }
}
