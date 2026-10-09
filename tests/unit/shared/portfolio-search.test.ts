import { describe, expect, it } from 'vitest'
import { findPortfolioSearchResults } from '../../../apps/shared/portfolio-search.js'

const accounts = [
    { id: 'alpha', name: 'Alpha Corp' },
    { id: 'beta', name: 'Beta Health' }
]
const opportunities = [
    { id: 'renewal', accountId: 'beta', name: 'Alpha platform renewal' },
    { id: 'unknown', accountId: 'missing', name: 'Alpha orphan' }
]

describe('portfolio search across UI surfaces', () => {
    it('matches trimmed partial names case-insensitively, accounts first', () => {
        expect(findPortfolioSearchResults('  ALpHa  ', accounts, opportunities)).toEqual([
            { type: 'account', account: accounts[0] },
            { type: 'opportunity', account: accounts[1], opportunity: opportunities[0] }
        ])
    })

    it('returns no results for empty queries or missing matches', () => {
        expect(findPortfolioSearchResults('  ', accounts, opportunities)).toEqual([])
        expect(findPortfolioSearchResults('no match', accounts, opportunities)).toEqual([])
    })

    it('limits the combined results to eight', () => {
        const matches = Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, name: `Alpha ${index}` }))
        expect(findPortfolioSearchResults('alpha', matches, opportunities)).toEqual(
            matches.slice(0, 8).map((account) => ({ type: 'account', account }))
        )
    })
})
