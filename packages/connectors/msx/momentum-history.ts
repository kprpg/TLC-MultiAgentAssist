import { createHash } from 'node:crypto'
import { z } from 'zod'
import { momentumEventSchema, type MomentumEvent, type MomentumHistory, type MomentumRecord } from '../../common/contracts/momentum-focus.js'
import type { ScopedDocumentStore } from '../common/scoped-document-store.js'

export interface MomentumHistoryOwner {
    tenantId: string
    principalId: string
    sourceId: string
    mode: 'sample' | 'live'
}
const dayMs = 86_400_000
const retentionMs = 180 * dayMs
const timestamp = z.iso.datetime({ offset: true })
const documentSchema = z.object({
    firstObserved: timestamp, lastObserved: timestamp, observations: z.number().int().positive(),
    maxGapDays: z.number().nonnegative(),
    stage: z.string().nullable(), highestStage: z.number().int().min(0).max(5),
    status: z.string().nullable(), dueDate: z.iso.date().nullable(), commitment: z.boolean().nullable(),
    completedSeen: z.boolean(), committedSeen: z.boolean(),
    events: z.array(momentumEventSchema).max(96)
}).strict()
type HistoryDocument = z.infer<typeof documentSchema>
export type MomentumHistoryRead = MomentumHistory & { events: MomentumEvent[] }
const stages = ['Listen & Consult', 'Inspire & Design', 'Empower & Achieve', 'Realize Value', 'Manage & Optimize']
const rank = (stage: string | null): number => stage === null ? 0 : stages.indexOf(stage) + 1
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class MomentumHistoryRepository {
    constructor(private readonly store: ScopedDocumentStore) { }
    partition(owner: MomentumHistoryOwner): string {
        if (![owner.tenantId, owner.principalId, owner.sourceId].every((value) => value.trim())) throw new Error('Private history requires a complete caller identity.')
        return `momentum-v1:${hash([owner.tenantId.toLowerCase(), owner.principalId.toLowerCase(), owner.sourceId.toLowerCase(), owner.mode])}`
    }
    documentKey(recordKey: string): string { return `record:${hash(recordKey)}` }
    private project(document: HistoryDocument): MomentumHistoryRead {
        return {
            state: document.observations > 1 ? 'observed' : 'insufficient', scope: 'shared',
            availableSince: document.firstObserved, lastObserved: document.lastObserved,
            observations: document.observations, maxGapDays: document.maxGapDays, events: document.events
        }
    }
    async read(owner: MomentumHistoryOwner, recordKey: string, at: string): Promise<MomentumHistoryRead | null> {
        const partition = this.partition(owner), key = this.documentKey(recordKey)
        const existing = await this.store.read(partition, key)
        if (!existing) return null
        const document = documentSchema.parse(existing.value)
        if (Date.parse(at) - Date.parse(document.lastObserved) >= retentionMs) {
            if (!this.store.delete) throw new Error('The history store must support retention deletion.')
            if (!await this.store.delete(partition, key, existing.revision)) return this.read(owner, recordKey, at)
            return null
        }
        return this.project({
            ...document, firstObserved: new Date(Math.max(Date.parse(document.firstObserved), Date.parse(at) - retentionMs)).toISOString(),
            events: document.events.filter((event) => Date.parse(event.observedAt) >= Date.parse(at) - retentionMs)
        })
    }
    async observe(owner: MomentumHistoryOwner, record: MomentumRecord, at: string): Promise<MomentumHistoryRead> {
        timestamp.parse(at)
        const partition = this.partition(owner), key = this.documentKey(record.key), now = Date.parse(at)
        for (let attempt = 0; attempt < 8; attempt++) {
            const existing = await this.store.read(partition, key)
            const previous = existing ? documentSchema.parse(existing.value) : undefined
            const fresh = !previous || now - Date.parse(previous.lastObserved) >= retentionMs
            const initial: HistoryDocument = {
                firstObserved: at, lastObserved: at, observations: 1, maxGapDays: 0,
                stage: record.stage, highestStage: rank(record.stage), status: record.status, dueDate: record.dueDate,
                commitment: record.commitment, completedSeen: record.status === 'Completed',
                committedSeen: record.commitment === true, events: []
            }
            if (previous && !fresh && now <= Date.parse(previous.lastObserved)) return this.project(previous)
            let next = initial
            if (previous && !fresh) {
                const events = previous.events.filter((event) => Date.parse(event.observedAt) >= now - retentionMs)
                const add = (kind: MomentumEvent['kind'], field: string, from: string | null, to: string | null) => {
                    const id = hash([record.key, kind, field, from, to])
                    if (!events.some((event) => event.id === id)) events.push({
                        id, kind, source: 'observed', sourceAt: null, observedAt: at,
                        intervalStart: previous.lastObserved, intervalEnd: at, field, from, to
                    })
                }
                if (rank(previous.stage) > 0 && rank(record.stage) > previous.highestStage) add('stage-advanced', 'stage', previous.stage, record.stage)
                if (rank(record.stage) > 0 && rank(record.stage) < rank(previous.stage)) add('loopback', 'stage', previous.stage, record.stage)
                if (record.entity === 'milestone' && previous.status !== null && record.status === 'Completed' && !previous.completedSeen) add('milestone-completed', 'status', previous.status, record.status)
                if (previous.commitment === false && record.commitment === true && !previous.committedSeen) add('commitment-recorded', 'commitment', 'Uncommitted', 'Committed')
                if (previous.dueDate && record.dueDate && record.dueDate > previous.dueDate) add('date-slipped', 'dueDate', previous.dueDate, record.dueDate)
                const retained = events.slice(-96)
                const availableSince = events.length > retained.length
                    ? Date.parse(retained[0]!.intervalStart ?? retained[0]!.observedAt) : Date.parse(previous.firstObserved)
                next = {
                    ...initial, firstObserved: new Date(Math.max(availableSince, now - retentionMs)).toISOString(),
                    observations: previous.observations + 1,
                    maxGapDays: Math.max(previous.maxGapDays, (now - Date.parse(previous.lastObserved)) / dayMs),
                    highestStage: Math.max(previous.highestStage, rank(record.stage)),
                    completedSeen: previous.completedSeen || initial.completedSeen,
                    committedSeen: previous.committedSeen || initial.committedSeen,
                    events: retained
                }
            }
            const value = documentSchema.parse(next)
            const saved = existing ? await this.store.replace(partition, key, existing.revision, value) : await this.store.insert(partition, key, value)
            if (saved) return this.project(value)
        }
        throw new Error('Concurrent private history capture could not be reconciled. Refresh again.')
    }
}
