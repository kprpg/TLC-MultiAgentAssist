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
}

export function principalPartition(principal: PrincipalIdentity): string {
  return `${principal.tenantId}:${principal.environmentId}:${principal.userId}`
}

export function requireRole(principal: ExecutionPrincipal, role: string): void {
  if (!principal.roles.includes('TLC.Teams.User') || !principal.roles.includes(role)) {
    throw new Error('This operation is not authorized for the current user.')
  }
}
