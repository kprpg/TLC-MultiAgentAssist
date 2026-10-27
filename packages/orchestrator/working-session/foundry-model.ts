import type { FoundryOpenAIClient } from '../../connectors/foundry/index.js'
import type { StructuredModel } from './topic.js'

/** A Foundry deployment used through strict structured outputs, the same way the meeting extractor calls it. */
export function foundryStructuredModel(client: FoundryOpenAIClient, model: string, timeoutMs = 60_000): StructuredModel {
  return async ({ name, system, user, schema }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }
      }, { signal: controller.signal })
      const content = response.choices?.[0]?.message?.content
      if (!content || !content.trim()) throw new Error('The model returned no content.')
      return content
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Live hosts use the model by default; `TLC_WORKING_SESSION_MODEL=off` keeps topic and templates fully rule-based. */
export function workingSessionModelName(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment['TLC_WORKING_SESSION_MODEL']?.trim()
  if (configured && /^(off|none|false|0)$/i.test(configured)) return undefined
  return configured || environment['TLC_MEETING_MODEL']?.trim() || 'gpt-6.1-sol'
}
