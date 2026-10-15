import type { SeDomainId } from '../configuration/se-domains.js'
import type { Account, DiscoverableOpportunity, Opportunity } from '../contracts/index.js'

export interface SampleDiscoveryMetadata {
  readonly domain: SeDomainId
  readonly solutionArea: string
  readonly technicalCapability: string
}

export const sampleDiscoveryMetadataByOpportunityId: Readonly<Record<string, SampleDiscoveryMetadata>> = Object.freeze({
  'opp-grid-modernization': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-cloud-security-readiness': { domain: 'security', solutionArea: 'Security', technicalCapability: 'Threat Protection' },
  'opp-data-estate-consolidation': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-resilient-cloud-foundation': { domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Well Architected' },
  'opp-ai-service': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI and ML' },
  'opp-store-modernization': { domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'IoT' },
  'opp-unified-commerce': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB' },
  'opp-customer-data-platform': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-zava-ai-platform': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI and ML' },
  'opp-zava-migration': { domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Windows & SQL Server Migration to Azure' },
  'opp-aw-commerce': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB' },
  'opp-ms-only-showcase': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-fourth-coffee-loyalty': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI and ML' },
  'opp-fourth-coffee-analytics': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-tailspin-ecommerce': { domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB' },
  'opp-tailspin-forecasting': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-wwi-control-tower': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' },
  'opp-wwi-warehouse-edge': { domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure Stack Edge' },
  'opp-woodgrove-fraud-ai': { domain: 'security', solutionArea: 'Security', technicalCapability: 'Fraud Protection' },
  'opp-woodgrove-regulatory-data': { domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Cloud Scale Analytics' }
})

export function samplePortfolioDiscoveryOpportunities(
  accounts: readonly Account[],
  opportunities: readonly Opportunity[]
): DiscoverableOpportunity[] {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  return opportunities.flatMap((opportunity) => {
    const metadata = sampleDiscoveryMetadataByOpportunityId[opportunity.id]
    const accountName = accountNames.get(opportunity.accountId)
    if (!metadata || !accountName) return []
    return [{ ...opportunity, accountName, ...metadata, onDealTeam: true }]
  })
}
