import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DownloadStore } from '../../../packages/orchestrator/working-session/download-store.js'
import { fileSlug, workingSessionFolderName } from '../../../packages/orchestrator/working-session/folder-name.js'
import { assertSafeRelativePath, FolderSink, MemorySink, ZipSink } from '../../../packages/orchestrator/working-session/sinks.js'
import { folderOutput, zipOutput } from '../../../packages/orchestrator/working-session/outputs.js'

describe('working-session folder names', () => {
  it('joins opportunity and milestone and removes characters Windows rejects', () => {
    expect(workingSessionFolderName('ARC ENABLED SQL', 'POC')).toBe('ARC ENABLED SQL - POC')
    expect(workingSessionFolderName('ATL CANCER CARE| AZFILES + VM DR', 'Phase 1: "Pilot"?')).toBe('ATL CANCER CARE AZFILES + VM DR - Phase 1 Pilot')
  })

  it('neutralises traversal text, trailing dots, reserved device names and empty input', () => {
    expect(workingSessionFolderName('..\\..\\Windows', '../x')).not.toMatch(/[\\/]/)
    expect(workingSessionFolderName('Name.', '.')).toBe('Name. -')
    expect(workingSessionFolderName('///', '***')).toBe('-')
    expect(workingSessionFolderName('', '')).not.toBe('')
    expect(workingSessionFolderName('nul', 'nul').startsWith('nul')).toBe(true)
  })

  it('caps long names deterministically with a hash so two long names do not collide', () => {
    const left = workingSessionFolderName('A'.repeat(300), 'one')
    const right = workingSessionFolderName('A'.repeat(300), 'two')
    expect(left.length).toBeLessThanOrEqual(120)
    expect(left).not.toBe(right)
    expect(workingSessionFolderName('A'.repeat(300), 'one')).toBe(left)
  })

  it('makes safe file slugs', () => {
    expect(fileSlug('Azure Arc: Überblick & Setup!')).toBe('azure-arc-uberblick-setup')
    expect(fileSlug('???')).toBe('item')
  })
})

describe('artifact path safety', () => {
  it.each(['../x', '..\\x', '/abs', 'C:\\x', 'a/../b', 'a//b', '', './a', 'a/b:c', 'a|b'])('rejects %s', (path) => {
    expect(() => assertSafeRelativePath(path)).toThrow()
  })
  it('accepts nested relative paths', () => expect(assertSafeRelativePath('learn/01-a.md')).toBe('learn/01-a.md'))
})

describe('FolderSink', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'tlc-ws-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('writes nested files under the root', async () => {
    const sink = new FolderSink(join(root, 'TLC', 'Opp - MS'))
    const written = await sink.write('learn/01-a.md', '# hi')
    expect(written).toEqual({ path: 'learn/01-a.md', bytes: 4 })
    expect(await readFile(join(root, 'TLC', 'Opp - MS', 'learn', '01-a.md'), 'utf8')).toBe('# hi')
  })

  it('keeps an identical re-run in place and never overwrites different content', async () => {
    const sink = new FolderSink(join(root, 'f'))
    await sink.write('a.md', 'one')
    expect((await sink.write('a.md', 'one')).path).toBe('a.md')
    expect((await sink.write('a.md', 'two')).path).toBe('a (2).md')
    expect((await sink.write('a.md', 'three')).path).toBe('a (3).md')
    expect(await readFile(join(root, 'f', 'a.md'), 'utf8')).toBe('one')
  })

  it('refuses a path that escapes the root', async () => {
    await expect(new FolderSink(join(root, 'f')).write('../evil.txt', 'x')).rejects.toThrow('not allowed')
  })

  it('does not follow a directory link out of the root', async () => {
    const outside = join(root, 'outside'); await mkdir(outside)
    const inside = join(root, 'f'); await mkdir(inside)
    try { await symlink(outside, join(inside, 'link'), 'junction') } catch { return }
    await expect(new FolderSink(inside).write('link/pwn.txt', 'x')).rejects.toThrow('not allowed')
    await expect(readFile(join(outside, 'pwn.txt'))).rejects.toThrow()
  })

  it('does not write through a file link', async () => {
    const inside = join(root, 'f'); await mkdir(inside)
    await writeFile(join(root, 'secret.txt'), 'original')
    try { await symlink(join(root, 'secret.txt'), join(inside, 'a.md'), 'file') } catch { return }
    expect((await new FolderSink(inside).write('a.md', 'new')).path).toBe('a (2).md')
    expect(await readFile(join(root, 'secret.txt'), 'utf8')).toBe('original')
  })
})

describe('ZipSink, MemorySink and outputs', () => {
  it('zips files under the folder name and numbers duplicates case-insensitively', async () => {
    const sink = new ZipSink('Opp - MS')
    await sink.write('a.md', 'x'); expect((await sink.write('A.md', 'y')).path).toBe('A (2).md')
    const zip = await JSZip.loadAsync(await sink.finish())
    expect(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort()).toEqual(['Opp - MS/A (2).md', 'Opp - MS/a.md'])
  })

  it('enforces the total size cap, but keeps headroom so small metadata files always fit after large decks', async () => {
    await expect(new ZipSink('f', 10, 0, 100).write('a.bin', new Uint8Array(11))).rejects.toThrow('larger')
    const sink = new ZipSink('f', 1000, 200, 100)
    await sink.write('deck.pptx', new Uint8Array(700))
    await expect(sink.write('deck2.pptx', new Uint8Array(200))).rejects.toThrow('larger')
    await expect(sink.write('README.md', 'x'.repeat(90))).resolves.toBeDefined()
    await expect(sink.write('manifest.json', 'y'.repeat(90))).resolves.toBeDefined()
  })

  it('MemorySink stores text for tests', async () => {
    const sink = new MemorySink(); await sink.write('a/b.txt', 'hello')
    expect(sink.text('a/b.txt')).toBe('hello')
  })

  it('folderOutput places files in Documents\\TLC\\<name> and reports the folder', async () => {
    const output = folderOutput('C:\\Users\\x\\Documents', 'Opp - MS')
    expect(await output.finish()).toEqual({ kind: 'folder', folderPath: join('C:\\Users\\x\\Documents', 'TLC', 'Opp - MS') })
  })

  it('zipOutput stores the zip for its owner only', async () => {
    const store = new DownloadStore()
    const output = zipOutput(store, 'alice@contoso.com', 'Opp - MS')
    await output.sink.write('a.md', 'x')
    const delivery = await output.finish()
    expect(delivery.kind).toBe('download')
    if (delivery.kind !== 'download') return
    expect(delivery.fileName).toBe('Opp - MS.zip')
    expect(store.get('alice@contoso.com', delivery.downloadId)?.bytes.length).toBeGreaterThan(0)
    expect(store.get('bob@contoso.com', delivery.downloadId)).toBeUndefined()
  })
})

describe('DownloadStore', () => {
  it('expires entries and keeps at most three per owner', () => {
    let now = 1000
    const store = new DownloadStore(5000, 3, () => now)
    const ids = [1, 2, 3, 4].map((index) => store.put('a', `f${index}.zip`, new Uint8Array([index])).id)
    expect(store.get('a', ids[0]!)).toBeUndefined()
    expect(store.get('a', ids[3]!)?.fileName).toBe('f4.zip')
    now += 6000
    expect(store.get('a', ids[3]!)).toBeUndefined()
  })
})
