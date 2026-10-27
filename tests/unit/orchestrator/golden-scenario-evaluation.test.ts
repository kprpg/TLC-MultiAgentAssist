import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    evaluateGoldenScenarios, goldenScenarioFileSchema, sharedPresentationChecks,
    type GoldenScenarioFile
} from '../../../packages/orchestrator/evaluation/golden-scenarios.js'

const agentDirectories = ['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play']
const loadGolden = (directory: string) =>
    goldenScenarioFileSchema.parse(JSON.parse(readFileSync(resolve(`packages/agents/${directory}/golden-scenarios.json`), 'utf8')))
const executedAt = new Date('2026-10-24T12:00:00.000Z')

const conforming = [
    '## Summary', 'Focus on the supported priority.', '## Context used', 'MSX evidence.', '## Observed signals', 'None.',
    '## Recommended actions', 'Act.', '## Sources', 'O.C1', '## Assumptions and missing information', 'None.',
    '## Feedback prompt', 'Draft the follow-up email.'
].join('\n')

const file: GoldenScenarioFile = {
    schemaVersion: 1, agent: 'tlc-test-agent',
    scenarios: [
        { id: 'readable-markdown-presentation', prompt: 'Give me the guidance.', expected: [
            'Uses ## headings in the documented order without numbering',
            'Ends with a Feedback prompt offering action-verb follow-ups',
            'Shows plain-language facts with entry refs and no raw field names'
        ] },
        { id: 'grounding', prompt: 'What now?', expected: ['Names evidence gaps instead of assuming absence', 'Lists missing evidence', 'Does not rank'] }
    ]
}

describe('golden scenario evaluation', () => {
    it('executes every scenario prompt and gives each expectation an explicit verdict, never a silent pass', async () => {
        const prompts: string[] = []
        const report = await evaluateGoldenScenarios({
            file, mode: 'sample', checks: sharedPresentationChecks, now: () => executedAt,
            invoke: async (prompt) => { prompts.push(prompt); return { content: conforming, agentVersion: 'test-v1' } }
        })

        expect(prompts).toEqual(['Give me the guidance.', 'What now?'])
        expect(report.results.map(({ scenarioId, expectation, verdict }) => [scenarioId, expectation, verdict])).toEqual([
            ['readable-markdown-presentation', 'Uses ## headings in the documented order without numbering', 'accepted'],
            ['readable-markdown-presentation', 'Ends with a Feedback prompt offering action-verb follow-ups', 'accepted'],
            ['readable-markdown-presentation', 'Shows plain-language facts with entry refs and no raw field names', 'not-evaluated'],
            ['grounding', 'Names evidence gaps instead of assuming absence', 'not-evaluated'],
            ['grounding', 'Lists missing evidence', 'not-evaluated'],
            ['grounding', 'Does not rank', 'not-evaluated']
        ])
        expect(report.summary).toEqual({ accepted: 2, rejected: 0, notEvaluated: 4, total: 6 })
        expect(report.outcome).toBe('incomplete')
        expect(report).toMatchObject({ agent: 'tlc-test-agent', mode: 'sample', agentVersion: 'test-v1', executedAt: executedAt.toISOString() })
    })

    it('rejects numbered, out-of-order, or feedback-less presentations', async () => {
        const cases: Array<[string, string]> = [
            ['numbered headings', conforming.replace('## Summary', '## 1. Summary')],
            ['out of order', conforming.replace('## Summary', '## Sources').replace('## Sources\nO.C1', '## Summary\nO.C1')],
            ['missing feedback prompt', conforming.replace(/## Feedback prompt[\s\S]*$/, '')],
            ['feedback not last', `${conforming}\n## Appendix\nExtra`]
        ]
        for (const [name, content] of cases) {
            const report = await evaluateGoldenScenarios({
                file, mode: 'sample', checks: sharedPresentationChecks, now: () => executedAt,
                invoke: async () => ({ content, agentVersion: 'test-v1' })
            })
            const verdicts = report.results.filter(({ scenarioId }) => scenarioId === 'readable-markdown-presentation').map(({ verdict }) => verdict)
            expect(verdicts, name).toContain('rejected')
            expect(report.outcome, name).toBe('failed')
        }
    })

    it('records an invocation failure without turning it into a pass or aborting the other scenarios', async () => {
        let calls = 0
        const report = await evaluateGoldenScenarios({
            file, mode: 'live', checks: sharedPresentationChecks, now: () => executedAt,
            invoke: async () => { if (++calls === 1) throw new Error('model unavailable'); return { content: conforming, agentVersion: 'active' } }
        })

        expect(calls).toBe(2)
        expect(report.scenarioErrors).toEqual([{ scenarioId: 'readable-markdown-presentation', message: 'model unavailable' }])
        expect(report.results.filter(({ scenarioId }) => scenarioId === 'readable-markdown-presentation').every(({ verdict }) => verdict === 'not-evaluated')).toBe(true)
        expect(report.outcome).toBe('incomplete')
    })

    it('reports passed only when every expectation was checked and accepted', async () => {
        const single: GoldenScenarioFile = { schemaVersion: 1, agent: 'tlc-test-agent', scenarios: [
            { id: 'readable-markdown-presentation', prompt: 'first prompt', expected: [
                'Uses ## headings in the documented order without numbering', 'Ends with a Feedback prompt offering action-verb follow-ups'
            ] },
            { id: 'second', prompt: 'second prompt', expected: ['Custom check passes'] },
            { id: 'third', prompt: 'third prompt', expected: ['Custom check passes again'] }
        ] }
        const report = await evaluateGoldenScenarios({
            file: single, mode: 'sample', now: () => executedAt,
            checks: [...sharedPresentationChecks, { expectation: 'Custom check passes', check: () => true }, { expectation: 'Custom check passes again', check: () => true }],
            invoke: async () => ({ content: conforming, agentVersion: 'v' })
        })
        expect(report.outcome).toBe('passed')
        expect(report.summary).toEqual({ accepted: 4, rejected: 0, notEvaluated: 0, total: 4 })
    })

    it('stores metadata only: no prompts, model output, or customer text in the report', async () => {
        const report = await evaluateGoldenScenarios({
            file, mode: 'sample', checks: sharedPresentationChecks, now: () => executedAt,
            invoke: async () => ({ content: `${conforming}\nSECRET-CUSTOMER-NAME`, agentVersion: 'v' })
        })
        const serialized = JSON.stringify(report)
        expect(serialized).not.toContain('SECRET-CUSTOMER-NAME')
        expect(serialized).not.toContain('Give me the guidance.')
    })

    it('enumerates every expectation in every checked-in golden file and never counts an unchecked one as accepted', async () => {
        for (const directory of agentDirectories) {
            const golden = loadGolden(directory)
            const report = await evaluateGoldenScenarios({
                file: golden, mode: 'sample', checks: sharedPresentationChecks, now: () => executedAt,
                invoke: async () => ({ content: conforming, agentVersion: 'stub' })
            })
            const expected = golden.scenarios.reduce((total, scenario) => total + scenario.expected.length, 0)
            expect(report.summary.total, directory).toBe(expected)
            expect(report.summary.accepted + report.summary.rejected + report.summary.notEvaluated, directory).toBe(expected)
            expect(report.outcome === 'passed', directory).toBe(report.summary.notEvaluated === 0 && report.summary.rejected === 0)
        }
    })
})
