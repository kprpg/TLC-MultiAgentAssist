import * as vscode from 'vscode'
import type { ExtensionDataProvider } from '../data-provider.js'

type Refreshable = { readonly onDidChangeTreeData: vscode.Event<void>; refresh(): void }

class RefreshEmitter {
    protected readonly emitter = new vscode.EventEmitter<void>()
    readonly onDidChangeTreeData = this.emitter.event
    refresh(): void { this.emitter.fire() }
    dispose(): void { this.emitter.dispose() }
}

/** Connection view: identity, data mode, and source health at a glance. */
export class ConnectionTreeProvider extends RefreshEmitter implements vscode.TreeDataProvider<vscode.TreeItem>, Refreshable {
    constructor(private readonly provider: () => ExtensionDataProvider) { super() }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element }

    async getChildren(): Promise<vscode.TreeItem[]> {
        const provider = this.provider()
        const email = await provider.getCurrentUserEmail().catch(() => undefined)
        const modeItem = new vscode.TreeItem(`Mode: ${provider.mode === 'live' ? 'Live' : 'Sample'}`)
        modeItem.iconPath = new vscode.ThemeIcon(provider.mode === 'live' ? 'broadcast' : 'beaker')
        modeItem.tooltip = provider.mode === 'live'
            ? 'Live delegated data. Reads are bounded by the MCP tool policy.'
            : 'Sanitized sample data. No network calls are made.'
        const identityItem = new vscode.TreeItem(`Identity: ${email ?? 'Not signed in (sample)'}`)
        identityItem.iconPath = new vscode.ThemeIcon('account')
        const msxItem = new vscode.TreeItem('MSX: sample')
        msxItem.iconPath = new vscode.ThemeIcon('database')
        const mcemItem = new vscode.TreeItem('MCEM guidance: sample')
        mcemItem.iconPath = new vscode.ThemeIcon('book')
        return [modeItem, identityItem, msxItem, mcemItem]
    }
}

class PortfolioNode extends vscode.TreeItem {
    constructor(
        readonly kind: 'account' | 'opportunity',
        readonly recordId: string,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        readonly accountId?: string
    ) {
        super(label, collapsibleState)
        this.contextValue = kind
        this.iconPath = new vscode.ThemeIcon(kind === 'account' ? 'organization' : 'target')
        if (kind === 'opportunity') {
            this.command = {
                command: 'tlc.open',
                title: 'Open in TLC Assist',
                arguments: [{ accountId, opportunityId: recordId }]
            }
        }
    }
}

/** Portfolio view: lazy Accounts -> Opportunities navigation. */
export class PortfolioTreeProvider extends RefreshEmitter implements vscode.TreeDataProvider<PortfolioNode>, Refreshable {
    private readonly opportunityCache = new Map<string, PortfolioNode[]>()

    constructor(private readonly provider: () => ExtensionDataProvider) { super() }

    override refresh(): void {
        this.opportunityCache.clear()
        super.refresh()
    }

    getTreeItem(element: PortfolioNode): vscode.TreeItem { return element }

    async getChildren(element?: PortfolioNode): Promise<PortfolioNode[]> {
        const provider = this.provider()
        if (!element) {
            const accounts = await provider.listAccounts()
            return accounts.map((account) => new PortfolioNode('account', account.id, account.name, vscode.TreeItemCollapsibleState.Collapsed))
        }
        if (element.kind === 'account') {
            const cached = this.opportunityCache.get(element.recordId)
            if (cached) return cached
            const opportunities = await provider.listOpportunities(element.recordId)
            const nodes = opportunities.map((opportunity) => new PortfolioNode('opportunity', opportunity.id, opportunity.name, vscode.TreeItemCollapsibleState.None, element.recordId))
            this.opportunityCache.set(element.recordId, nodes)
            return nodes
        }
        return []
    }
}

class PlaysNode extends vscode.TreeItem {
    constructor(
        readonly kind: 'group' | 'play' | 'run',
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        readonly groupId?: 'recommended' | 'all' | 'runs',
        readonly workflowId?: string
    ) {
        super(label, collapsibleState)
        this.contextValue = kind
        if (kind === 'play' && workflowId) {
            this.iconPath = new vscode.ThemeIcon('play-circle')
            this.command = { command: 'tlc.runPlay', title: 'Run Play', arguments: [{ workflowId }] }
        } else if (kind === 'group') {
            this.iconPath = new vscode.ThemeIcon('list-tree')
        } else {
            this.iconPath = new vscode.ThemeIcon('history')
        }
    }
}

const RECOMMENDED_PLAYS = new Set(['WF-001', 'WF-002', 'WF-005'])

/** Plays view: recommended plays, the full catalog, and recent runs. */
export class PlaysTreeProvider extends RefreshEmitter implements vscode.TreeDataProvider<PlaysNode>, Refreshable {
    constructor(private readonly provider: () => ExtensionDataProvider) { super() }

    getTreeItem(element: PlaysNode): vscode.TreeItem { return element }

    async getChildren(element?: PlaysNode): Promise<PlaysNode[]> {
        const provider = this.provider()
        if (!element) {
            return [
                new PlaysNode('group', 'Recommended for my role', vscode.TreeItemCollapsibleState.Expanded, 'recommended'),
                new PlaysNode('group', 'All plays', vscode.TreeItemCollapsibleState.Collapsed, 'all'),
                new PlaysNode('group', 'Recent runs', vscode.TreeItemCollapsibleState.Collapsed, 'runs')
            ]
        }
        if (element.groupId === 'runs') {
            const runs = await provider.listWorkflowRuns(undefined, 10)
            if (runs.length === 0) return [new PlaysNode('run', 'No runs yet', vscode.TreeItemCollapsibleState.None)]
            return runs.map((run) => new PlaysNode('run', `${run.workflowId} - ${run.status}`, vscode.TreeItemCollapsibleState.None))
        }
        const definitions = await provider.listWorkflowDefinitions('portfolio')
        const filtered = element.groupId === 'recommended'
            ? definitions.filter((definition) => RECOMMENDED_PLAYS.has(definition.id))
            : definitions
        return filtered.map((definition) => {
            const node = new PlaysNode('play', definition.name, vscode.TreeItemCollapsibleState.None, element.groupId, definition.id)
            node.description = definition.id
            node.tooltip = `${definition.name} (${definition.id})`
            return node
        })
    }
}
