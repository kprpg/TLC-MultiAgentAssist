import { describe, expect, it } from 'vitest'
import { addMsxOpportunityLink, buildMsxOpportunityUrl } from '../../../packages/common/index.js'

describe('MSX opportunity sharing link', () => {
    it.each(['11111111-1111-4111-8111-111111111111', 'opp-1', 'opp&etn=account#other'])('builds a fixed HTTPS opportunity URL for %s', (id) => {
        const url = new URL(buildMsxOpportunityUrl(id))

        expect(url.origin + url.pathname).toBe('https://microsoftsales.crm.dynamics.com/main.aspx')
        expect([...url.searchParams]).toEqual([
            ['pagetype', 'entityrecord'],
            ['etn', 'opportunity'],
            ['id', id]
        ])
        expect(url.hash).toBe('')
    })

    it('adds the selected opportunity link after the response heading', () => {
        const result = addMsxOpportunityLink('## Account pulse\n\n**Priority:** Act now.', 'opp-1')

        expect(result).toContain('## Account pulse\n**MSX Opportunity:** [Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)')
    })

    it('does not duplicate an existing MSX opportunity link', () => {
        const content = '[Open opportunity](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)'

        expect(addMsxOpportunityLink(content, 'opp-1')).toBe(content)
    })
})