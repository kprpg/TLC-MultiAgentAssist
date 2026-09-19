import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { routeBridgeMessage } from './host-router.js'
import { exportBlockedReason, sanitizeFileName } from './export-document.js'
import { hostEventSchema, type HostEvent } from './message-contracts.js'
import { contractVersion } from '../../../packages/common/index.js'
import { createResponseDocumentBuffer } from '../../desktop/electron/main/response-document.js'
import { createOutlookDraftMessage } from '../../desktop/electron/main/outlook-compose.js'
import type { ExtensionDataProvider } from './data-provider.js'

function nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let text = ''
    for (let i = 0; i < 32; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length))
    return text
}

/** Owns the single editor-area workbench webview and its validated message bridge. */
export class WorkbenchPanel {
    private static current: WorkbenchPanel | undefined
    private readonly disposables: vscode.Disposable[] = []
    private ready = false
    private pending: { kind: 'focus'; accountId?: string; opportunityId?: string } | { kind: 'runPlay'; workflowId: string; token: number } | undefined

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly getProvider: () => ExtensionDataProvider
    ) {
        this.panel.webview.onDidReceiveMessage((message) => void this.onMessage(message), undefined, this.disposables)
        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables)
        this.render()
    }

    static createOrShow(
        extensionUri: vscode.Uri,
        getProvider: () => ExtensionDataProvider,
        focus?: { accountId?: string; opportunityId?: string }
    ): WorkbenchPanel {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One
        if (WorkbenchPanel.current) {
            WorkbenchPanel.current.panel.reveal(column)
            if (focus) WorkbenchPanel.current.focus(focus)
            return WorkbenchPanel.current
        }
        const panel = vscode.window.createWebviewPanel('tlcWorkbench', 'TLC Assist', column, {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')]
        })
        WorkbenchPanel.current = new WorkbenchPanel(panel, extensionUri, getProvider)
        if (focus) WorkbenchPanel.current.focus(focus)
        return WorkbenchPanel.current
    }

    postEvent(event: HostEvent): void {
        void this.panel.webview.postMessage(hostEventSchema.parse(event))
    }

    /** True when the single workbench panel is currently open. */
    static get isOpen(): boolean {
        return WorkbenchPanel.current !== undefined
    }

    /** Dispose the open panel (used to force a fresh reload after a data-mode swap). */
    static disposeCurrent(): void {
        WorkbenchPanel.current?.dispose()
    }

    /** Select an account/opportunity in the webview once it is ready. */
    focus(focus: { accountId?: string; opportunityId?: string }): void {
        this.pending = { kind: 'focus', ...focus }
        if (this.ready) void this.panel.webview.postMessage(this.pending)
    }

    /** Trigger a play run in the webview once it is ready. */
    runPlay(workflowId: string): void {
        this.pending = { kind: 'runPlay', workflowId, token: Date.now() }
        if (this.ready) void this.panel.webview.postMessage(this.pending)
    }

    private flushPending(): void {
        void this.panel.webview.postMessage({ kind: 'event', type: 'init', payload: { mode: this.getProvider().mode } })
        if (this.pending) void this.panel.webview.postMessage(this.pending)
    }

    private async onMessage(message: unknown): Promise<void> {
        const kind = (message as { kind?: unknown }).kind
        if (kind === 'ready') {
            this.ready = true
            this.flushPending()
            return
        }
        if (message && typeof message === 'object' && (message as { method?: unknown }).method === 'openEvidence') {
            await this.handleOpenEvidence(message)
            return
        }
        if (message && typeof message === 'object' && (message as { method?: unknown }).method === 'exportContent') {
            await this.handleExport(message)
            return
        }
        if (message && typeof message === 'object' && (message as { method?: unknown }).method === 'composeEmail') {
            await this.handleComposeEmail(message)
            return
        }
        const response = await routeBridgeMessage(this.getProvider(), message)
        void this.panel.webview.postMessage(response)
    }

    private async handleOpenEvidence(message: unknown): Promise<void> {
        const id = (message as { id?: unknown }).id
        const responseId = typeof id === 'string' ? id : 'unknown'
        const url = (message as { params?: { url?: unknown } }).params?.url
        try {
            if (typeof url !== 'string') throw new Error('An evidence URL is required.')
            const parsed = vscode.Uri.parse(url, true)
            if (parsed.scheme !== 'https') throw new Error('Only https evidence links can be opened.')
            await vscode.env.openExternal(parsed)
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: true, result: null })
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'The evidence link could not be opened.'
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: false, error: { message: detail, code: 'open_evidence_failed' } })
        }
    }

    private async handleExport(message: unknown): Promise<void> {
        const id = (message as { id?: unknown }).id
        const responseId = typeof id === 'string' ? id : 'unknown'
        const params = (message as { params?: { title?: unknown; content?: unknown } }).params
        try {
            if (!params || typeof params.title !== 'string' || typeof params.content !== 'string') {
                throw new Error('A title and content are required to export.')
            }
            const blocked = exportBlockedReason(vscode.workspace.isTrusted)
            if (blocked) throw new Error(blocked)
            const buffer = await createResponseDocumentBuffer({
                contractVersion,
                responseTitle: params.title,
                responseMarkdown: params.content,
                generatedAt: new Date().toISOString()
            })
            const target = await vscode.window.showSaveDialog({
                saveLabel: 'Export',
                defaultUri: vscode.Uri.joinPath(this.defaultExportFolder(), `${sanitizeFileName(params.title)}.docx`),
                filters: { 'Word document': ['docx'] }
            })
            if (!target) {
                void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: true, result: { saved: false } })
                return
            }
            await vscode.workspace.fs.writeFile(target, new Uint8Array(buffer))
            await vscode.env.openExternal(target)
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: true, result: { saved: true } })
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'The export could not be completed.'
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: false, error: { message: detail, code: 'export_failed' } })
        }
    }

    private defaultExportFolder(): vscode.Uri {
        return vscode.workspace.workspaceFolders?.[0]?.uri ?? this.extensionUri
    }

    private async handleComposeEmail(message: unknown): Promise<void> {
        const id = (message as { id?: unknown }).id
        const responseId = typeof id === 'string' ? id : 'unknown'
        const params = (message as { params?: { subject?: unknown; title?: unknown; body?: unknown } }).params
        try {
            if (!params || typeof params.subject !== 'string' || typeof params.title !== 'string' || typeof params.body !== 'string') {
                throw new Error('A subject, title, and body are required to draft an email.')
            }
            const blocked = exportBlockedReason(vscode.workspace.isTrusted)
            if (blocked) throw new Error('Drafting an email writes a temporary file, which requires a trusted workspace.')
            const recipientsRaw = await vscode.window.showInputBox({
                title: 'TLC Assist email draft',
                prompt: 'Recipient email address(es), comma-separated',
                placeHolder: 'name@contoso.com',
                ignoreFocusOut: true
            })
            if (recipientsRaw === undefined) {
                void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: true, result: { drafted: false } })
                return
            }
            const recipients = recipientsRaw.split(',').map((value) => value.trim()).filter(Boolean)
            if (recipients.length === 0 || !recipients.every((value) => /.+@.+\..+/.test(value))) {
                throw new Error('Enter at least one valid recipient email address.')
            }
            const draft = createOutlookDraftMessage({
                contractVersion,
                recipients,
                subject: params.subject,
                responseTitle: params.title,
                responseMarkdown: params.body
            })
            const file = vscode.Uri.file(join(tmpdir(), `tlc-assist-${Date.now()}.eml`))
            await vscode.workspace.fs.writeFile(file, Buffer.from(draft, 'utf8'))
            await vscode.env.openExternal(file)
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: true, result: { drafted: true } })
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'The email draft could not be opened.'
            void this.panel.webview.postMessage({ kind: 'response', id: responseId, ok: false, error: { message: detail, code: 'compose_email_failed' } })
        }
    }

    private render(): void {
        const webview = this.panel.webview
        const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'webview.js'))
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'webview.css'))
        const cspNonce = nonce()
        const provider = this.getProvider()
        webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${cspNonce}';" />
<link href="${styleUri}" rel="stylesheet" />
<title>TLC Assist</title>
</head>
<body>
<div id="root" data-mode="${provider.mode}">Loading TLC Assist\u2026</div>
<script nonce="${cspNonce}">window.addEventListener('error',function(e){var r=document.getElementById('root');if(r)r.textContent='TLC Assist error: '+(e.message||'script failed to load');});window.addEventListener('unhandledrejection',function(e){var r=document.getElementById('root');if(r)r.textContent='TLC Assist error: '+((e.reason&&e.reason.message)||e.reason||'promise rejected');});</script>
<script nonce="${cspNonce}" src="${scriptUri}"></script>
</body>
</html>`
    }

    dispose(): void {
        WorkbenchPanel.current = undefined
        while (this.disposables.length) this.disposables.pop()?.dispose()
        this.panel.dispose()
    }
}
