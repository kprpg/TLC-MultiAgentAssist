import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'

const host = vi.hoisted(() => {
    const disposable = () => ({ dispose: vi.fn() })
    const settings = new Map<string, unknown>()
    const commands = new Map<string, () => unknown>()
    const listeners = new Set<(event: { affectsConfiguration(section: string): boolean }) => void>()
    const update = vi.fn(async (key: string, value: unknown) => {
        settings.set(key, value)
        for (const listener of listeners) listener({ affectsConfiguration: (section) => section === `tlc.${key}` })
    })
    const createLiveProvider = vi.fn((getToken: () => Promise<string>, account: string) => ({
        mode: 'live' as const, getSourceToken: getToken, account, dispose: vi.fn(async () => {})
    }))
    const createSampleProvider = vi.fn(() => ({ mode: 'sample' as const, dispose: vi.fn(async () => {}) }))
    class TreeProvider {
        refresh = vi.fn()
        dispose = vi.fn()
    }
    return {
        disposable, settings, commands, listeners, update, createLiveProvider, createSampleProvider, TreeProvider,
        getSession: vi.fn(), showError: vi.fn(), showInformation: vi.fn(),
        uri: (path: string) => ({ fsPath: path, toString: () => path })
    }
})

vi.mock('vscode', () => ({
    authentication: { getSession: host.getSession },
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    StatusBarAlignment: { Left: 1 },
    Uri: { file: host.uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => host.uri([base.fsPath, ...parts].join('\\')) },
    commands: {
        registerCommand: (command: string, handler: () => unknown) => {
            host.commands.set(command, handler)
            return host.disposable()
        }
    },
    workspace: {
        getConfiguration: () => ({
            get: (key: string, fallback: unknown) => host.settings.has(key) ? host.settings.get(key) : fallback,
            update: host.update
        }),
        onDidChangeConfiguration: (listener: (event: { affectsConfiguration(section: string): boolean }) => void) => {
            host.listeners.add(listener)
            return { dispose: () => { host.listeners.delete(listener) } }
        }
    },
    window: {
        state: { focused: true },
        createStatusBarItem: () => ({ show: vi.fn(), ...host.disposable() }),
        createOutputChannel: () => ({ appendLine: vi.fn(), ...host.disposable() }),
        createTreeView: () => ({ visible: false, onDidChangeVisibility: host.disposable, ...host.disposable() }),
        registerTreeDataProvider: host.disposable,
        onDidChangeWindowState: host.disposable,
        showErrorMessage: host.showError,
        showInformationMessage: host.showInformation
    }
}))
vi.mock('../../../apps/vscode-extension/src/data-provider.js', () => ({
    createSampleDataProvider: host.createSampleProvider,
    createLocalStoreDataProvider: host.createSampleProvider
}))
vi.mock('../../../apps/vscode-extension/src/live-provider.js', () => ({
    configuredFoundryTenantId: () => undefined,
    createLiveDataProvider: host.createLiveProvider
}))
vi.mock('../../../apps/vscode-extension/src/presentation-provider.js', () => ({
    withPresentationCache: (provider: unknown) => provider
}))
vi.mock('../../../apps/vscode-extension/src/tree/trees.js', () => ({
    ConnectionTreeProvider: host.TreeProvider,
    PortfolioTreeProvider: host.TreeProvider,
    PlaysTreeProvider: host.TreeProvider
}))
vi.mock('../../../apps/vscode-extension/src/webview-controller.js', () => ({
    WorkbenchPanel: { isOpen: false, onDidChangePortfolio: host.disposable }
}))
vi.mock('../../../apps/vscode-extension/src/customer-removal.js', () => ({
    createRemoveCustomerAction: () => vi.fn()
}))

import { activate, deactivate } from '../../../apps/vscode-extension/src/extension.js'

const session: vscode.AuthenticationSession = {
    id: 'test-session', accessToken: 'msx-token',
    account: { id: 'seller-account', label: 'seller@microsoft.com' },
    scopes: ['https://microsoftsales.crm.dynamics.com/.default']
}

