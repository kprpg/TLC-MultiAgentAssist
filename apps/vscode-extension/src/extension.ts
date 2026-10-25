import * as vscode from 'vscode'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createLocalStoreDataProvider, createSampleDataProvider, type ExtensionDataProvider } from './data-provider.js'
import { configuredFoundryTenantId, createLiveDataProvider } from './live-provider.js'
import { WorkbenchPanel } from './webview-controller.js'
import { acquireDelegatedToken, createVsCodeTokenCredential } from './authentication.js'
import { ConnectionTreeProvider, PlaysTreeProvider, PortfolioTreeProvider, type PortfolioNode } from './tree/trees.js'
import { McpHttpClient } from '../../../packages/connectors/mcp/index.js'
import { createRemoveCustomerAction } from './customer-removal.js'
import { withPresentationCache } from './presentation-provider.js'
import { localMutationState, protectedMutationKey } from '../../../packages/connectors/common/mutation-state.js'
import { createMutationSession } from '../../../packages/orchestrator/mutations/composition.js'
import { MutationSyncClient } from '../../shared/mutation-sync.js'
import { accountSchema } from '../../../packages/common/contracts/index.js'
import { seismicGraphScopes } from '../../../packages/common/configuration/knowledge-sources.js'
import { meetingScopesFor, type MeetingTokenPurpose } from '../../../packages/common/configuration/meeting-sources.js'
import { meetingSignInFailure } from '../../../packages/connectors/common/meeting-source.js'

let disposeCurrentProvider: (() => Promise<void>) | undefined

function readMode(): 'sample' | 'live' {
    return vscode.workspace.getConfiguration('tlc').get<'sample' | 'live'>('mode', 'sample')
}

/** Startup default: the TLC_MODE env (set by the F5 launch configs) if present, else the tlc.mode setting. */
function startupMode(): 'sample' | 'live' {
    const env = (process.env['TLC_MODE'] ?? '').toLowerCase()
    return env === 'live' || env === 'sample' ? env : readMode()
}

function dynamicsResource(): string {
    return vscode.workspace.getConfiguration('tlc').get<string>('dynamicsResource', 'https://microsoftsales.crm.dynamics.com').replace(/\/+$/, '')
}

/**
 * Increment 0.3 auth spike: acquire a delegated token and run one bounded read against the
 * Dynamics Web API to prove (or disprove) live access. The token is never logged.
 */
async function testLiveConnection(output: vscode.OutputChannel): Promise<void> {
    const resource = vscode.workspace.getConfiguration('tlc').get<string>('dynamicsResource', 'https://microsoftsales.crm.dynamics.com').replace(/\/+$/, '')
    output.clear()
    output.show(true)
    output.appendLine(`[${new Date().toISOString()}] TLC Assist live connection test`)
    output.appendLine(`Resource: ${resource}`)
    try {
        output.appendLine('Acquiring delegated Microsoft token...')
        const { token, account } = await acquireDelegatedToken(resource, true)
        output.appendLine(`Token acquired for ${account} (length ${token.length}).`)
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'OData-MaxVersion': '4.0',
            'OData-Version': '4.0'
        }
        const whoResponse = await fetch(`${resource}/api/data/v9.2/WhoAmI`, { headers })
        output.appendLine(`WhoAmI: HTTP ${whoResponse.status} ${whoResponse.statusText}`)
        if (whoResponse.ok) {
            const who = await whoResponse.json() as { UserId?: string; BusinessUnitId?: string }
            output.appendLine(`  UserId=${who.UserId ?? 'n/a'} BusinessUnitId=${who.BusinessUnitId ?? 'n/a'}`)
        } else {
            output.appendLine(`  ${(await whoResponse.text()).slice(0, 600)}`)
        }
        const oppResponse = await fetch(`${resource}/api/data/v9.2/opportunities?$select=name&$top=1`, { headers })
        output.appendLine(`opportunities?$top=1: HTTP ${oppResponse.status} ${oppResponse.statusText}`)
        if (oppResponse.ok) {
            const body = await oppResponse.json() as { value?: Array<{ name?: string }> }
            output.appendLine(`  rows=${body.value?.length ?? 0}${body.value?.[0]?.name ? ` first="${body.value[0].name}"` : ''}`)
        } else {
            output.appendLine(`  ${(await oppResponse.text()).slice(0, 600)}`)
        }
        const mcpOk = await testMcpEndpoint(output, `${resource}/api/mcp`, token)
        if (oppResponse.ok && mcpOk) {
            void vscode.window.showInformationMessage('TLC Assist live connection succeeded (OData + MCP). See the TLC Assist output for details.')
        } else if (oppResponse.ok) {
            void vscode.window.showWarningMessage('TLC Assist OData read succeeded but the MCP endpoint did not. See the TLC Assist output.')
        } else {
            void vscode.window.showWarningMessage(`TLC Assist token acquired but the OData read returned HTTP ${oppResponse.status}. See the TLC Assist output.`)
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        output.appendLine(`ERROR: ${detail}`)
        void vscode.window.showErrorMessage(`TLC Assist live connection failed: ${detail}`)
    }
}

