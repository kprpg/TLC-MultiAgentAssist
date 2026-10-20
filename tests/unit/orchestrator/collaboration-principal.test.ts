import { describe, expect, it } from 'vitest'
import { isLocalReadOnlyPrincipal, isLocalSourcePrincipal, requireRole, type ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const reader: ExecutionPrincipal = {
  key: 'local-source-user', tenantId: 'tenant', userId: 'user', environmentId: 'environment',
  mode: 'live', roles: [], localSourceAccess: 'read-only'
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
    const unmarked = { ...reader }
    delete unmarked.localSourceAccess
    for (const principal of [
      { ...reader, mode: 'sample' as const }, unmarked,
      { ...reader, roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] }
    ]) {
      expect(isLocalReadOnlyPrincipal(principal)).toBe(false)
      expect(() => requireRole(principal, 'TLC.Teams.User')).toThrow()
    }
  })
  it('preserves existing signed native/hosted role requirements', () => {
    const native = { ...reader, roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] }
    delete native.localSourceAccess
    expect(() => requireRole(native, 'TLC.Teams.User')).not.toThrow()
    expect(() => requireRole(native, 'TLC.Teams.Writer')).not.toThrow()
    expect(() => requireRole({ ...native, roles: ['TLC.Teams.Writer'] }, 'TLC.Teams.Writer')).toThrow()
    expect(() => requireRole(native, 'TLC.Teams.Publisher')).toThrow()
  })
  it('permits only private reviewed writes when explicitly enabled, without minting application roles', () => {
    const writer: ExecutionPrincipal = { ...reader, localSourceAccess: 'reviewed' }
    expect(isLocalSourcePrincipal(writer)).toBe(true)
    expect(isLocalReadOnlyPrincipal(writer)).toBe(false)
    expect(writer.roles).toEqual([])
    expect(() => requireRole(writer, 'TLC.Teams.User')).not.toThrow()
    expect(() => requireRole(writer, 'TLC.Teams.Writer')).not.toThrow()
    for (const role of ['TLC.Teams.Publisher', 'TLC.Teams.ContextAdmin']) expect(() => requireRole(writer, role)).toThrow()
    expect(() => requireRole({ ...writer, mode: 'sample' }, 'TLC.Teams.Writer')).toThrow()
    expect(() => requireRole({ ...writer, roles: ['TLC.Teams.User', 'TLC.Teams.Writer'] }, 'TLC.Teams.Writer')).toThrow()
  })
})
