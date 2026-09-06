import { describe, expect, it } from 'vitest'
import { addMsxOpportunityLink } from '../../../packages/common/index.js'

describe('MSX opportunity sharing link', () => {
    it('adds the selected opportunity link after the response heading', () => {
        const result = addMsxOpportunityLink('## Account pulse\n\n**Priority:** Act now.', 'opp-1')

        expect(result).toContain('## Account pulse\n**MSX Opportunity:** [Open opportunity in MSX](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)')
    })

    it('does not duplicate an existing MSX opportunity link', () => {
        const content = '[Open opportunity](https://microsoftsales.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=opportunity&id=opp-1)'

        expect(addMsxOpportunityLink(content, 'opp-1')).toBe(content)
    })
})