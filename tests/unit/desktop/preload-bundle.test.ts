import { resolve } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

describe('sandboxed Desktop preload bundle', () => {
  it('bundles runtime dependencies instead of requiring npm modules in the sandbox', async () => {
    const built = await build({
      configFile: resolve('apps', 'desktop', 'vite.preload.config.ts'),
      logLevel: 'silent',
      build: { write: false }
    })
    const requires = new Set<string>()
    for (const bundle of Array.isArray(built) ? built : [built]) {
      if (!('output' in bundle)) throw new Error('The preload build unexpectedly entered watch mode.')
      for (const output of bundle.output) {
        if (output.type !== 'chunk') continue
        for (const match of output.code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)) {
          if (match[2]) requires.add(match[2])
        }
      }
    }
    expect([...requires]).toEqual(['electron'])
  }, 15_000)
})
