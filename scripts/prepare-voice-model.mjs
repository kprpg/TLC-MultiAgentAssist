import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const voiceModelName = 'vosk-model-small-en-us-0.15.tar.gz'
export const voiceModelSha256 = 'f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const voiceModelPath = resolve(repositoryRoot, 'apps/desktop/dist/voice-models', voiceModelName)
const modelUrl = `https://ccoreilly.github.io/vosk-browser/models/${voiceModelName}`

export async function readVoiceModel() {
  const data = await readFile(voiceModelPath)
  if (createHash('sha256').update(data).digest('hex') !== voiceModelSha256) {
    throw new Error('The offline voice model checksum is invalid. Remove it and run npm run voice:model again.')
  }
  return data
}

async function prepareVoiceModel() {
  let missing = false
  try {
    await readVoiceModel()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    missing = true
  }
  if (missing) {
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Offline voice model download failed: HTTP ${response.status}.`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > 50_000_000 || createHash('sha256').update(data).digest('hex') !== voiceModelSha256) {
      throw new Error('The downloaded offline voice model did not pass the size/checksum checks.')
    }
    await mkdir(dirname(voiceModelPath), { recursive: true })
    await writeFile(voiceModelPath, data, { flag: 'wx' })
  }
  console.info('Offline English voice model is ready; no audio is sent to a speech service.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareVoiceModel()
}
