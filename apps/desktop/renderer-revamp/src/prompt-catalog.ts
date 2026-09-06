import type { AgentCapability } from '../../../../packages/common/index.js'
import accountPulsePrompts from '../../../../packages/agents/account-pulse/prompts/prompts.md?raw'
import mcemCoachPrompts from '../../../../packages/agents/mcem-coach/prompts/prompts.md?raw'
import pursuitExecutivePrompts from '../../../../packages/agents/pursuit-executive/prompts/prompts.md?raw'
import riskSolutionPlayPrompts from '../../../../packages/agents/risk-solution-play/prompts/prompts.md?raw'

export function parseSuggestedPrompts(markdown: string): readonly string[] {
    const prompts = markdown
        .split(/\r?\n/)
        .map((line) => /^\s*-\s+(.+?)\s*$/.exec(line)?.[1])
        .filter((prompt): prompt is string => Boolean(prompt))

    if (prompts.length < 4) throw new Error('Each agent prompt catalog must contain at least four list items.')
    return prompts
}

export const suggestedPrompts: Readonly<Record<AgentCapability, readonly string[]>> = {
    'account-pulse': parseSuggestedPrompts(accountPulsePrompts),
    'mcem-coach': parseSuggestedPrompts(mcemCoachPrompts),
    'pursuit-executive': parseSuggestedPrompts(pursuitExecutivePrompts),
    'risk-solution-play': parseSuggestedPrompts(riskSolutionPlayPrompts)
}