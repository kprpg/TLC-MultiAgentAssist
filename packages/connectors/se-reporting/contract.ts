import { createHash } from 'node:crypto'
import { seLiveContractSchema, type SeLiveContract } from '../../common/contracts/se-reporting.js'
import { SeReportingError } from './types.js'

export function parseSeLiveContract(markdown: string, path: string, testMode = false): SeLiveContract {
    const version = /Schema version:\s*[`"']?([\d.]+)/i.exec(markdown)?.[1]
    if (version !== '2.0') throw new SeReportingError('unsupported-contract', 'SE Reporting supports the v2.0 monthly pod-report contract. The configured contract must be reviewed before another version can be used.')
    const managerBlock = /```ya?ml\s*\r?\nmanager:\s*\r?\n([\s\S]*?)```/i.exec(markdown)?.[1]
    const field = (name: string) => {
        const value = new RegExp(`^\\s+${name}:\\s*([^\\r\\n]*)`, 'm').exec(managerBlock ?? '')?.[1]?.trim() ?? ''
        return value.replace(/^["']|["']$/g, '').trim()
    }
    const managerId = field('manager_system_user_id')
    const managerAlias = field('manager_alias')
    const name = field('display_name')
    if ((!managerId && !managerAlias) || !name || /[<>]/.test(`${managerId}${managerAlias}${name}`)) {
        throw new SeReportingError('invalid-manager', 'The live contract must contain a real manager selector and display name. Bundled placeholders are not a live contract.')
    }
    const list = (heading: string) => {
        const section = new RegExp(`^### ${heading}\\s*\\r?\\n([\\s\\S]*?)(?=^#{1,3} |$(?![\\s\\S]))`, 'm').exec(markdown)?.[1] ?? ''
        const values = [...section.matchAll(/^\s*-\s+`?([a-z0-9][a-z0-9-]{0,79})`?\s*$/gm)].map((match) => match[1]!)
        if (!values.length) throw new SeReportingError('invalid-contract-scope', `The live contract must define its allowed ${heading.toLowerCase()}.`)
        return [...new Set(values)]
    }
    for (const heading of ['Account Eligibility and Assignment Scope', 'Scorecard', 'Customer Updates', 'Asks for Manager', 'Dashboard Sections']) {
        if (!markdown.includes(heading)) throw new SeReportingError('unsupported-contract-shape', 'The live contract does not contain the supported monthly-report sections. No fallback contract was used.')
    }
    if (!markdown.includes('Committed On') || !markdown.includes('actualend') || !markdown.includes('See more')) {
        throw new SeReportingError('unsupported-contract-shape', 'The live contract must specify dated commitments, actual HoK completions and progressive-disclosure reporting.')
    }
    return seLiveContractSchema.parse({
        version, manager: { name, alias: managerAlias, system_user_id: managerId },
        allowedAtus: list('ATUs'), allowedPillars: list('Pillars'), url: path,
        hash: createHash('sha256').update(markdown).digest('hex'), testMode
    })
}
