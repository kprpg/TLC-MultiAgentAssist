import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadFoundryEnvironment } from '../../../packages/common/configuration/foundry-environment.js'

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  artifacts: z.object({
    instructions: z.string().min(1),
    policy: z.string().min(1),
    readme: z.string().min(1),
    goldenScenarios: z.string().min(1)
  }).strict(),
  definition: z.object({
    kind: z.literal('prompt'),
    model: z.string().min(1),
    instructions: z.string().min(500)
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
  ['mcemCoach', 'mcem-coach', ['recorded MSX stage', 'evidence-supported stage', 'exit criteria', 'structured handoff']],
  ['riskSolutionPlay', 'risk-solution-play', ['severity', 'mitigation', 'approved assets', 'partial results']],
  ['pursuitExecutive', 'pursuit-executive', ['executive brief', '30/60 day', 'internal strategy', 'human review']],
  ['accountPulse', 'account-pulse', ['weekly focus', 'explain every', 'evidence threshold', 'do not rank']]
] as const

const sharedInstructionRequirements = [
  'Summary',
  'Context used',
  'Observed signals',
  'Recommended actions',
  'Sources',
  'Assumptions and missing information',
  'Feedback prompt'
] as const

const goldenScenarioSchema = z.object({
  schemaVersion: z.literal(1),
  agent: z.string().min(1),
  scenarios: z.array(z.object({
    id: z.string().min(1),
    prompt: z.string().min(3),
    expected: z.array(z.string().min(1)).min(3)
  }).strict()).min(3)
}).strict()

describe('Foundry agent manifests', () => {
  it('keeps all prompt-agent source names aligned with the checked-in environment sample', async () => {
    const environment = await loadFoundryEnvironment(resolve('config/foundry.environment.example.json'))
    const suiteNames = new Set<string>()

    for (const [binding, directory, uniqueRequirements] of agentBindings) {
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

      const packageRoot = resolve(`packages/agents/${directory}`)
      const [instructions, policy, readme, goldenScenarioContent] = await Promise.all([
        readFile(resolve(packageRoot, manifest.artifacts.instructions), 'utf8'),
        readFile(resolve(packageRoot, manifest.artifacts.policy), 'utf8'),
        readFile(resolve(packageRoot, manifest.artifacts.readme), 'utf8'),
        readFile(resolve(packageRoot, manifest.artifacts.goldenScenarios), 'utf8')
      ])
      expect(manifest.definition.instructions).toBe(instructions.trim())
      for (const requirement of [...sharedInstructionRequirements, ...uniqueRequirements]) {
        expect(instructions.toLowerCase()).toContain(requirement.toLowerCase())
      }
      expect(policy).toContain('Never invent')
      expect(policy).toContain('human review')
      expect(readme).toContain('## Failure Behavior')

      const goldenScenarios = goldenScenarioSchema.parse(JSON.parse(goldenScenarioContent))
      expect(goldenScenarios.agent).toBe(manifest.name)
    }
  })
})