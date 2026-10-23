const sectionHeadingPattern = /^(?:summary|context used|observed signals|stage view|exit criteria|owner(?:-based)? plan(?: to close gaps)?|recommended (?:sequence|actions)|missing data|assumptions?(?:\s*[/&-]?\s*cautions?| and missing information)|executive (?:summary|brief(?: or 30\/60 day pursuit plan)?)|key findings|recommendations?|risks?(?: and mitigations)?|next steps?|decision|approval process|budget availability|structured handoff|internal strategy|solution play|sources|customer-ready draft(?: requiring human review)?|feedback prompt|suggested follow-ups?)$/i

const ownerRolePattern = /^(?:specialist|ssp|ats|account executive|ae|csam|customer success account manager|se|solution engineer|csa|cloud solution architect|industry advisor|ia)(?:\s*\/\s*(?:specialist|ssp|ats|account executive|ae|csam|se|csa|ia))*\s*(?:\u2014|\u2013|-|:)\s*.+$/i

const evidenceLabelPattern = /^(\s*(?:[-*+]\s+)?)(Gap|Evidence(?: references)?|Next actions?|Exit evidence to add|Owner(?: role)?|Decision|Approval process|Budget availability|Account|Opportunity|Role|MCEM stage|Recorded (?:MSX )?stage|Evidence-supported stage|Source|Freshness|Severity|Priority|Rationale|Confidence)(\s*:)(.*)$/i

export function formatResponseMarkdown(markdown: string): string {
    let fence: { marker: string; length: number } | undefined
    return markdown
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((line) => {
            const trimmed = line.trim()
            const marker = trimmed.match(/^(`{3,}|~{3,})/)
            if (marker?.[1]) {
                if (!fence) fence = { marker: marker[1].charAt(0), length: marker[1].length }
                else if (marker[1][0] === fence.marker && marker[1].length >= fence.length) fence = undefined
                return line
            }
            if (fence || !trimmed || /^(?:#{1,6}\s|>)/.test(trimmed) || /^(?: {4}|\t)/.test(line)) return line

            const colon = trimmed.indexOf(':')
            const rawHeading = colon < 0 ? trimmed : trimmed.slice(0, colon)
            const heading = rawHeading.replace(/\*\*|__/g, '').replace(/^\d+[.)]\s+/, '').trim()
            if (sectionHeadingPattern.test(heading.trim())) {
                let detail = colon < 0 ? '' : trimmed.slice(colon + 1)
                const wrapper = rawHeading.replace(/^\d+[.)]\s+/, '').match(/^(\*\*|__)/)?.[1]
                if (wrapper && !rawHeading.endsWith(wrapper) && detail.startsWith(wrapper)) detail = detail.slice(wrapper.length)
                detail = detail.trim()
                return `## ${heading}${detail ? `\n\n${detail}` : ''}`
            }

            const numberedOwner = trimmed.match(/^\d+[.)]\s+(.+)$/)
            const owner = numberedOwner?.[1]
            if (owner && ownerRolePattern.test(owner)) return `### ${owner}`

            return line.replace(evidenceLabelPattern, '$1**$2:**$4')
        })
        .join('\n')
}