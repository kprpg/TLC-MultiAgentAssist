import { describe, expect, it } from 'vitest'
import { isLocalReadOnlyPrincipal, requireRole, type ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const reader: ExecutionPrincipal = {
  key: 'local-source-user', tenantId: 'tenant', userId: 'user', environmentId: 'environment',
  mode: 'live', roles: [], localReadOnly: true
}

describe('explicit private local read capability', () => {
  it('admits private reads without manufacturing a corporate app role', () => {
    expect(isLocalReadOnlyPrincipal(reader)).toBe(true)
    expect(() => requireRole(reader, 'TLC.Teams.User')).not.toThrow()
    expect(reader.roles).toEqual([])
  })
  it.each(['TLC.Teams.Writer', 'TLC.Teams.Publisher', 'TLC.Teams.ContextAdmin'])('cannot authorize %s', (role) => {
    expect(() => requireRole(reader, role)).toThrow()
    expect(() => requireRole({ ...reader, roles: ['TLC.Teams.User', role] }, role)).toThrow()
  })
  it('does not apply the local capability to another profile or a role-bearing principal', () => {
    for (const principal of [
      { ...reader, mode: 'sample' as const }, { ...reader, localReadOnly: false },
      { ...reader, roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] }
    ]) {
      expect(isLocalReadOnlyPrincipal(principal)).toBe(false)
      expect(() => requireRole(principal, 'TLC.Teams.User')).toThrow()
    }
  })
  it('preserves existing signed native/hosted role requirements', () => {
    const native = { ...reader, localReadOnly: false, roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] }
    expect(() => requireRole(native, 'TLC.Teams.User')).not.toThrow()
    expect(() => requireRole(native, 'TLC.Teams.Writer')).not.toThrow()
    expect(() => requireRole({ ...native, roles: ['TLC.Teams.Writer'] }, 'TLC.Teams.Writer')).toThrow()
    expect(() => requireRole(native, 'TLC.Teams.Publisher')).toThrow()
  })
})
