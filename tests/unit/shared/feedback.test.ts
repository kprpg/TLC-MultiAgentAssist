import { describe, expect, it } from 'vitest'
import {
    buildFeedbackIssueBody,
    buildFeedbackIssueUrl,
    feedbackRepositoryUrl,
    feedbackScreenshotLimit,
    selectFeedbackScreenshots
} from '../../../apps/shared/feedback.js'

describe('feedback issue draft', () => {
    it('targets the product repository with structured issue content', () => {
        const issueUrl = new URL(buildFeedbackIssueUrl({
            title: '  Stage board does not refresh  ',
            description: '  The board keeps the old stage.  ',
            reproductionSteps: '  1. Move an opportunity.\n2. Refresh the account.  '
        }, true))

        expect(issueUrl.origin + issueUrl.pathname).toBe(`${feedbackRepositoryUrl}/issues/new`)
        expect(issueUrl.searchParams.get('title')).toBe('Stage board does not refresh')
        expect(issueUrl.searchParams.get('body')).toBe([
            '## Description',
            'The board keeps the old stage.',
            '## Steps to reproduce',
            '1. Move an opportunity.\n2. Refresh the account.',
            '## Screenshots',
            '<!-- Paste the screenshot image copied by TLC MultiAgent Assist below this line. -->',
            '---',
            'Submitted from TLC MultiAgent Assist.'
        ].join('\n\n'))
    })

    it('uses an explicit fallback when reproduction steps are omitted', () => {
        expect(buildFeedbackIssueBody({
            title: 'Unexpected result',
            description: 'The result was unexpected.',
            reproductionSteps: ' '
        }, false)).toContain('## Steps to reproduce\n\n_No reproduction steps provided._')
    })
})

describe('feedback screenshots', () => {
    it('accepts safe image files within the count and size limits', () => {
        const images = [
            { name: 'first.png', type: 'image/png', size: 100 },
            { name: 'second.jpg', type: 'image/jpeg', size: 200 }
        ] as File[]

        expect(selectFeedbackScreenshots(1, images)).toEqual({ accepted: images, rejected: [] })
    })

    it('rejects non-images, oversized images, and images above the count limit', () => {
        const files = [
            { name: 'notes.txt', type: 'text/plain', size: 100 },
            { name: 'large.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 },
            ...Array.from({ length: feedbackScreenshotLimit }, (_, index) => ({
                name: `${index}.png`,
                type: 'image/png',
                size: 100
            }))
        ] as File[]
        const selection = selectFeedbackScreenshots(feedbackScreenshotLimit - 1, files)

        expect(selection.accepted.map((file) => file.name)).toEqual(['0.png'])
        expect(selection.rejected).toContain('notes.txt is not an image.')
        expect(selection.rejected).toContain('large.png is larger than 5 MB.')
        expect(selection.rejected.filter((message) => message.includes('maximum'))).toHaveLength(3)
    })
})
