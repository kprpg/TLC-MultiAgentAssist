import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import JSZip from 'jszip'

export interface WrittenArtifact { path: string; bytes: number }

/** Where generated working-session files go. The core never touches the file system directly. */
export interface ArtifactSink {
  write(relativePath: string, content: string | Uint8Array): Promise<WrittenArtifact>
}

export function assertSafeRelativePath(value: string): string {
  const parts = value.split(/[\\/]/)
  if (!value || /^([a-zA-Z]:|[\\/])/.test(value) || parts.some((part) => part === '' || part === '.' || part === '..' || part.length > 150)
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f<>:"|?*]/.test(value)) {
    throw new Error('The working-session file path is not allowed.')
  }
  return parts.join('/')
}

const toBytes = (content: string | Uint8Array): Uint8Array => typeof content === 'string' ? Buffer.from(content, 'utf8') : content
const sameBytes = (left: Uint8Array, right: Uint8Array) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0

function numbered(path: string, attempt: number): string {
  const extension = extname(path)
  return `${path.slice(0, path.length - extension.length)} (${attempt})${extension}`
}

/** Writes below one root folder. Never overwrites a different existing file, never follows a link out of the root. */
export class FolderSink implements ArtifactSink {
  constructor(readonly root: string) {}

  async write(relativePath: string, content: string | Uint8Array): Promise<WrittenArtifact> {
    const safe = assertSafeRelativePath(relativePath)
    const bytes = toBytes(content)
    await mkdir(this.root, { recursive: true })
    const realRoot = await realpath(this.root)
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const candidate = attempt === 1 ? safe : numbered(safe, attempt)
      const target = resolve(realRoot, candidate)
      if (!target.startsWith(realRoot + sep)) throw new Error('The working-session file path is not allowed.')
      await mkdir(dirname(target), { recursive: true })
      const realParent = await realpath(dirname(target))
      if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) throw new Error('The working-session file path is not allowed.')
      const existing = await lstat(target).catch(() => undefined)
      if (!existing) {
        await writeFile(target, bytes, { flag: 'wx' })
        return { path: candidate, bytes: bytes.length }
      }
      if (existing.isSymbolicLink() || !existing.isFile()) continue
      if (sameBytes(await readFile(target), bytes)) return { path: candidate, bytes: bytes.length }
    }
    throw new Error('Could not choose a free file name in the working-session folder.')
  }
}

/** Collects files in memory and produces one zip. Used by hosted Web and Teams, which cannot write to the user's disk. */
export class ZipSink implements ArtifactSink {
  private readonly zip = new JSZip()
  private readonly names = new Set<string>()
  private total = 0
  /** Large files (decks) may use only `maximumBytes - reserveBytes`, so the README and manifest always fit. */
  constructor(private readonly rootFolder: string, private readonly maximumBytes = 40_000_000, private readonly reserveBytes = 2_000_000, private readonly largeFileBytes = 1_000_000) {}

  async write(relativePath: string, content: string | Uint8Array): Promise<WrittenArtifact> {
    const safe = assertSafeRelativePath(relativePath)
    const bytes = toBytes(content)
    const limit = bytes.length > this.largeFileBytes ? this.maximumBytes - this.reserveBytes : this.maximumBytes
    if (this.total + bytes.length > limit) throw new Error('The working-session download is larger than the allowed size.')
    let path = safe
    for (let attempt = 2; this.names.has(path.toLowerCase()); attempt += 1) path = numbered(safe, attempt)
    this.names.add(path.toLowerCase())
    this.total += bytes.length
    this.zip.file(`${this.rootFolder}/${path}`, bytes)
    return { path, bytes: bytes.length }
  }

  async finish(): Promise<Uint8Array> {
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  }
}

/** Test and sample sink. */
export class MemorySink implements ArtifactSink {
  readonly files = new Map<string, Uint8Array>()
  async write(relativePath: string, content: string | Uint8Array): Promise<WrittenArtifact> {
    const safe = assertSafeRelativePath(relativePath)
    const bytes = toBytes(content)
    this.files.set(safe, bytes)
    return { path: safe, bytes: bytes.length }
  }
  text(path: string): string | undefined {
    const value = this.files.get(path)
    return value ? Buffer.from(value).toString('utf8') : undefined
  }
}

export const contentHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
