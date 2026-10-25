import { describe, expect, it } from 'vitest'
import { workingSessionTopicSchema } from '../../../packages/common/contracts/working-session.js'
import { createBicepCliCompiler } from '../../../packages/orchestrator/working-session/bicep-cli.js'
import { generateIac, scenarioTemplate, validateBicep } from '../../../packages/orchestrator/working-session/iac.js'
import { MemorySink } from '../../../packages/orchestrator/working-session/sinks.js'
import type { IacScenario } from '../../../packages/orchestrator/working-session/topic.js'

const topic = workingSessionTopicSchema.parse({
  topic: 'VM and file-share disaster recovery', domain: 'Resiliency', azureServices: ['Azure Site Recovery'], deckQueries: ['dr'], learnQueries: ['asr'],
  iacScenario: 'DR POC baseline', confidence: 'high', basis: 'rules', evidence: ['x']
})
const scenarios: IacScenario[] = ['baseline', 'aks', 'openai', 'appservice', 'sql', 'arc-onboarding', 'dr-files', 'datalake', 'network']
const goodBicep = `param location string = resourceGroup().location\nresource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {\n  name: 'sa'\n  location: location\n  sku: { name: 'Standard_LRS' }\n  kind: 'StorageV2'\n}\n`

describe('Bicep validation', () => {
  it.each(scenarios)('accepts the built-in %s template', (scenario) => {
    expect(validateBicep(scenarioTemplate(scenario).bicep)).toEqual({ ok: true, problems: [] })
  })

  it.each([
    ["targetScope = 'subscription'\n" + goodBicep, 'broader than a resource group'],
    [goodBicep + "resource x 'Contoso.Things/things@2020-01-01' = { name: 'x' }\n", 'Unexpected resource type'],
    [goodBicep + "resource s 'Microsoft.Resources/deploymentScripts@2023-08-01' = { name: 's' }\n", 'Deployment scripts'],
    [goodBicep + "module m 'br:contoso.azurecr.io/bicep/m:v1' = { name: 'm' }\n", 'Remote modules'],
    [goodBicep + "var u = 'https://evil.example.com/x'\n", 'Remote modules'],
    [goodBicep + "var id = '/subscriptions/0b3f6d1a-1111-4222-8333-444455556666/resourceGroups/x'\n", 'subscription ids'],
    [goodBicep + "var adminPassword = 'P@ssw0rd-literal'\n", 'secret-like'],
    [goodBicep + 'output k string = storage.listKeys().keys[0].value\n', 'Keys must not'],
    ['', 'empty or too large']
  ])('rejects unsafe Bicep (%#)', (bicep, problem) => {
    const result = validateBicep(bicep)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain(problem)
  })

  it('allows secrets that come from parameters or interpolation', () => {
    expect(validateBicep(goodBicep + "var connectionString = '${prefix}-x'\n").ok).toBe(true)
  })
})

describe('IaC generation', () => {
  it('writes Bicep, parameters, README and a note when no compiler exists', async () => {
    const sink = new MemorySink()
    const result = await generateIac({ topic, scenario: 'dr-files', sink })
    expect([...sink.files.keys()].sort()).toEqual(['iac/README.md', 'iac/main.bicep', 'iac/main.parameters.example.json'])
    expect(result.gaps.map((gap) => gap.code)).toEqual(['tool-missing'])
    expect(sink.text('iac/main.bicep')).toContain('Microsoft.RecoveryServices/vaults')
    expect(sink.text('iac/README.md')).toContain('never deploys')
    expect(JSON.parse(sink.text('iac/main.parameters.example.json')!).contentVersion).toBe('1.0.0.0')
  })

  it('adds the compiled ARM template when a compiler is available', async () => {
    const sink = new MemorySink()
    const result = await generateIac({ topic, scenario: 'network', sink, compiler: async () => ({ ok: true, armJson: '{"$schema":"x"}' }) })
    expect(sink.text('iac/main.json')).toBe('{"$schema":"x"}')
    expect(result.gaps).toEqual([])
  })

  it('reports a compile failure of the baseline instead of hiding it', async () => {
    const result = await generateIac({ topic, scenario: 'network', sink: new MemorySink(), compiler: async () => ({ ok: false, message: 'Error BCP001' }) })
    expect(result.gaps[0]).toMatchObject({ code: 'rejected', source: 'Bicep compiler' })
  })

  it('example parameters carry values for parameters that have no default', async () => {
    const sink = new MemorySink()
    await generateIac({ topic, scenario: 'sql', sink })
    expect(JSON.parse(sink.text('iac/main.parameters.example.json')!).parameters).toHaveProperty('adminObjectId')
  })

  it('uses a valid model template and its notes', async () => {
    const sink = new MemorySink()
    await generateIac({ topic, scenario: 'dr-files', sink, model: async () => JSON.stringify({ bicep: goodBicep, parameters: [{ name: 'location', value: 'eastus' }], notes: ['Confirm region.'] }) })
    expect(sink.text('iac/main.bicep')).toBe(goodBicep)
    expect(JSON.parse(sink.text('iac/main.parameters.example.json')!).parameters.location.value).toBe('eastus')
    expect(sink.text('iac/README.md')).toContain('Confirm region.')
    expect(sink.text('iac/README.md')).toContain('Model-generated template')
  })

  it.each([
    ['unsafe content', JSON.stringify({ bicep: goodBicep + "var p = 'https://x.example.com'\n", parameters: [], notes: [] })],
    ['bad JSON', 'nope'],
    ['wrong shape', JSON.stringify({ bicep: 5 })]
  ])('falls back to the baseline template and says so when the model output is %s', async (_name, content) => {
    const sink = new MemorySink()
    const result = await generateIac({ topic, scenario: 'dr-files', sink, model: async () => content })
    expect(sink.text('iac/main.bicep')).toContain('Microsoft.RecoveryServices/vaults')
    expect(result.gaps.some((gap) => gap.source === 'Model' && gap.code === 'rejected')).toBe(true)
  })

  it('falls back when the model template does not compile', async () => {
    const sink = new MemorySink()
    const compiler = async (text: string) => text === goodBicep ? { ok: false as const, message: 'bad' } : { ok: true as const, armJson: '{}' }
    const result = await generateIac({ topic, scenario: 'network', sink, compiler, model: async () => JSON.stringify({ bicep: goodBicep, parameters: [], notes: [] }) })
    expect(sink.text('iac/main.bicep')).not.toBe(goodBicep)
    expect(result.gaps.some((gap) => gap.source === 'Model')).toBe(true)
  })
})

// Opt-in because it downloads/uses the Bicep CLI: TLC_RUN_BICEP_COMPILE=1
describe.skipIf(process.env['TLC_RUN_BICEP_COMPILE'] !== '1')('built-in templates compile with the Bicep CLI', () => {
  it.each(scenarios)('%s', async (scenario) => {
    const compiled = await createBicepCliCompiler(120_000)(scenarioTemplate(scenario).bicep)
    expect(compiled, 'Bicep CLI must be installed').toBeDefined()
    expect(compiled && compiled.ok ? '' : (compiled as { message: string }).message).toBe('')
    if (compiled?.ok) expect(JSON.parse(compiled.armJson).resources.length).toBeGreaterThan(0)
  }, 150_000)
})
