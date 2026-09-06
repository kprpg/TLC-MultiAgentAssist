export function addMsxOpportunityLink(content: string, opportunityId: string): string {
    if (/microsoftsales\.crm\.dynamics\.com\/main\.aspx[^\s)]*\bopportunity\b/i.test(content)) return content

    const opportunityUrl = new URL('https://microsoftsales.crm.dynamics.com/main.aspx')
    opportunityUrl.searchParams.set('pagetype', 'entityrecord')
    opportunityUrl.searchParams.set('etn', 'opportunity')
    opportunityUrl.searchParams.set('id', opportunityId)
    const link = `**MSX Opportunity:** [Open opportunity in MSX](${opportunityUrl.toString()})`
    const lines = content.split('\n')
    const accountLine = lines.findIndex((line) => /^\s*\*\*Account:\*\*/i.test(line))
    const headingLine = lines.findIndex((line) => /^\s*#{1,6}\s+/.test(line))
    const insertionIndex = accountLine >= 0
        ? accountLine + 1
        : headingLine >= 0 ? headingLine + 1 : 0
    lines.splice(insertionIndex, 0, link)
    return lines.join('\n')
}