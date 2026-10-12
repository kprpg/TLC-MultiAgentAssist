import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface SourceGate {
  status: 'verified' | 'unverified' | 'blocked'
  requiredForLiveMode: boolean
}

interface AccessGates {
  schemaVersion: number
  mode: 'sample' | 'live'
  decisions: Record<string, boolean>
  sources: Record<string, SourceGate>
  openItems: string[]
}

async function loadAccessGates(): Promise<AccessGates> {
  const content = await readFile(new URL('../../../config/access-gates.json', import.meta.url), 'utf8')
  return JSON.parse(content) as AccessGates
}

describe('Phase 0 access gates', () => {
  it('records approved design decisions and permits honest sample-mode development', async () => {
    const gates = await loadAccessGates()

    expect(gates.schemaVersion).toBe(1)
    expect(Object.values(gates.decisions)).not.toContain(false)
    expect(gates.mode).toBe('sample')
    expect(gates.openItems.length).toBeGreaterThan(0)
  })

  it('cannot claim live readiness while a required source is unverified', async () => {
    const gates = await loadAccessGates()
    const unavailableRequiredSources = Object.values(gates.sources).filter(
      (source) => source.requiredForLiveMode && source.status !== 'verified'
    )

    expect(unavailableRequiredSources.length).toBeGreaterThan(0)
    expect(gates.mode).not.toBe('live')
  })
})