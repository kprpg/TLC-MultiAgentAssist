import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The staged ZIP has its own dependency copy; stub that exact host, not the repo's SDK instance.
const { ManagedIdentityCredential } = await import(pathToFileURL(join(process.cwd(), 'node_modules', '@azure', 'identity', 'dist', 'esm', 'index.js')).href)
const { AIProjectClient } = await import(pathToFileURL(join(process.cwd(), 'node_modules', '@azure', 'ai-projects', 'dist', 'esm', 'index.js')).href)

const trace = process.env.TLC_SAMPLE_FOUNDRY_TRACE
if (!trace) throw new Error('The isolated sample Foundry test requires an owned trace file.')
ManagedIdentityCredential.prototype.getToken = async () => ({ token: 'synthetic-test-token', expiresOnTimestamp: Date.now() + 60_000 })
const getClient = AIProjectClient.prototype.getOpenAIClient
AIProjectClient.prototype.getOpenAIClient = function (options) {
  const client = getClient.call(this, options)
  const create = client.responses.create.bind(client.responses)
  client.responses.create = function (...args) {
    const response = create(...args)
    void response.catch((error) => console.error(`[isolated-foundry] ${error.name}: ${error.message}; cause=${error.cause?.message ?? 'none'}`))
    return response
  }
  return client
}

const emptyNarratives = Object.fromEntries([
  'customer_updates', 'priority_initiatives', 'account_notes', 'partners', 'technical_themes',
  'cross_pillar_dependencies', 'next_month_priorities', 'leadership_decisions', 'scrum_rollup_bullets', 'follow_up_required'
].map((key) => [key, []]))

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname !== 'fixture.services.ai.azure.com' || request.method !== 'POST') {
    throw new Error('The isolated hybrid host must not contact any real network source.')
  }
  const body = await request.json()
  if (body.tool_choice !== 'none' || body.tools?.length !== 0) throw new Error('Hybrid inference must disable remote tools.')
  const schema = body.response_format?.json_schema?.name ?? body.text?.format?.name
  appendFileSync(trace, `${JSON.stringify({
    agent: body.agent_reference?.name, schema, stream: body.stream === true, toolsDisabled: true,
    bounded: Number.isInteger(body.max_output_tokens ?? body.max_completion_tokens)
  })}\n`)
  let content = 'Synthetic Foundry guidance based only on the supplied sample evidence.'
  if (schema === 'meeting_signals') content = JSON.stringify({ signals: [], newMilestones: [], unmappedSignals: [] })
  if (schema === 'se_reporting_narratives') content = JSON.stringify({ ...emptyNarratives, qualifying_evidence_ids: [] })
  if (schema === 'working_session_topic') content = JSON.stringify({
    topic: 'Azure Storage pilot', domain: 'Storage', azureServices: ['Azure Storage'],
    deckQueries: ['Azure Storage pilot'], learnQueries: ['Azure Storage overview'], iacScenario: 'A minimal Azure Storage pilot',
    confidence: 'high', evidence: ['Grid operations modernization']
  })
  if (schema === 'working_session_bicep') content = JSON.stringify({
    bicep: "targetScope = 'resourceGroup'\nparam location string = resourceGroup().location\nresource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {\n name: 'st${uniqueString(resourceGroup().id)}'\n location: location\n kind: 'StorageV2'\n sku: { name: 'Standard_LRS' }\n properties: { supportsHttpsTrafficOnly: true, minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false }\n}\n",
    parameters: [], notes: ['Synthetic model response for transport testing.']
  })
  if (url.pathname.endsWith('/chat/completions')) return Response.json({
    id: 'synthetic-chat', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  })
  const response = {
    id: 'synthetic-response', object: 'response', status: 'completed', output_text: content,
    output: [{ id: 'synthetic-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 10 }
  }
  if (!body.stream) return Response.json(response)
  return new Response([
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: content })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
