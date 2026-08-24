import { readFile } from 'node:fs/promises'

const gates = JSON.parse(await readFile(new URL('../config/access-gates.json', import.meta.url), 'utf8'))
const blockedRequiredSources = Object.entries(gates.sources)
  .filter(([, source]) => source.requiredForLiveMode && source.status !== 'verified')
  .map(([name]) => name)

console.log(`Mode: ${gates.mode}`)
console.log(`Open decision/access items: ${gates.openItems.length}`)

if (gates.mode === 'live' && blockedRequiredSources.length > 0) {
  console.error(`Live mode blocked by unverified sources: ${blockedRequiredSources.join(', ')}`)
  process.exitCode = 1
} else if (blockedRequiredSources.length > 0) {
  console.log(`Live mode unavailable; sample mode remains valid: ${blockedRequiredSources.join(', ')}`)
} else {
  console.log('Required live sources are verified.')
}