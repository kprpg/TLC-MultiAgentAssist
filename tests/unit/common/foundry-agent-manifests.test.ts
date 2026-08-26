import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadFoundryEnvironment } from '../../../packages/common/configuration/foundry-environment.js'

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  definition: z.object({
    kind: z.literal('prompt'),
    model: z.string().min(1),
    instructions: z.string().min(50)
  }).strict(),
  evaluation: z.object({
    suiteName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
    target: z.object({
      type: z.literal('agent_reference'),
      name: z.string().min(1),
      version: z.string().regex(/^\d+$/)
    }).strict(),
    dataGenerationType: z.literal('simple_qna'),
    maxSamples: z.number().int().min(15).max(1000),
    sourceDescription: z.string().min(50)
  }).strict()
}).strict()

const agentBindings = [
  ['mcemCoach', 'mcem-coach'],
  ['riskSolutionPlay', 'risk-solution-play'],
  ['pursuitExecutive', 'pursuit-executive'],
  ['accountPulse', 'account-pulse']
] as const

describe('Foundry agent manifests', () => {
  it('keeps all prompt-agent source names aligned with the checked-in environment sample', async () => {
    const environment = await loadFoundryEnvironment(resolve('config/foundry.environment.example.json'))
    const suiteNames = new Set<string>()

    for (const [binding, directory] of agentBindings) {
      const content = await readFile(resolve(`packages/agents/${directory}/foundry-agent.json`), 'utf8')
      const manifest = manifestSchema.parse(JSON.parse(content))
      expect(manifest.name).toBe(environment.foundry.agents[binding].name)
      expect(manifest.evaluation.target.name).toBe(manifest.name)
      expect(suiteNames.has(manifest.evaluation.suiteName)).toBe(false)
      suiteNames.add(manifest.evaluation.suiteName)
      expect(environment.foundry.agents[binding]).toMatchObject({
        type: 'prompt',
        protocol: 'responses'
      })
    }
  })
})