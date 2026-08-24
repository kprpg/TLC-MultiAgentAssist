import { access } from 'node:fs/promises'

const requiredPaths = [
  'apps/desktop/electron/main/auth',
  'apps/desktop/electron/main/ipc',
  'apps/desktop/electron/main/bootstrap',
  'apps/desktop/electron/preload',
  'apps/desktop/renderer/shell',
  'apps/desktop/renderer/pages',
  'apps/desktop/renderer/components',
  'apps/desktop/renderer/features/account-selector',
  'apps/desktop/renderer/features/conversation',
  'apps/desktop/renderer/features/source-health',
  'apps/desktop/renderer/features/feedback',
  'apps/desktop/renderer/hooks',
  'apps/desktop/renderer/services',
  'packages/common/contracts',
  'packages/common/types',
  'packages/common/validation',
  'packages/common/errors',
  'packages/common/configuration',
  'packages/common/telemetry',
  'packages/orchestrator/routing',
  'packages/orchestrator/workflows',
  'packages/orchestrator/context',
  'packages/orchestrator/progress',
  'packages/orchestrator/policies',
  'packages/agents/account-pulse/prompts',
  'packages/agents/account-pulse/policies',
  'packages/agents/account-pulse/src',
  'packages/agents/mcem-coach/prompts',
  'packages/agents/mcem-coach/policies',
  'packages/agents/mcem-coach/src',
  'packages/agents/pursuit-executive/prompts',
  'packages/agents/pursuit-executive/policies',
  'packages/agents/pursuit-executive/src',
  'packages/agents/risk-solution-play/prompts',
  'packages/agents/risk-solution-play/policies',
  'packages/agents/risk-solution-play/src',
  'packages/connectors/common',
  'packages/connectors/msx',
  'packages/connectors/sharepoint',
  'packages/connectors/seismic',
  'packages/connectors/linkedin',
  'tests/unit/common',
  'tests/unit/orchestrator',
  'tests/unit/agents',
  'tests/unit/connectors',
  'tests/unit/desktop',
  'tests/integration/orchestrator',
  'tests/integration/agents',
  'tests/integration/connectors',
  'tests/integration/desktop',
  'tests/contract',
  'tests/e2e',
  'tests/evaluation',
  'tests/security',
  'tests/fixtures/msx',
  'tests/fixtures/sharepoint',
  'tests/fixtures/seismic',
  'tests/fixtures/linkedin',
  'docs/architecture',
  'docs/decisions',
  'docs/runbooks'
]

const missing = []
for (const path of requiredPaths) {
  try {
    await access(path)
  } catch {
    missing.push(path)
  }
}

if (missing.length > 0) {
  console.error(`Missing required paths:\n${missing.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Structure gate passed (${requiredPaths.length} paths).`)
}