/**
 * Pure (vscode-free) builder for the Connection view rows, so the labels can be unit-tested.
 * The labels must reflect the active data mode — in live mode the MSX source reads live, not
 * a hardcoded "sample".
 */
export interface ConnectionItem {
    label: string
    tooltip?: string
    icon: string
}

export function buildConnectionItems(mode: 'sample' | 'live', email?: string): ConnectionItem[] {
    const live = mode === 'live'
    return [
        {
            label: `Mode: ${live ? 'Live' : 'Sample'}`,
            icon: live ? 'broadcast' : 'beaker',
            tooltip: live
                ? 'Live delegated data. Reads are bounded by the MCP tool policy.'
                : 'Sanitized sample data. No network calls are made.'
        },
        {
            label: `Identity: ${email ?? 'Not signed in (sample)'}`,
            icon: 'account'
        },
        {
            label: `MSX: ${live ? 'live' : 'sample'}`,
            icon: 'database',
            tooltip: live
                ? 'Opportunity data is read from live MSX (OData) and Dataverse (MCP).'
                : 'Opportunity data is sanitized sample data; no live MSX call is made.'
        },
        {
            label: 'MCEM guidance: built-in criteria',
            icon: 'book',
            tooltip: 'MCEM stage exit criteria come from versioned built-in guidance in the extension host (no live SharePoint fetch), in both sample and live modes.'
        }
    ]
}
