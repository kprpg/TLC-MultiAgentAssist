import type {
    DataverseEntityMap,
    McpServer,
    McpServerRegistry,
    McpToolPolicy,
    ScopeRef
} from '../../common/index.js'
import { DataverseMcpReadAdapter, type DataverseDelegatedScope } from '../../connectors/dataverse-mcp/index.js'
import { McpClientPool } from '../../connectors/mcp/pool.js'
import { MsxMcpReadAdapter } from '../../connectors/msx-mcp/index.js'
import { McpToolBroker } from '../routing/mcp-tool-broker.js'
import { InitialWorkflowConnectorExecutor, InitialWorkflowResultAssembler } from './cohort-executor.js'
import { initialWorkflowDefinitions } from './cohort.js'
import { SharedWorkflowHost } from './host.js'
import { WorkflowRegistry } from './registry.js'
import { WorkflowRuntime } from './runtime.js'

export type ConfiguredWorkflowHostOptions = {
    registry: McpServerRegistry
    policy: McpToolPolicy
    entityMap: DataverseEntityMap
    getAccessToken(server: McpServer): Promise<string>
    resolveDelegatedScope(scope: ScopeRef): DataverseDelegatedScope | Promise<DataverseDelegatedScope>
}

export type ConfiguredWorkflowHost = {
    host: SharedWorkflowHost
    dispose(): Promise<void>
}

export function createConfiguredWorkflowHost(options: ConfiguredWorkflowHostOptions): ConfiguredWorkflowHost {
    const pool = new McpClientPool({
        registry: options.registry,
        accessTokenProvider: (server) => options.getAccessToken(server)
    })
    const broker = new McpToolBroker({
        registry: options.registry,
        policy: options.policy,
        invokeTool: (serverId, tool, args, signal) => pool.callTool(serverId, tool, args, signal)
    })
    const executor = new InitialWorkflowConnectorExecutor(
        new DataverseMcpReadAdapter({ entityMap: options.entityMap, broker }),
        new MsxMcpReadAdapter(broker),
        options.resolveDelegatedScope
    )
    const workflowRegistry = new WorkflowRegistry(initialWorkflowDefinitions)
    const runtime = new WorkflowRuntime(workflowRegistry, executor, {
        resultAssembler: new InitialWorkflowResultAssembler()
    })
    return {
        host: new SharedWorkflowHost(workflowRegistry, runtime),
        dispose: () => pool.dispose()
    }
}