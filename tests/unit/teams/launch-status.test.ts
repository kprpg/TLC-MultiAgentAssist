import { describe, expect, it } from 'vitest'
import { TeamsLaunchMonitor } from '../../../apps/teams/src/launch-status.js'
import { teamsLaunchVersion, type TeamsLaunchIdentity } from '../../../packages/common/contracts/teams-launch.js'

const identity: TeamsLaunchIdentity = {
  contractVersion: teamsLaunchVersion, runId: '1'.repeat(32), clientBuildId: '22222222-2222-4222-8222-222222222222',
  packageId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b', packageVersion: '1.2484.12345',
  origin: 'https://localhost:3978', mode: 'live', authentication: 'local-azure-cli'
}
const report = { contractVersion: teamsLaunchVersion, runId: identity.runId, clientBuildId: identity.clientBuildId, packageVersion: identity.packageVersion, host: 'teams' }
describe('truthful Teams client acknowledgements', () => {
  it('does not infer client readiness from a running backend, and distinguishes a browser preview', () => {
    const monitor = new TeamsLaunchMonitor(identity)
    expect(monitor.status().clients).toEqual([])
    monitor.report({ ...report, host: 'browser' })
    expect(monitor.status().clients.map((client) => client.host)).toEqual(['browser'])
  })
  it('rejects another runtime or stale client build without recording readiness', () => {
    const monitor = new TeamsLaunchMonitor(identity)
    expect(() => monitor.report({ ...report, runId: '2'.repeat(32) })).toThrow()
    expect(() => monitor.report({ ...report, clientBuildId: '33333333-3333-4333-8333-333333333333' })).toThrow()
    expect(() => monitor.report({ ...report, packageVersion: '0.1.3' })).toThrow()
    expect(monitor.status().clients).toEqual([])
  })
  it('ties a client to its server-derived page code and removes revoked/expired heartbeats', () => {
    let now = Date.now()
    let active = true
    const monitor = new TeamsLaunchMonitor(identity, () => active, () => now)
    monitor.report(report, 'A1B2C3D4')
    expect(monitor.status().clients).toMatchObject([{ host: 'teams', pairingCode: 'A1B2C3D4' }])
    active = false
    expect(monitor.status().clients).toEqual([])
    active = true
    monitor.report(report, 'A1B2C3D4')
    now += 30_001
    expect(monitor.status().clients).toEqual([])
    monitor.report(report, 'A1B2C3D4', now + 1000)
    now += 1001
    expect(monitor.status().clients).toEqual([])
  })
  it('retains a Teams acknowledgement when a separate browser preview reports', () => {
    const monitor = new TeamsLaunchMonitor(identity)
    monitor.report(report)
    monitor.report({ ...report, host: 'browser' })
    expect(monitor.status().clients.map((client) => client.host)).toEqual(['teams', 'browser'])
  })
})
