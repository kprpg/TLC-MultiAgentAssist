import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowProgress } from '../../../apps/shared/workflow-progress.js'

describe('shared workflow progress', () => {
    it('announces first-page results as incomplete, never as completed or a percentage', () => {
        const markup = renderToStaticMarkup(createElement(WorkflowProgress, {
            run: { workflowId: 'WF-002', status: 'running' }, itemCount: 20
        }))
        expect(markup).toContain('role="status"')
        expect(markup).toContain('20 items so far')
        expect(markup).toContain('incomplete')
        expect(markup).not.toContain('Completed')
        expect(markup).not.toContain('%')
    })

    it('keeps row-limited completion visibly partial and shows the source coverage detail', () => {
        const markup = renderToStaticMarkup(createElement(WorkflowProgress, {
            run: { workflowId: 'WF-002', status: 'completed', state: 'partial' }, itemCount: 100,
            sourceHealth: [{ source: 'dataverse-mcp', state: 'partial', detail: 'Read limit reached; more rows may exist.' }]
        }))
        expect(markup).toContain('partial source coverage')
        expect(markup).toContain('Read limit reached; more rows may exist.')
        expect(markup).not.toContain('all required sources')
    })

    it.each(['failed', 'cancelled'])('does not label a %s run with retained rows as completed', (status) => {
        const markup = renderToStaticMarkup(createElement(WorkflowProgress, {
            run: { workflowId: 'WF-002', status }, itemCount: 20
        }))
        expect(markup).toContain('incomplete')
        expect(markup).not.toContain('Workflow completed')
    })

    it('does not assume complete coverage when the outcome is absent', () => {
        const markup = renderToStaticMarkup(createElement(WorkflowProgress, {
            run: { workflowId: 'WF-002', status: 'completed' }, itemCount: 20
        }))
        expect(markup).toContain('source coverage is unavailable')
        expect(markup).not.toContain('all required sources')
    })
})
