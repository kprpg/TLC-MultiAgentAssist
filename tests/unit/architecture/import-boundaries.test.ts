import { describe, expect, it } from 'vitest'
import { analyzeImports, applyBaseline, loadBaseline, loadSources } from '../../../scripts/check-import-boundaries.mjs'

type Violation = { rule: string; file: string; target: string }
const analyze = (sources: Record<string, string>): Violation[] => analyzeImports(sources)
const rules = (sources: Record<string, string>) => analyze(sources).map(({ rule, file }) => `${rule}:${file}`)

describe('repository import boundaries', () => {
    it('has no forbidden dependency beyond the documented, shrink-only baseline', () => {
        const { newViolations, staleBaseline } = applyBaseline(analyzeImports(loadSources()), loadBaseline())
        expect(newViolations).toEqual([])
        expect(staleBaseline).toEqual([])
    })

    it('documents a reason for every baseline entry', () => {
        for (const entry of loadBaseline() as Array<{ reason?: string }>) expect(entry.reason?.length ?? 0).toBeGreaterThan(20)
    })
})

describe('import boundary rules', () => {
    it('keeps the shared contract package free of connector, agent, orchestrator and app dependencies', () => {
        expect(rules({
            'packages/common/a.ts': "import { x } from '../orchestrator/index.js'",
            'packages/common/b.ts': "import { y } from '../connectors/msx/index.js'\nexport * from '../../apps/web/src/app.js'",
            'packages/common/ok.ts': "import { z } from './contracts/index.js'\nimport { w } from 'zod'"
        }).sort()).toEqual([
            'common-purity:packages/common/a.ts', 'common-purity:packages/common/b.ts', 'core-to-app:packages/common/b.ts'
        ].sort())
    })

    it('forbids any core package from importing an application', () => {
        expect(rules({
            'packages/orchestrator/a.ts': "import { x } from '../../apps/desktop/electron/main/index.js'",
            'packages/connectors/b.ts': "import type { T } from '../../apps/shared/session-cache.js'"
        })).toEqual(['core-to-app:packages/orchestrator/a.ts', 'core-to-app:packages/connectors/b.ts'])
    })

    it('permits type-only reverse references to the orchestrator but rejects runtime ones', () => {
        expect(rules({
            'packages/connectors/foundry/index.ts': "import type { AgentInvoker } from '../../orchestrator/index.js'\nimport { type McemAgentContext } from '../../orchestrator/index.js'",
            'packages/connectors/local-store/a.ts': "import { evaluate } from '../../orchestrator/index.js'",
            'packages/agents/x/b.ts': "export { run } from '../../orchestrator/workflows/index.js'"
        })).toEqual(['backend-to-orchestrator-runtime:packages/connectors/local-store/a.ts', 'backend-to-orchestrator-runtime:packages/agents/x/b.ts'])
    })

    it('forbids one application from reaching into another application, but allows shared UI code', () => {
        expect(rules({
            'apps/web/src/a.ts': "import { x } from '../../desktop/electron/main/outlook-compose.js'",
            'apps/vscode-extension/src/b.ts': "import { y } from '../../desktop/electron/main/response-document.js'",
            'apps/web/src/ok.ts': "import { z } from '../../shared/session-cache.js'",
            'apps/desktop/electron/main/ok.ts': "import { w } from './other.js'\nimport { v } from '../../../shared/presentation-owner.js'"
        })).toEqual(['app-to-app:apps/web/src/a.ts', 'app-to-app:apps/vscode-extension/src/b.ts'])
    })

    it('keeps presentation code browser-safe and away from connector and agent internals', () => {
        expect(rules({
            'apps/vscode-extension/src/webview/a.tsx': "import { readFile } from 'node:fs/promises'",
            'apps/desktop/renderer-revamp/src/b.ts': "import { join } from 'path'\nimport { c } from '../../../../packages/connectors/msx/index.js'",
            'apps/shared/c.ts': "import { d } from '../../packages/agents/mcem-coach/src/milestone-signals.js'",
            'apps/desktop/renderer-revamp/src/ok.ts': "import type { T } from '../../../../packages/connectors/common/index.js'\nimport { s } from '../../../../packages/common/contracts/index.js'"
        }).sort()).toEqual([
            'ui-node-builtin:apps/vscode-extension/src/webview/a.tsx', 'ui-node-builtin:apps/desktop/renderer-revamp/src/b.ts',
            'ui-backend-internals:apps/desktop/renderer-revamp/src/b.ts', 'ui-backend-internals:apps/shared/c.ts'
        ].sort())
    })

    it('does not flag host composition roots for wiring connectors and the orchestrator', () => {
        expect(rules({
            'apps/desktop/electron/main/index.ts': "import { LiveMsxConnector } from '../../../../packages/connectors/msx/index.js'\nimport { ThinSliceOrchestrator } from '../../../../packages/orchestrator/index.js'",
            'apps/web/src/runtime.ts': "import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'"
        })).toEqual([])
    })

    it('recognizes every import form including re-exports, side effects, dynamic imports and multiline specifiers', () => {
        const found = analyze({
            'packages/common/a.ts': [
                "import {\n  one,\n  two\n} from '../orchestrator/index.js'",
                "export * from '../connectors/common/index.js'",
                "import '../agents/x/side-effect.js'",
                "const lazy = await import('../orchestrator/workflows/index.js')"
            ].join('\n')
        })
        expect(found).toHaveLength(4)
    })

    it('does not treat text in comments or strings as an import', () => {
        expect(analyze({
            'packages/common/a.ts': "// import { x } from '../orchestrator/index.js'\nconst note = \"from '../connectors/x.js'\"\n/* export * from '../agents/y.js' */"
        })).toEqual([])
    })

    it('treats bundler asset imports as data rather than code coupling', () => {
        expect(analyze({
            'apps/shared/prompt-catalog.ts': "import prompt from '../../packages/agents/mcem-coach/prompts/prompts.md?raw'",
            'apps/vscode-extension/src/webview/prompts.ts': "import text from '../../../../packages/agents/x/prompts/y.md?raw'"
        })).toEqual([])
    })

    it('allows presentation code to use the neutral shared documents package but not hosts or backends', () => {
        expect(rules({
            'apps/shared/dashboards/report.tsx': "import { renderSeReportHtml } from '../../../packages/documents/se-reporting.js'",
            'packages/documents/a.ts': "import { x } from '../orchestrator/index.js'"
        })).toEqual(['backend-to-orchestrator-runtime:packages/documents/a.ts'])
    })

    it('confines the static-preview exemption to its directory and to the renderer data client', () => {
        expect(rules({
            'apps/desktop/renderer-revamp/src/preview/preview-evaluation.ts': "import { m } from '../../../../../packages/agents/mcem-coach/src/milestone-signals.js'",
            'apps/desktop/renderer-revamp/src/data-client.ts': "import { buildPreviewEvaluation } from './preview/preview-evaluation.js'",
            'apps/desktop/renderer-revamp/src/App.tsx': "import { buildPreviewEvaluation } from './preview/preview-evaluation.js'"
        })).toEqual(['ui-preview-leak:apps/desktop/renderer-revamp/src/App.tsx'])
    })

    it('reports a baseline entry only once it is fixed so the allowance can only shrink', () => {
        const violations: Violation[] = [
            { rule: 'ui-backend-internals', file: 'apps/shared/c.ts', target: 'packages/agents/mcem-coach/src/milestone-signals.ts' },
            { rule: 'app-to-app', file: 'apps/web/src/new.ts', target: 'apps/desktop/electron/main/x.ts' }
        ]
        const baseline = [
            { rule: 'ui-backend-internals', file: 'apps/shared/c.ts', target: 'packages/agents/mcem-coach/src/milestone-signals.ts', reason: 'debt' },
            { rule: 'app-to-app', file: 'apps/web/src/old.ts', target: 'apps/desktop/electron/main/y.ts', reason: 'debt' }
        ]
        const result = applyBaseline(violations, baseline)
        expect(result.newViolations).toEqual([violations[1]])
        expect(result.staleBaseline).toEqual([baseline[1]])
    })
})