/** Probes the MCP endpoint with the delegated token: initialize + tools/list. */
async function testMcpEndpoint(output: vscode.OutputChannel, mcpUrl: string, token: string): Promise<boolean> {
    output.appendLine(`MCP endpoint: ${mcpUrl}`)
    const client = new McpHttpClient({
        serverUrl: mcpUrl,
        accessTokenProvider: async () => token,
        timeoutMs: 30_000,
        maxResponseBytes: 1_000_000
    })
    try {
        await client.initialize()
        output.appendLine('MCP initialize: OK')
        const listed = await client.listTools()
        const names = listed.tools.map((tool) => tool.name)
        output.appendLine(`MCP tools/list: ${names.length} tools`)
        if (names.length > 0) output.appendLine(`  ${names.slice(0, 20).join(', ')}`)
        const readQuery = listed.tools.find((tool) => tool.name === 'read_query')
        if (readQuery) {
            output.appendLine(`read_query inputSchema: ${JSON.stringify(readQuery.inputSchema).slice(0, 300)}`)
            // Discovers the real logical column names so the entity map can be corrected.
            const probes = [
                'SELECT TOP 1 * FROM msp_engagementmilestone',
                'SELECT TOP 1 * FROM opportunity'
            ]
            for (const querytext of probes) {
                try {
                    const probe = await client.callTool('read_query', { querytext })
                    output.appendLine(`read_query OK [${querytext}] => ${JSON.stringify(probe).slice(0, 2000)}`)
                } catch (probeError) {
                    output.appendLine(`read_query ERR [${querytext}] => ${probeError instanceof Error ? probeError.message : String(probeError)}`)
                }
            }
        } else {
            output.appendLine('read_query tool not present in tools/list.')
        }
        return true
    } catch (error) {
        output.appendLine(`MCP ERROR: ${error instanceof Error ? error.message : String(error)}`)
        return false
    } finally {
        await client.dispose().catch(() => { /* ignore disposal errors */ })
    }
}

