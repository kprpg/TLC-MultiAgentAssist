import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
export const voiceWorkerFile = 'voice/vosk-worker.js'
export const voiceWorkerCsp = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self';"

export async function voiceWorkerAssets() {
  const library = await readFile(require.resolve('vosk-browser'), 'utf8')
  const worker = /var WorkerFactory = createBase64WorkerFactory\('([A-Za-z0-9+/=]+)', null, false\);/.exec(library)
  if (!worker) throw new Error('The pinned offline voice library worker layout changed; update the build adapter before shipping.')
  const source = Buffer.from(worker[1], 'base64').toString('utf8')
  const body = source.substring(source.indexOf('\n', 10) + 1)
  return {
    worker: body,
    library: library.replace(worker[0], `var WorkerFactory = function(options) { return new Worker(new URL('${voiceWorkerFile}', new URL('.', document.baseURI)), options); };`)
  }
}
