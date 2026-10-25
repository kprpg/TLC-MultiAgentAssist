import type { LearnHit, LearnPage, LearnSource } from './learn.js'

/** Bundled sample content: no network, clearly labelled, and never presented as retrieved from Microsoft Learn. */
const samplePages: LearnPage[] = [
  {
    title: 'Sample: Azure proof-of-concept planning guide', url: 'https://learn.microsoft.com/azure/cloud-adoption-framework/',
    markdown: '# Sample: Azure proof-of-concept planning guide\n\nSample content bundled with TLC Assist for offline use. It was not retrieved from Microsoft Learn.\n\n## Define the scope\n\nAgree the workload, success criteria and owners before building anything.\n\n## Prepare the environment\n\nUse a dedicated resource group, a naming prefix and least-privilege access.\n\n## Measure and decide\n\nRecord results against the success criteria and agree the next step.\n'
  },
  {
    title: 'Sample: Azure Well-Architected review checklist', url: 'https://learn.microsoft.com/azure/well-architected/',
    markdown: '# Sample: Azure Well-Architected review checklist\n\nSample content bundled with TLC Assist for offline use.\n\n## Reliability\n\nIdentify failure modes and recovery targets.\n\n## Security\n\nProtect identities, data and network boundaries.\n\n## Cost optimization\n\nSize for the proof of concept and tag every resource.\n'
  },
  {
    title: 'Sample: Azure landing zone design areas', url: 'https://learn.microsoft.com/azure/architecture/',
    markdown: '# Sample: Azure landing zone design areas\n\nSample content bundled with TLC Assist for offline use.\n\n## Identity and access\n\nUse managed identities and role-based access control.\n\n## Networking\n\nSeparate workload and management subnets.\n\n## Governance\n\nApply policy and tags from the start.\n'
  }
]

export const sampleLearnSource: LearnSource = {
  async search(_query: string, limit: number): Promise<LearnHit[]> {
    return samplePages.slice(0, limit).map((page) => ({ title: page.title, url: page.url, excerpt: page.markdown }))
  },
  async fetchPage(url: string): Promise<LearnPage> {
    const page = samplePages.find((candidate) => candidate.url === url)
    if (!page) throw new Error('Unknown sample page.')
    return page
  }
}