export function activate(context: vscode.ExtensionContext): void {
    // Sample data source: the in-memory fixtures, or the persistent SQLite test store when
    // `tlc.dataStore` is `sqlite` (or TLC_DATA_STORE=sqlite). Live mode is unaffected.
    const useLocalStore = (): boolean =>
        vscode.workspace.getConfiguration('tlc').get<'fixture' | 'sqlite'>('dataStore', 'fixture') === 'sqlite'
        || (process.env['TLC_DATA_STORE'] ?? '').toLowerCase() === 'sqlite'
    // Reflect the meeting-extractor settings into the environment the providers read, unless the
    // environment already pins them (e.g. an F5 launch config). `foundry` sends transcripts to a
    // deployed Foundry model; `deterministic` keeps the offline rules.
    const syncMeetingExtractionEnv = (force = false): void => {
        const config = vscode.workspace.getConfiguration('tlc')
        if (force || !process.env['TLC_MEETING_EXTRACTOR']) {
            process.env['TLC_MEETING_EXTRACTOR'] = config.get<'deterministic' | 'foundry'>('meetingExtractor', 'deterministic')
        }
        if (force || !process.env['TLC_MEETING_MODEL']) {
            process.env['TLC_MEETING_MODEL'] = config.get<string>('meetingModel', 'gpt-6.1-sol')
        }
    }
    const foundryTenantId = configuredFoundryTenantId()
    const foundryCredential = foundryTenantId ? createVsCodeTokenCredential(foundryTenantId) : undefined
    const makeSampleProvider = (): ExtensionDataProvider => {
        syncMeetingExtractionEnv()
        if (useLocalStore()) {
            try {
                return createLocalStoreDataProvider({
                    foundryCredential,
                    storePath: process.env['TLC_DATA_STORE_PATH']?.trim() || resolve(context.globalStorageUri.fsPath, 'sample.sqlite')
                })
            } catch (error) {
                // Older VS Code runtimes may lack node:sqlite; make the no-write fallback explicit.
                void vscode.window.showWarningMessage(`TLC Assist could not open the SQLite test store (${error instanceof Error ? error.message : String(error)}). Using in-memory fixtures; record creation is draft-only until SQLite is available.`)
            }
        }
        return createSampleDataProvider()
    }

    const prepareProvider = (raw: ExtensionDataProvider): ExtensionDataProvider => {
        const result = withPresentationCache(raw)
        const enabled = process.env['TLC_BACKGROUND_SYNC'] === '1'
        const root = resolve(context.globalStorageUri.fsPath, 'mutation-state')
        if ((!enabled && !existsSync(resolve(root, `${raw.mode}.sqlite`))) || !raw.sourceCore) return result
        const core = raw.sourceCore
        let current = true
        const state = (async () => {
            const key = raw.mode === 'live' ? await protectedMutationKey({
                lockPath: resolve(root, 'key-init.lock'),
                read: async () => context.secrets.get('tlc.mutation-state-key.v1'),
                write: async (value) => context.secrets.store('tlc.mutation-state-key.v1', value)
            }) : undefined
            return localMutationState(resolve(root, `${raw.mode}.sqlite`), key)
        })()
        const mutations = state.then((store) => createMutationSession({
            core, mode: raw.mode, source: `vscode:${dynamicsResource()}`, state: store,
            enabled, readCacheOwner: 'host', isCurrent: () => current,
            ...(raw.getSourceToken ? { getToken: raw.getSourceToken } : {}),
            conditionalOperations: () => core.conditionalWriteOperations(),
            applyMeeting: (input) => raw.applyMeetingChangeSet(input)
        }))
        result.mutationSync = async (request) => (await mutations).invoke(request)
        const nativeSync = new MutationSyncClient(result.mutationSync, { onAccessDenied: () => result.cacheSession?.clear() })
        const addAccount = result.addAccount
        const setAccountVisibility = result.setAccountVisibility
        result.addAccount = (accountId) => nativeSync.run('addAccount', { accountId }, () => addAccount(accountId), accountSchema.parse)
        result.setAccountVisibility = (accountId, visibility) => nativeSync.run('setAccountVisibility', { accountId, visibility },
            () => setAccountVisibility(accountId, visibility), accountSchema.parse)
        result.drainMutations = async () => { await (await mutations).drain() }
        const dispose = result.dispose
        result.dispose = async () => {
            try { await result.drainMutations?.() } finally {
                current = false
                nativeSync.dispose()
                await dispose()
                const storage = await state
                storage.close()
            }
        }
        void mutations.catch(() => { void vscode.window.showWarningMessage('Protected mutation receipt storage is unavailable. Reconnect after checking the configured runtime and encryption key.') })
        return result
    }
    let provider: ExtensionDataProvider = prepareProvider(makeSampleProvider())
    disposeCurrentProvider = () => provider.dispose()
    const getProvider = (): ExtensionDataProvider => provider

    const connectionTree = new ConnectionTreeProvider(getProvider)
    const portfolioTree = new PortfolioTreeProvider(getProvider)
    const playsTree = new PlaysTreeProvider(getProvider)

    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    statusItem.command = 'tlc.open'
    const output = vscode.window.createOutputChannel('TLC Assist')
    const updateStatus = (): void => {
        statusItem.text = `$(rocket) TLC Assist: ${provider.mode === 'live' ? 'Live' : 'Sample'}`
        statusItem.tooltip = 'Open the TLC Assist workbench'
        statusItem.show()
    }
    updateStatus()

    const portfolioView = vscode.window.createTreeView('tlcPortfolio', { treeDataProvider: portfolioTree })
    const updateCacheInterest = () => provider.setCacheInterest?.('native-tree', ['portfolio'], portfolioView.visible && vscode.window.state.focused)
    const stopData = () => {
        let generation = provider.cacheSession?.cache.generation
        return provider.cacheSession?.subscribe(() => {
            const state = provider.cacheSession?.getState()
            const changedScope = generation !== state?.generation
            generation = state?.generation
            if (!state?.refreshing && (changedScope || state?.error || provider.cacheSession?.cache.has('portfolio'))) portfolioTree.refresh()
        })
    }
    let stopCacheData = stopData()
    updateCacheInterest()
    context.subscriptions.push(
        statusItem,
        output,
        vscode.window.registerTreeDataProvider('tlcConnection', connectionTree),
        portfolioView,
        portfolioView.onDidChangeVisibility(updateCacheInterest),
        vscode.window.onDidChangeWindowState(updateCacheInterest),
        { dispose: () => stopCacheData?.() },
        vscode.window.registerTreeDataProvider('tlcPlays', playsTree),
        connectionTree,
        portfolioTree,
        playsTree
    )

    const refreshAll = (): void => {
        connectionTree.refresh()
        portfolioTree.refresh()
        playsTree.refresh()
    }
    context.subscriptions.push(WorkbenchPanel.onDidChangePortfolio(refreshAll))

    const refreshWorkbench = (): void => {
        provider.cacheSession?.cache.changed()
    }

    const addCustomer = async (): Promise<void> => {
        const matchBy = await vscode.window.showQuickPick([
            { label: 'Account name', value: 'name' as const, description: 'Search by exact, partial, or close customer name' },
            { label: 'TPID', value: 'tpid' as const, description: 'Search by exact TPID' }
        ], { title: 'Add customer account', placeHolder: provider.mode === 'sample' ? 'Sample data only - choose a search method' : 'Live MSX - choose a search method' })
        if (!matchBy) return
        const query = await vscode.window.showInputBox({
            title: `Add customer by ${matchBy.label}`,
            prompt: matchBy.value === 'name' ? 'Enter at least two characters of the account name.' : 'Enter the exact TPID.',
            validateInput: (value) => matchBy.value === 'name' && value.trim().length < 2 ? 'Enter at least two characters.' : value.trim() ? undefined : 'A value is required.'
        })
        if (!query) return
        try {
            const candidates = await provider.searchAccounts({ query, matchBy: matchBy.value })
            if (candidates.length === 0) {
                void vscode.window.showInformationMessage('No matching customer accounts were found.')
                return
            }
            const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
                label: candidate.name,
                description: [candidate.tpid ? `TPID ${candidate.tpid}` : undefined, candidate.segment, candidate.state === 'visible' ? 'Already added' : candidate.state === 'hidden' ? 'Add again' : 'Available'].filter(Boolean).join(' - '),
                candidate
            })), {
                title: 'Select a customer account',
                placeHolder: candidates.length >= 25
                    ? 'Showing up to 25 results - refine your search if needed'
                    : matchBy.value === 'tpid' && candidates.length > 1
                        ? 'Multiple accounts share this TPID - choose the intended account'
                        : 'Choose the intended account to add or add again'
            })
            if (!picked) return
            if (picked.candidate.state === 'visible') {
                void vscode.window.showInformationMessage(`${picked.candidate.name} is already in your Portfolio.`)
                return
            }
            if (picked.candidate.state === 'hidden') await provider.setAccountVisibility(picked.candidate.id, 'visible')
            else await provider.addAccount(picked.candidate.id)
            refreshAll()
            refreshWorkbench()
            void vscode.window.showInformationMessage(`${picked.candidate.name} is now available in Portfolio and Discovery.`)
        } catch (error) {
            void vscode.window.showErrorMessage(`Could not add customer: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const removeCustomer = createRemoveCustomerAction({
        getProvider,
        ui: {
            chooseAccount: async (accounts) => (await vscode.window.showQuickPick(accounts.map((account) => ({
                label: account.name,
                description: [account.tpid ? `TPID ${account.tpid}` : undefined, account.segment].filter(Boolean).join(' - '),
                accountId: account.id
            })), { title: 'Remove customer account', placeHolder: 'Choose a tracked customer to remove from this TLC portfolio' }))?.accountId,
            confirmRemoval: async (account) => (await vscode.window.showWarningMessage(
                `Remove ${account.name}${account.tpid ? ` (TPID ${account.tpid})` : ''} from this TLC portfolio?`,
                { modal: true, detail: "This affects this app/profile's Portfolio, Discovery, search, New account selectors, and future Plays only. MSX/Dataverse records and team membership will not change. Saved Play runs and the official Seller Dashboard are unchanged. Use Add customer to add it again." },
                'Remove customer'
            )) === 'Remove customer',
            showInformation: (message) => { void vscode.window.showInformationMessage(message) },
            showError: (message) => { void vscode.window.showErrorMessage(message) }
        },
        onRemoved: () => {
            refreshAll()
            refreshWorkbench()
        }
    })

    const swapProvider = (next: ExtensionDataProvider): void => {
        const previous = provider
        stopCacheData?.()
        provider = prepareProvider(next)
        stopCacheData = stopData()
        updateCacheInterest()
        void Promise.resolve(previous.dispose?.()).catch(() => {
            output.appendLine('[mutation-sync] previous-source-shutdown-unconfirmed')
            void vscode.window.showWarningMessage('The previous source could not close cleanly. Check pending source receipts after reconnecting; do not repeat uncertain writes.')
        })
        updateStatus()
        refreshAll()
        if (WorkbenchPanel.isOpen) {
            WorkbenchPanel.disposeCurrent()
            WorkbenchPanel.createOrShow(context.extensionUri, getProvider)
        }
    }

    // Async because live mode acquires a delegated token before building the provider.
    const applyMode = async (target: 'sample' | 'live'): Promise<void> => {
        if (target === 'sample') {
            if (provider.mode !== 'sample') swapProvider(makeSampleProvider())
            return
        }
        try {
            const resource = dynamicsResource()
            const { account } = await acquireDelegatedToken(resource, true)
            const tokenProvider = async (): Promise<string> => (await acquireDelegatedToken(resource, true)).token
            syncMeetingExtractionEnv()
            swapProvider(createLiveDataProvider(tokenProvider, account, (info) => {
                output.appendLine(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} failed: ${info.message}`)
                if (info.required) output.show(true)
            },
            vscode.workspace.getConfiguration('tlc').get<boolean>('useFoundryAgents', true),
            vscode.Uri.joinPath(context.globalStorageUri, 'portfolio-preferences.json').fsPath,
            foundryCredential, async (reportingResource) => {
                const resourceUrl = reportingResource === 'powerbi' ? 'https://analysis.windows.net/powerbi/api' : 'https://graph.microsoft.com'
                const granted = await acquireDelegatedToken(resourceUrl, true)
                if (granted.account.toLowerCase() !== account.toLowerCase()) throw new Error('The reporting source account must match the TLC account.')
                return granted.token
            }, async () => {
                const session = await vscode.authentication.getSession('microsoft', [...seismicGraphScopes], { createIfNone: true })
                if (!session || session.account.label.toLowerCase() !== account.toLowerCase()) {
                    throw new Error('The Seismic Graph session must match the TLC account.')
                }
                return session.accessToken
            }, async (purpose: MeetingTokenPurpose) => {
                const purposeScopes = (value: MeetingTokenPurpose) => [...meetingScopesFor(value)]
                let session: vscode.AuthenticationSession | undefined
                try {
                    session = await vscode.authentication.getSession('microsoft', purposeScopes(purpose), { createIfNone: true })
                } catch (error) { throw meetingSignInFailure(error) }
                if (!session || session.account.label.toLowerCase() !== account.toLowerCase()) {
                    throw meetingSignInFailure(`the Microsoft account used for Teams meetings (${session?.account.label ?? 'none'}) is not the TLC account`)
                }
                return session.accessToken
            }))
            void vscode.window.showInformationMessage(`TLC Assist is now using live data for ${account} (MSX OData + Dataverse MCP).`)
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            if (provider.mode !== 'sample') swapProvider(makeSampleProvider())
            void vscode.window.showErrorMessage(`TLC Assist could not switch to live data: ${detail}. Staying on sample data.`)
        }
    }

    // Switch immediately (with feedback) and persist the choice; the listener stays idempotent.
    const setMode = async (mode: 'sample' | 'live'): Promise<void> => {
        await applyMode(mode)
        const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global
        try {
            await vscode.workspace.getConfiguration('tlc').update('mode', mode, target)
        } catch { /* settings may be read-only in some hosts; the in-session swap already happened */ }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('tlc.open', (focus?: { accountId?: string; opportunityId?: string }) => {
            WorkbenchPanel.createOrShow(context.extensionUri, getProvider, focus)
        }),
        vscode.commands.registerCommand('tlc.refresh', async () => {
            try {
                provider.cacheSession?.cache.recovered()
                provider.cacheSession?.refresh()
                await provider.getPortfolioIndex({ contractVersion: '1.0', includeHidden: true })
                refreshAll()
                void vscode.window.setStatusBarMessage('TLC Assist: source data refreshed', 2000)
            } catch {
                void vscode.window.showErrorMessage('TLC could not refresh the current source. Check your connection and reconnect before retrying.')
            }
        }),
        vscode.commands.registerCommand('tlc.addCustomer', () => addCustomer()),
        vscode.commands.registerCommand('tlc.removeCustomer', (node?: PortfolioNode) => removeCustomer(node?.kind === 'account' ? node.recordId : undefined)),
        vscode.commands.registerCommand('tlc.hideCustomer', (node?: PortfolioNode) => removeCustomer(node?.kind === 'account' ? node.recordId : undefined)),
        vscode.commands.registerCommand('tlc.toggleHiddenCustomers', () => addCustomer()),
        vscode.commands.registerCommand('tlc.unhideCustomer', () => addCustomer()),
        vscode.commands.registerCommand('tlc.runPlay', (arg?: { workflowId?: string }) => {
            const panel = WorkbenchPanel.createOrShow(context.extensionUri, getProvider)
            if (arg?.workflowId) panel.runPlay(arg.workflowId)
        }),
        vscode.commands.registerCommand('tlc.openRun', () => {
            WorkbenchPanel.createOrShow(context.extensionUri, getProvider)
        }),
        vscode.commands.registerCommand('tlc.showConnection', () => {
            void vscode.commands.executeCommand('tlcConnection.focus')
        }),
        vscode.commands.registerCommand('tlc.testLiveConnection', () => testLiveConnection(output)),
        vscode.commands.registerCommand('tlc.useLiveData', () => void setMode('live')),
        vscode.commands.registerCommand('tlc.useSampleData', () => void setMode('sample')),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('tlc.meetingExtractor') || event.affectsConfiguration('tlc.meetingModel')) {
                syncMeetingExtractionEnv(true)
                if (readMode() === 'sample') swapProvider(makeSampleProvider())
                else void applyMode('live')
                return
            }
            if (event.affectsConfiguration('tlc.dataStore') && readMode() === 'sample') {
                swapProvider(makeSampleProvider())
                return
            }
            if (!event.affectsConfiguration('tlc.mode')) return
            const desired = readMode()
            // Idempotent: skip if a command already applied this mode; apply manual setting edits.
            if (desired !== provider.mode) void applyMode(desired)
        })
    )

    if (startupMode() === 'live') void applyMode('live')

    if (vscode.workspace.getConfiguration('tlc').get<boolean>('openOnStartup', true)) {
        // Defer so activation and the tree views become responsive before the webview builds.
        setTimeout(() => WorkbenchPanel.createOrShow(context.extensionUri, getProvider), 0)
    }
}

export async function deactivate(): Promise<void> {
    await disposeCurrentProvider?.()
    disposeCurrentProvider = undefined
}
