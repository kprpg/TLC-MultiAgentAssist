import { z } from 'zod'
import { TableClient } from '@azure/data-tables'
import type { TokenCredential } from '@azure/core-auth'
import { TableDocumentStore } from '../common/table-document-store.js'
import { MomentumHistoryRepository, type MomentumHistoryOwner } from './momentum-history.js'

const subjectSchema = z.object({ tid: z.string().guid(), oid: z.string().guid(), scp: z.string().trim().min(1) })
export async function momentumHistoryOwner(getToken: () => Promise<string>, sourceId: string): Promise<MomentumHistoryOwner> {
    // This identifies a credential already obtained by the host; MSX still validates it on every delegated source read.
    const token = await getToken()
    const part = token.split('.')[1]
    if (!part) throw new Error('Momentum requires a delegated source identity. Reconnect before reading private history.')
    let subject: z.infer<typeof subjectSchema>
    try { subject = subjectSchema.parse(JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))) } catch (error) {
        if (error instanceof SyntaxError || error instanceof z.ZodError) throw new Error('Momentum requires a tenant-bound delegated user credential, not an app-only token.', { cause: error })
        throw error
    }
    return { tenantId: subject.tid.toLowerCase(), principalId: subject.oid.toLowerCase(), sourceId: new URL(sourceId).origin, mode: 'live' }
}
export function createMomentumHistoryRepository(environment: NodeJS.ProcessEnv, credential?: TokenCredential): MomentumHistoryRepository | undefined {
    const configured = environment['TLC_MOMENTUM_TABLE_URL']?.trim()
    if (!configured) return undefined
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !url.hostname.endsWith('.table.core.windows.net') || url.pathname !== '/') {
        throw new Error('TLC_MOMENTUM_TABLE_URL must be an HTTPS Azure Table service origin without embedded credentials.')
    }
    const table = environment['TLC_MOMENTUM_TABLE_NAME']?.trim() || 'TlcMomentum'
    if (!/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(table)) throw new Error('The Momentum history table name is invalid.')
    if (!credential) throw new Error('Configured Momentum history requires an approved host credential with access to the private history table.')
    return new MomentumHistoryRepository(new TableDocumentStore(new TableClient(url.toString(), table, credential)))
}
