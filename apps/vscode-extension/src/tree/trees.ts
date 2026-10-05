import * as vscode from 'vscode'
import type { ExtensionDataProvider } from '../data-provider.js'
import { buildConnectionItems } from './connection-items.js'

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
        return buildConnectionItems(provider.mode, email).map((item) => {
            const treeItem = new vscode.TreeItem(item.label)
            treeItem.iconPath = new vscode.ThemeIcon(item.icon)
            if (item.tooltip) treeItem.tooltip = item.tooltip
            return treeItem
        })
    }
}

export class PortfolioNode extends vscode.TreeItem {
    constructor(
        readonly kind: 'account' | 'opportunity' | 'empty',
        readonly recordId: string,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        readonly accountId?: string,
        readonly hidden = false
    ) {
        super(label, collapsibleState)
        this.contextValue = kind === 'account' ? (hidden ? 'accountHidden' : 'accountVisible') : kind
        this.iconPath = new vscode.ThemeIcon(kind === 'account' ? (hidden ? 'eye-closed' : 'organization') : kind === 'empty' ? 'info' : 'target')
        if (hidden) this.description = 'Hidden'
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
    private showHidden = false

    constructor(private readonly provider: () => ExtensionDataProvider) { super() }

    toggleHidden(): boolean {
        this.showHidden = !this.showHidden
        this.refresh()
        return this.showHidden
    }

    override refresh(): void {
        this.opportunityCache.clear()
        super.refresh()
    }

    getTreeItem(element: PortfolioNode): vscode.TreeItem { return element }

    async getChildren(element?: PortfolioNode): Promise<PortfolioNode[]> {
        const provider = this.provider()
        if (!element) {
            const accounts = await provider.listAccounts({ includeHidden: this.showHidden })
            return accounts.map((account) => new PortfolioNode(
                'account',
                account.id,
                account.name,
                account.visibility === 'hidden' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                account.visibility === 'hidden'
            ))
        }
        if (element.kind === 'account') {
            if (element.hidden) return []
            const cached = this.opportunityCache.get(element.recordId)
            if (cached) return cached
            const opportunities = await provider.listOpportunities(element.recordId)
            const nodes = opportunities.map((opportunity) => new PortfolioNode('opportunity', opportunity.id, opportunity.name, vscode.TreeItemCollapsibleState.None, element.recordId))
            if (nodes.length === 0) {
                nodes.push(new PortfolioNode('empty', `${element.recordId}:empty`, 'No Deal Team opportunities - use Discovery', vscode.TreeItemCollapsibleState.None, element.recordId))
            }
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
            this.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('textLink.foreground'))
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
