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
  localSourceAccess?: 'read-only' | 'reviewed'
}

export function principalPartition(principal: PrincipalIdentity): string {
  return `${principal.tenantId}:${principal.environmentId}:${principal.userId}`
}

export function requireRole(principal: ExecutionPrincipal, role: string): void {
  if (principal.localSourceAccess !== undefined) {
    if (isLocalSourcePrincipal(principal) &&
        (role === 'TLC.Teams.User' || role === 'TLC.Teams.Writer' && principal.localSourceAccess === 'reviewed')) return
    throw new Error('This local source connection does not authorize the requested operation.')
  }
  if (!principal.roles.includes('TLC.Teams.User') || !principal.roles.includes(role)) {
    throw new Error('This operation is not authorized for the current user.')
  }
}

export function isLocalReadOnlyPrincipal(principal: ExecutionPrincipal): boolean {
  return isLocalSourcePrincipal(principal) && principal.localSourceAccess === 'read-only'
}

export function isLocalSourcePrincipal(principal: ExecutionPrincipal): boolean {
  return principal.mode === 'live' && ['read-only', 'reviewed'].includes(principal.localSourceAccess ?? '') && principal.roles.length === 0
}
