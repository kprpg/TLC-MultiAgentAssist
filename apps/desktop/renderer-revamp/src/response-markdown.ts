const sectionHeadingPattern = /^(?:stage view|owner(?:-based)? plan(?: to close gaps)?|recommended sequence|missing data|assumptions?\s*[/&-]?\s*cautions?|executive summary|key findings|recommendations?|risks?(?: and mitigations)?|next steps?|decision|approval process|budget availability)$/i

const ownerRolePattern = /^(?:specialist|ssp|ats|account executive|ae|csam|customer success account manager|se|solution engineer|csa|cloud solution architect|industry advisor|ia)(?:\s*\/\s*(?:specialist|ssp|ats|account executive|ae|csam|se|csa|ia))*\s*(?:—|–|-|:)\s*.+$/i

const evidenceLabelPattern = /^(\s*-\s*)(Gap|Evidence|Next actions?|Exit evidence to add|Owner|Decision|Approval process|Budget availability)(\s*:)(.*)$/i

export function formatResponseMarkdown(markdown: string): string {
    return markdown
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((line) => {
            const trimmed = line.trim()
            if (!trimmed || /^#{1,6}\s/.test(trimmed)) return line

            if (sectionHeadingPattern.test(trimmed)) return `## ${trimmed}`

            const numberedOwner = trimmed.match(/^\d+[.)]\s+(.+)$/)
            const owner = numberedOwner?.[1]
            if (owner && ownerRolePattern.test(owner)) return `### ${owner}`

            return line.replace(evidenceLabelPattern, '$1**$2:**$4')
        })
        .join('\n')
}