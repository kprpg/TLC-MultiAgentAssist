import {
  teamsClientReadyRequestSchema, teamsLaunchIdentitySchema, teamsLaunchStatusSchema,
  type TeamsLaunchIdentity, type TeamsLaunchStatus
} from '../../../packages/common/contracts/teams-launch.js'

export class TeamsLaunchError extends Error {
  readonly code = 'launch_client_mismatch'
}

export class TeamsLaunchMonitor {
  private readonly identity: TeamsLaunchIdentity
  private readonly clients = new Map<string, { proof: TeamsLaunchStatus['clients'][number]; expiresAt: number }>()
  constructor(identity: TeamsLaunchIdentity, private readonly isPageActive?: (code: string) => boolean, private readonly now = Date.now) {
    this.identity = teamsLaunchIdentitySchema.parse(identity)
  }
  status(): TeamsLaunchStatus {
    for (const [key, client] of this.clients) {
      if (client.expiresAt <= this.now() || client.proof.pairingCode && !this.isPageActive?.(client.proof.pairingCode)) this.clients.delete(key)
    }
    return teamsLaunchStatusSchema.parse({ ...this.identity, clients: [...this.clients.values()].map((client) => client.proof) })
  }
  report(input: unknown, pairingCode?: string, sessionExpiresAt?: number): void {
    const report = teamsClientReadyRequestSchema.parse(input)
    if (report.runId !== this.identity.runId || report.clientBuildId !== this.identity.clientBuildId ||
        report.packageVersion !== this.identity.packageVersion) throw new TeamsLaunchError()
    this.status()
    const key = pairingCode ?? report.host
    if (!this.clients.has(key) && this.clients.size >= 10) throw new TeamsLaunchError()
    this.clients.set(key, {
      proof: { host: report.host, checkedAt: new Date(this.now()).toISOString(), ...(pairingCode ? { pairingCode } : {}) },
      expiresAt: Math.min(this.now() + 30_000, sessionExpiresAt ?? Number.POSITIVE_INFINITY)
    })
  }
}
