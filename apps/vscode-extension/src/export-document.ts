/**
 * Pure helpers for the export native action. No VS Code or Node APIs so the filename and
 * document assembly can be unit-tested directly.
 */

const MAX_NAME = 80

export function sanitizeFileName(title: string): string {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_NAME)
    return base.length > 0 ? base : 'tlc-export'
}

export function buildExportDocument(
    title: string,
    content: string,
    now: () => string = () => new Date().toISOString()
): { suggestedFileName: string; body: string } {
    const timestamp = now()
    const body = `# ${title.trim() || 'TLC Assist export'}\n\n_Exported ${timestamp} from TLC Assist (sample mode)._\n\n${content.trim()}\n`
    return { suggestedFileName: `${sanitizeFileName(title)}.md`, body }
}

/** File writes are disabled in untrusted workspaces (Workspace Trust). Reads stay enabled. */
export function exportBlockedReason(isTrusted: boolean): string | undefined {
    return isTrusted ? undefined : 'Exporting writes a file, which requires a trusted workspace. Trust this workspace to export.'
}
