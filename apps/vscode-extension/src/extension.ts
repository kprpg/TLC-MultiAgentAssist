import * as vscode from 'vscode'
import { createSampleDataProvider, type ExtensionDataProvider } from './data-provider.js'
import { createLiveDataProvider } from './live-provider.js'
import { WorkbenchPanel } from './webview-controller.js'
import { acquireDelegatedToken } from './authentication.js'
import { ConnectionTreeProvider, PlaysTreeProvider, PortfolioTreeProvider } from './tree/trees.js'
import { McpHttpClient } from '../../../packages/connectors/mcp/index.js'

function readMode(): 'sample' | 'live' {
    return vscode.workspace.getConfiguration('tlc').get<'sample' | 'live'>('mode', 'sample')
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
    let provider: ExtensionDataProvider = createSampleDataProvider()
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
    const applyMode = async (): Promise<void> => {
        if (readMode() === 'sample') {
            if (provider.mode !== 'sample') swapProvider(createSampleDataProvider())
            return
        }
        try {
            const resource = dynamicsResource()
            const { account } = await acquireDelegatedToken(resource, true)
            const tokenProvider = async (): Promise<string> => (await acquireDelegatedToken(resource, true)).token
            swapProvider(createLiveDataProvider(tokenProvider, account, (info) => {
                output.appendLine(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? 'required' : 'optional'} failed: ${info.message}`)
                if (info.required) output.show(true)
            }, vscode.workspace.getConfiguration('tlc').get<boolean>('useFoundryAgents', true)))
            void vscode.window.showInformationMessage(`TLC Assist is now using live data for ${account} (MSX OData + Dataverse MCP).`)
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            if (provider.mode !== 'sample') swapProvider(createSampleDataProvider())
            void vscode.window.showErrorMessage(`TLC Assist could not switch to live data: ${detail}. Staying on sample data.`)
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('tlc.open', (focus?: { accountId?: string; opportunityId?: string }) => {
            WorkbenchPanel.createOrShow(context.extensionUri, getProvider, focus)
        }),
        vscode.commands.registerCommand('tlc.refresh', () => {
            refreshAll()
            void vscode.window.setStatusBarMessage('TLC Assist: data refreshed', 2000)
        }),
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
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('tlc.mode')) return
            void applyMode()
        })
    )

    if (readMode() === 'live') void applyMode()

    if (vscode.workspace.getConfiguration('tlc').get<boolean>('openOnStartup', true)) {
        // Defer so activation and the tree views become responsive before the webview builds.
        setTimeout(() => WorkbenchPanel.createOrShow(context.extensionUri, getProvider), 0)
    }
}

export function deactivate(): void {
    // Tree providers and commands are disposed through context.subscriptions.
}
