import { z } from 'zod'

export const goldenScenarioFileSchema = z.object({
  schemaVersion: z.literal(1),
  agent: z.string().min(1),
  scenarios: z.array(z.object({
    id: z.string().min(1),
    prompt: z.string().min(3),
    expected: z.array(z.string().min(1)).min(1)
  }).strict()).min(1)
}).strict()

export type GoldenScenarioFile = z.infer<typeof goldenScenarioFileSchema>
export type ExpectationVerdict = 'accepted' | 'rejected' | 'not-evaluated'

/** An automated check for one golden expectation, matched by its exact text. */
export interface ExpectationCheck {
  expectation: string
  check(content: string): boolean
}

export interface GoldenScenarioReport {
  agent: string
  mode: 'sample' | 'live'
  agentVersion: string
  executedAt: string
  results: Array<{ scenarioId: string; expectation: string; verdict: ExpectationVerdict }>
  scenarioErrors: Array<{ scenarioId: string; message: string }>
  summary: { accepted: number; rejected: number; notEvaluated: number; total: number }
  /** `passed` requires every expectation to be checked and accepted; unchecked work is never a pass. */
  outcome: 'passed' | 'failed' | 'incomplete'
}

const documentedHeadings = [
  'summary', 'context used', 'observed signals', 'recommended actions', 'sources', 'assumptions and missing information', 'feedback prompt'
]

function levelTwoHeadings(content: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = []
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(\S.*?)\s*$/.exec(line)
    if (heading) sections.push({ title: heading[1]!, body: '' })
    else if (sections.length) sections[sections.length - 1]!.body += `${line}\n`
  }
  return sections
}

export const sharedPresentationChecks: readonly ExpectationCheck[] = [
  {
    expectation: 'Uses ## headings in the documented order without numbering',
    check: (content) => {
      const headings = levelTwoHeadings(content)
      if (headings.some(({ title }) => /^\d+[.)]\s/.test(title))) return false
      const positions = headings.map(({ title }) => documentedHeadings.indexOf(title.toLowerCase())).filter((index) => index >= 0)
      return positions.length > 0 && positions.every((position, index) => index === 0 || position > positions[index - 1]!)
    }
  },
  {
    expectation: 'Ends with a Feedback prompt offering action-verb follow-ups',
    check: (content) => {
      const last = levelTwoHeadings(content).at(-1)
      return last?.title.toLowerCase() === 'feedback prompt' && last.body.trim().length > 0
    }
  }
]

/**
 * Runs each golden scenario through `invoke` and gives every expectation an explicit verdict. Expectations without
 * an automated check stay `not-evaluated`. The report holds metadata only: no prompts, model output, or customer text.
 */
export async function evaluateGoldenScenarios(options: {
  file: GoldenScenarioFile
  mode: 'sample' | 'live'
  checks: readonly ExpectationCheck[]
  invoke(prompt: string): Promise<{ content: string; agentVersion: string }>
  now?: () => Date
}): Promise<GoldenScenarioReport> {
  const file = goldenScenarioFileSchema.parse(options.file)
  const checks = new Map(options.checks.map((entry) => [entry.expectation, entry.check]))
  const results: GoldenScenarioReport['results'] = []
  const scenarioErrors: GoldenScenarioReport['scenarioErrors'] = []
  const versions = new Set<string>()
  for (const scenario of file.scenarios) {
    let content: string | undefined
    try {
      const response = await options.invoke(scenario.prompt)
      content = response.content
      versions.add(response.agentVersion)
    } catch (error) {
      scenarioErrors.push({ scenarioId: scenario.id, message: error instanceof Error ? error.message : String(error) })
    }
    for (const expectation of scenario.expected) {
      const check = checks.get(expectation)
      const verdict: ExpectationVerdict = content === undefined || !check ? 'not-evaluated' : check(content) ? 'accepted' : 'rejected'
      results.push({ scenarioId: scenario.id, expectation, verdict })
    }
  }
  const count = (verdict: ExpectationVerdict) => results.filter((result) => result.verdict === verdict).length
  const summary = { accepted: count('accepted'), rejected: count('rejected'), notEvaluated: count('not-evaluated'), total: results.length }
  return {
    agent: file.agent, mode: options.mode, agentVersion: [...versions].join(',') || 'unknown',
    executedAt: (options.now ?? (() => new Date()))().toISOString(), results, scenarioErrors, summary,
    outcome: summary.rejected > 0 ? 'failed' : summary.notEvaluated > 0 || scenarioErrors.length > 0 ? 'incomplete' : 'passed'
  }
}
