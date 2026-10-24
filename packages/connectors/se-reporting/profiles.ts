import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { seReportingProfileSchema, type SeReportingProfile } from '../../common/contracts/se-reporting.js'
import type { SeProfileStore } from './types.js'

export class FileSeProfileStore implements SeProfileStore {
    constructor(private readonly directory: string) { }
    private path(owner: string) { return join(this.directory, `${createHash('sha256').update(owner.toLowerCase()).digest('hex')}.json`) }
    async list(owner: string): Promise<SeReportingProfile[]> {
        let content: string
        try { content = await readFile(this.path(owner), 'utf8') } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
            throw error
        }
        return z.array(seReportingProfileSchema).max(20).parse(JSON.parse(content))
    }
    async save(owner: string, profile: SeReportingProfile): Promise<void> {
        const profiles = await this.list(owner)
        const next = [...profiles.filter((row) => row.id !== profile.id), profile]
        z.array(seReportingProfileSchema).max(20).parse(next)
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const temporary = join(this.directory, `${randomUUID()}.tmp`)
        try {
            await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
            await rename(temporary, this.path(owner))
        } finally {
            await rm(temporary, { force: true })
        }
    }
}
