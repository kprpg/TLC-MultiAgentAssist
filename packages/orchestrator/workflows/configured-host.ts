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
import { WorkflowRuntime, type WorkflowStepErrorInfo } from './runtime.js'

export type ConfiguredWorkflowHostOptions = {
    registry: McpServerRegistry
    policy: McpToolPolicy
    entityMap: DataverseEntityMap
    getAccessToken(server: McpServer): Promise<string>
    resolveDelegatedScope(scope: ScopeRef): DataverseDelegatedScope | Promise<DataverseDelegatedScope>
    // When false, Dataverse reads omit the explicit delegated-scope IN predicate (trust the delegated token).
    enforceDelegatedScope?: boolean
    // Caps the Dataverse read_query TOP (the OOB Dataverse MCP tool rejects requests above 20 rows).
    maximumRows?: number
    onStepError?: (info: WorkflowStepErrorInfo) => void
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
        new DataverseMcpReadAdapter({
            entityMap: options.entityMap,
            broker,
            ...(options.enforceDelegatedScope === undefined ? {} : { enforceDelegatedScope: options.enforceDelegatedScope }),
            ...(options.maximumRows === undefined ? {} : { maximumRows: options.maximumRows })
        }),
        new MsxMcpReadAdapter(broker),
        options.resolveDelegatedScope
    )
    const workflowRegistry = new WorkflowRegistry(initialWorkflowDefinitions)
    const runtime = new WorkflowRuntime(workflowRegistry, executor, {
        resultAssembler: new InitialWorkflowResultAssembler(),
        ...(options.onStepError ? { onStepError: options.onStepError } : {})
    })
    return {
        host: new SharedWorkflowHost(workflowRegistry, runtime),
        dispose: () => pool.dispose()
    }
}