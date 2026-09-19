import type { ReactElement } from 'react'

export function PlayRoleOwners({ roles }: { roles: readonly string[] }): ReactElement {
    return <div className="play-meta play-role-owners">{roles.join(', ')}</div>
}