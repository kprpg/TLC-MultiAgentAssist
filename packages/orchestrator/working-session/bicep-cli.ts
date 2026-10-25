import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IacCompiler } from './iac.js'

const run = (command: string, args: string[], timeoutMs: number): Promise<{ code: number | 'missing'; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8_000_000, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command) }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr })
      const failure = error as NodeJS.ErrnoException & { code?: string | number }
      resolve({ code: failure.code === 'ENOENT' ? 'missing' : typeof failure.code === 'number' ? failure.code : 1, stdout, stderr })
    })
  })

/** Compiles Bicep to ARM with the Bicep CLI or `az bicep`. Returns `undefined` when neither is installed. */
export function createBicepCliCompiler(timeoutMs = 90_000): IacCompiler {
  return async (bicep) => {
    const directory = await mkdtemp(join(tmpdir(), 'tlc-bicep-'))
    try {
      const file = join(directory, 'main.bicep')
      await writeFile(file, bicep, 'utf8')
      const output = join(directory, 'main.json')
      const attempts: Array<[string, string[]]> = [
        ['bicep', ['build', file, '--outfile', output]],
        [process.platform === 'win32' ? 'az.cmd' : 'az', ['bicep', 'build', '--file', file, '--outfile', output]]
      ]
      let anyInstalled = false
      for (const [command, args] of attempts) {
        const result = await run(command, args, timeoutMs)
        if (result.code === 'missing') continue
        anyInstalled = true
        if (result.code === 0) return { ok: true, armJson: await readFile(output, 'utf8') }
        if (/error/i.test(result.stderr + result.stdout)) {
          return { ok: false, message: (result.stderr || result.stdout).replace(/[A-Za-z]:\\[^\s:]*/g, '<path>').split(/\r?\n/).filter((line) => /error/i.test(line)).slice(0, 3).join(' ').slice(0, 500) || 'Compilation failed.' }
        }
      }
      return anyInstalled ? { ok: false, message: 'The Bicep CLI could not be run.' } : undefined
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
