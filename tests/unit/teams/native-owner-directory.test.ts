import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareOwnerDirectory, readOwnerStateKey } from '../../../apps/teams/src/local-owner-control.js'
import { temporaryRoot } from './test-temp-root.js'

let root: string
beforeAll(async () => { root = await mkdtemp(join(temporaryRoot, 'tlc-native-owner-test-')) })
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })
describe.skipIf(process.platform !== 'win32')('Windows owner-only local control material', () => {
  it('persists only a private state key and never needs source sign-in to prepare an installation', async () => {
    const directory = join(root, 'private')
    await prepareOwnerDirectory(directory)
    const first = await readOwnerStateKey(directory)
    expect(Buffer.from(first, 'base64')).toHaveLength(32)
    await prepareOwnerDirectory(directory)
    expect(await readOwnerStateKey(directory)).toBe(first)
  }, 40_000)
  it('rejects an existing inherited-ACL directory instead of silently trusting or changing it', async () => {
    const directory = join(root, 'untrusted')
    await mkdir(directory)
    await expect(readOwnerStateKey(directory)).rejects.toThrow(/owner.*SYSTEM/i)
    await expect(prepareOwnerDirectory(directory)).rejects.toThrow(/owner.*SYSTEM/i)
  }, 40_000)
})
