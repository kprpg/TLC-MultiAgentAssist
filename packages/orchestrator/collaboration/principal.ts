export interface PrincipalIdentity {
  tenantId: string
  userId: string
  environmentId: string
}
export interface ExecutionPrincipal extends PrincipalIdentity {
  key: string
  roles: readonly string[]
  mode: 'sample' | 'live'
  expiresAt?: number
  // Minted only by the protected local owner after delegated source identity verification, never from browser input.
  localReadOnly?: boolean
}

export function principalPartition(principal: PrincipalIdentity): string {
  return `${principal.tenantId}:${principal.environmentId}:${principal.userId}`
}

export function requireRole(principal: ExecutionPrincipal, role: string): void {
  if (principal.localReadOnly === true) {
    if (role === 'TLC.Teams.User' && isLocalReadOnlyPrincipal(principal)) return
    throw new Error('This local source connection is read-only.')
  }
  if (!principal.roles.includes('TLC.Teams.User') || !principal.roles.includes(role)) {
    throw new Error('This operation is not authorized for the current user.')
  }
}

export function isLocalReadOnlyPrincipal(principal: ExecutionPrincipal): boolean {
  return principal.mode === 'live' && principal.localReadOnly === true && principal.roles.length === 0
}
