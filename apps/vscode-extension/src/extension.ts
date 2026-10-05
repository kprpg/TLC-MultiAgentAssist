import * as vscode from 'vscode'
import { createLocalStoreDataProvider, createSampleDataProvider, type ExtensionDataProvider } from './data-provider.js'
import { createLiveDataProvider } from './live-provider.js'
import { WorkbenchPanel } from './webview-controller.js'
import { acquireDelegatedToken } from './authentication.js'
import { ConnectionTreeProvider, PlaysTreeProvider, PortfolioTreeProvider, type PortfolioNode } from './tree/trees.js'
import { McpHttpClient } from '../../../packages/connectors/mcp/index.js'

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
    // Sample data source: the in-memory fixtures, or the relational SQLite test store when
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
    const makeSampleProvider = (): ExtensionDataProvider => {
        syncMeetingExtractionEnv()
        if (useLocalStore()) {
            try {
                return createLocalStoreDataProvider()
            } catch (error) {
                // node:sqlite may be unavailable on older VS Code runtimes — fall back to fixtures.
                void vscode.window.showWarningMessage(`TLC Assist could not open the SQLite test store (${error instanceof Error ? error.message : String(error)}). Using in-memory sample data.`)
            }
        }
        return createSampleDataProvider()
    }

    let provider: ExtensionDataProvider = makeSampleProvider()
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

    context.subscriptions.push(
        statusItem,
        output,
        vscode.window.registerTreeDataProvider('tlcConnection', connectionTree),
        vscode.window.registerTreeDataProvider('tlcPortfolio', portfolioTree),
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

    const refreshWorkbench = (): void => {
        if (!WorkbenchPanel.isOpen) return
        WorkbenchPanel.disposeCurrent()
        WorkbenchPanel.createOrShow(context.extensionUri, getProvider)
    }

    const addCustomer = async (): Promise<void> => {
        const matchBy = await vscode.window.showQuickPick([
            { label: 'Account name', value: 'name' as const, description: 'Search by partial customer name' },
            { label: 'TPID', value: 'tpid' as const, description: 'Search by exact TPID' }
        ], { title: 'Add customer account', placeHolder: 'Choose a search method' })
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
                description: [candidate.tpid ? `TPID ${candidate.tpid}` : undefined, candidate.segment, candidate.state === 'visible' ? 'Already added' : candidate.state === 'hidden' ? 'Hidden' : 'Available'].filter(Boolean).join(' - '),
                candidate
            })), { title: 'Select a customer account', placeHolder: 'Choose the account to add or unhide' })
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

    const setCustomerVisibility = async (node: PortfolioNode | undefined, visibility: 'visible' | 'hidden'): Promise<void> => {
        if (!node || node.kind !== 'account') return
        if (visibility === 'hidden') {
            const confirmed = await vscode.window.showWarningMessage(
                `Hide ${node.label?.toString() ?? 'this customer'} from Portfolio, Discovery, Plays, and downstream analysis? Deal Team membership will not be changed.`,
                { modal: true },
                'Hide customer'
            )
            if (confirmed !== 'Hide customer') return
        }
        try {
            await provider.setAccountVisibility(node.recordId, visibility)
            refreshAll()
            refreshWorkbench()
        } catch (error) {
            void vscode.window.showErrorMessage(`Could not ${visibility === 'hidden' ? 'hide' : 'unhide'} customer: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const swapProvider = (next: ExtensionDataProvider): void => {
        const previous = provider
        provider = next
        void Promise.resolve(previous.dispose?.()).catch(() => { /* ignore disposal errors */ })
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
            vscode.Uri.joinPath(context.globalStorageUri, 'portfolio-preferences.json').fsPath))
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
        vscode.commands.registerCommand('tlc.refresh', () => {
            refreshAll()
            void vscode.window.setStatusBarMessage('TLC Assist: data refreshed', 2000)
        }),
        vscode.commands.registerCommand('tlc.addCustomer', () => addCustomer()),
        vscode.commands.registerCommand('tlc.toggleHiddenCustomers', () => {
            const showing = portfolioTree.toggleHidden()
            void vscode.window.setStatusBarMessage(`TLC Assist: hidden customers ${showing ? 'shown' : 'hidden'}`, 2000)
        }),
        vscode.commands.registerCommand('tlc.hideCustomer', (node?: PortfolioNode) => setCustomerVisibility(node, 'hidden')),
        vscode.commands.registerCommand('tlc.unhideCustomer', (node?: PortfolioNode) => setCustomerVisibility(node, 'visible')),
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

export function deactivate(): void {
    // Tree providers and commands are disposed through context.subscriptions.
}
