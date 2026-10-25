import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkingSessionResult } from '../../common/contracts/working-session.js'
import type { DownloadStore } from './download-store.js'
import { FolderSink, ZipSink, type ArtifactSink } from './sinks.js'

export interface WorkingSessionOutput {
  sink: ArtifactSink
  finish(): Promise<WorkingSessionResult['delivery']>
}

/** The user's real Documents folder, including a OneDrive-redirected one. */
export async function resolveDocumentsFolder(environment: Readonly<Record<string, string | undefined>> = process.env): Promise<string> {
  const fallback = join(environment['USERPROFILE'] ?? homedir(), 'Documents')
  if (process.platform !== 'win32') return fallback
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const value = error ? undefined : /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout)?.[1]?.trim()
      resolve(value ? value.replace(/%([^%]+)%/g, (_, name: string) => environment[name] ?? process.env[name] ?? `%${name}%`) : fallback)
    })
  })
}

/** Desktop and VS Code: `Documents\TLC\<folder>`. */
export function folderOutput(documentsFolder: string, folderName: string): WorkingSessionOutput {
  const root = join(documentsFolder, 'TLC', folderName)
  return { sink: new FolderSink(root), finish: async () => ({ kind: 'folder' as const, folderPath: root }) }
}

/** Web and Teams: a zip held briefly for the signed-in user to download. */
export function zipOutput(store: DownloadStore, owner: string, folderName: string): WorkingSessionOutput {
  const sink = new ZipSink(folderName)
  return {
    sink,
    finish: async () => {
      const fileName = `${folderName}.zip`
      const stored = store.put(owner, fileName, await sink.finish())
      return { kind: 'download' as const, downloadId: stored.id, fileName, expiresAt: stored.expiresAt }
    }
  }
}
