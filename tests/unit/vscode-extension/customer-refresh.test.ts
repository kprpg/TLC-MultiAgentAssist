import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { WorkbenchPanel } from '../../../apps/vscode-extension/src/webview-controller.js'
import { PortfolioTreeProvider } from '../../../apps/vscode-extension/src/tree/trees.js'
import { createRemoveCustomerAction } from '../../../apps/vscode-extension/src/customer-removal.js'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'

const host = vi.hoisted(() => {
    class EventEmitter<T> {
        private readonly listeners = new Set<(value: T) => void>()
        event = (listener: (value: T) => void) => {
            this.listeners.add(listener)
            return { dispose: () => { this.listeners.delete(listener) } }
        }
        fire(value: T) { for (const listener of this.listeners) listener(value) }
        dispose() { this.listeners.clear() }
    }
    class TreeItem {
        constructor(readonly label: string, readonly collapsibleState?: number) {}
    }
    class ThemeIcon {
        constructor(readonly id: string) {}
    }
    const bridge: { receive?: (message: unknown) => void } = {}
    const disposable = () => ({ dispose: vi.fn() })
    const panel = {
        visible: true, active: true, reveal: vi.fn(), dispose: vi.fn(),
        onDidDispose: disposable, onDidChangeViewState: disposable,
        webview: {
            html: '', cspSource: 'vscode-resource:',
            asWebviewUri: (uri: unknown) => uri,
            postMessage: vi.fn(async () => true),
            onDidReceiveMessage: (listener: (message: unknown) => void) => {
                bridge.receive = listener
                return disposable()
            }
        }
    }
    const uri = (path: string) => ({ fsPath: path, toString: () => path })
    return { EventEmitter, TreeItem, ThemeIcon, bridge, panel, disposable, uri, createPanel: vi.fn(() => panel) }
})

vi.mock('vscode', () => ({
    EventEmitter: host.EventEmitter, TreeItem: host.TreeItem, ThemeIcon: host.ThemeIcon,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { One: 1 },
    Uri: { file: host.uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => host.uri([base.fsPath, ...parts].join('\\')) },
    env: {}, window: { state: { focused: true }, createWebviewPanel: host.createPanel, onDidChangeWindowState: host.disposable }
}))
vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({ buildFoundryMeetingExtractor: () => undefined }))
vi.mock('../../../packages/orchestrator/voice-input.js', () => ({
    SharedVoiceInputHost: class { cancel() {}; dispose() {} }
}))

afterEach(() => {
    WorkbenchPanel.disposeCurrent()
    vi.clearAllMocks()
})

describe('native tree and workbench customer refresh', () => {
    it('refreshes native tree data after successful workbench mutations, not failed or read requests', async () => {
        const provider = createSampleDataProvider()
        const tree = new PortfolioTreeProvider(() => provider)
        const refresh = vi.spyOn(tree, 'refresh')
        const subscription = WorkbenchPanel.onDidChangePortfolio(() => tree.refresh())
        try {
            const account = (await tree.getChildren()).find((item) => item.recordId === 'account-contoso')
            if (!account) throw new Error('Expected the sample Contoso account.')
            expect((await tree.getChildren(account)).some((item) => item.kind === 'opportunity')).toBe(true)
            WorkbenchPanel.createOrShow(vscode.Uri.file('C:\\tlc-extension'), () => provider)
            host.bridge.receive?.({ kind: 'request', id: 'remove', method: 'setAccountVisibility', params: { accountId: account.recordId, visibility: 'hidden' } })
            await vi.waitFor(() => expect(host.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'remove', ok: true })))
            expect(refresh).toHaveBeenCalledOnce()
            expect((await tree.getChildren()).some((item) => item.recordId === account.recordId)).toBe(false)

            host.bridge.receive?.({ kind: 'request', id: 'invalid', method: 'setAccountVisibility', params: { accountId: account.recordId, visibility: 'deleted' } })
            host.bridge.receive?.({ kind: 'request', id: 'read', method: 'listAccounts', params: {} })
            await vi.waitFor(() => expect(host.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'invalid', ok: false })))
            await vi.waitFor(() => expect(host.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'read', ok: true })))
            expect(refresh).toHaveBeenCalledOnce()
        } finally {
            subscription.dispose()
            tree.dispose()
            await provider.setAccountVisibility('account-contoso', 'visible')
            await provider.dispose()
        }
    })

    it('refreshes the tree and reopens the active workbench after native removal', async () => {
        const provider = createSampleDataProvider()
        const tree = new PortfolioTreeProvider(() => provider)
        const uri = vscode.Uri.file('C:\\tlc-extension')
        try {
            WorkbenchPanel.createOrShow(uri, () => provider)
            const refresh = vi.spyOn(tree, 'refresh')
            const remove = createRemoveCustomerAction({
                getProvider: () => provider,
                ui: { chooseAccount: vi.fn(), confirmRemoval: async () => true, showInformation: vi.fn(), showError: vi.fn() },
                onRemoved: () => {
                    tree.refresh()
                    if (WorkbenchPanel.isOpen) {
                        WorkbenchPanel.disposeCurrent()
                        WorkbenchPanel.createOrShow(uri, () => provider)
                    }
                }
            })
            await remove('account-contoso')
            expect(refresh).toHaveBeenCalledOnce()
            expect(host.createPanel).toHaveBeenCalledTimes(2)
            expect(WorkbenchPanel.isOpen).toBe(true)
            expect((await tree.getChildren()).some((item) => item.recordId === 'account-contoso')).toBe(false)
        } finally {
            tree.dispose()
            await provider.setAccountVisibility('account-contoso', 'visible')
            await provider.dispose()
        }
    })

    it('discards an account snapshot fetched before a tree refresh', async () => {
        const provider = createSampleDataProvider()
        const tree = new PortfolioTreeProvider(() => provider)
        try {
            const before = await provider.listAccounts()
            let release!: (accounts: typeof before) => void
            vi.spyOn(provider, 'listAccounts').mockImplementationOnce(() => new Promise((done) => { release = done }))
            const pending = tree.getChildren()
            await provider.setAccountVisibility('account-contoso', 'hidden')
            tree.refresh()
            release(before)
            expect((await pending).some((item) => item.recordId === 'account-contoso')).toBe(false)
        } finally {
            tree.dispose()
            await provider.setAccountVisibility('account-contoso', 'visible')
            await provider.dispose()
        }
    })
})