function command(name: string): void {
    const handler = host.commands.get(name)
    if (!handler) throw new Error(`Command ${name} was not registered.`)
    handler()
}

describe('extension live sign-in lifecycle', () => {
    let subscriptions: vscode.Disposable[] = []

    beforeEach(() => {
        vi.clearAllMocks()
        host.getSession.mockReset()
        host.settings.clear()
        host.commands.clear()
        host.listeners.clear()
        host.settings.set('mode', 'sample')
        host.settings.set('dataStore', 'fixture')
        host.settings.set('openOnStartup', false)
        vi.stubEnv('TLC_MODE', 'sample')
        vi.stubEnv('TLC_DATA_STORE', 'fixture')
        vi.stubEnv('TLC_BACKGROUND_SYNC', '0')
        subscriptions = []
        activate({
            subscriptions,
            extensionUri: vscode.Uri.file('C:\\tlc-auth-test'),
            globalStorageUri: vscode.Uri.file('C:\\tlc-auth-test\\storage')
        } as vscode.ExtensionContext)
    })

    afterEach(async () => {
        await deactivate()
        for (const subscription of subscriptions) subscription.dispose()
        host.listeners.clear()
        vi.unstubAllEnvs()
    })

    it('does not persist a failed live switch or trigger another configuration-driven sign-in', async () => {
        host.getSession.mockRejectedValue(new Error('User cancelled sign-in.'))
        command('tlc.useLiveData')
        await vi.waitFor(() => expect(host.showError).toHaveBeenCalledOnce())
        expect(host.getSession).toHaveBeenCalledOnce()
        expect(host.update).not.toHaveBeenCalled()
        expect(host.settings.get('mode')).toBe('sample')
        expect(host.createLiveProvider).not.toHaveBeenCalled()
    })

    it('allows an explicit retry and silently obtains tokens after a successful live switch', async () => {
        host.getSession.mockRejectedValueOnce(new Error('User cancelled sign-in.'))
        command('tlc.useLiveData')
        await vi.waitFor(() => expect(host.showError).toHaveBeenCalledOnce())
        host.getSession.mockResolvedValue(session)
        command('tlc.useLiveData')
        await vi.waitFor(() => expect(host.update).toHaveBeenCalledWith('mode', 'live', vscode.ConfigurationTarget.Global))
        expect(host.createLiveProvider).toHaveBeenCalledOnce()
        expect(host.getSession).toHaveBeenCalledTimes(2)

        const getToken = host.createLiveProvider.mock.calls[0]?.[0]
        if (!getToken) throw new Error('Expected a live token provider.')
        await expect(getToken()).resolves.toBe('msx-token')
        expect(host.getSession).toHaveBeenLastCalledWith('microsoft', session.scopes, {
            silent: true, account: session.account
        })
    })

    it('does not reopen the browser on repeated live refreshes after the session disappears', async () => {
        host.getSession.mockResolvedValue(session)
        command('tlc.useLiveData')
        await vi.waitFor(() => expect(host.update).toHaveBeenCalledOnce())
        const getToken = host.createLiveProvider.mock.calls[0]?.[0]
        if (!getToken) throw new Error('Expected a live token provider.')
        host.getSession.mockResolvedValue(undefined)
        await expect(getToken()).rejects.toThrow('TLC: Use Live Data')
        await expect(getToken()).rejects.toThrow('TLC: Use Live Data')
        expect(host.getSession.mock.calls.filter((call) => call[2].createIfNone)).toHaveLength(1)
        expect(host.createLiveProvider).toHaveBeenCalledOnce()
    })

    it('keeps sample mode credential-free', async () => {
        command('tlc.useSampleData')
        await vi.waitFor(() => expect(host.update).toHaveBeenCalledWith('mode', 'sample', vscode.ConfigurationTarget.Global))
        expect(host.getSession).not.toHaveBeenCalled()
        expect(host.createLiveProvider).not.toHaveBeenCalled()
    })
})
