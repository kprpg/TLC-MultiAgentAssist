import type { MsxBrokerRequest, MsxBrokerResult, MsxToolBroker } from './adapter.js'

export class FixtureMsxMcpBroker implements MsxToolBroker {
    readonly calls: MsxBrokerRequest[] = []

    constructor(private readonly results: Readonly<Record<string, unknown>>) { }

    async execute(request: MsxBrokerRequest): Promise<MsxBrokerResult> {
        this.calls.push(request)
        if (request.serverId !== 'msx') throw new Error('Fixture MSX MCP broker only supports the MSX server.')
        const data = this.results[request.tool]
        if (data === undefined) throw new Error(`No fixture exists for MSX MCP tool ${request.tool}.`)
        const recordCount = Array.isArray(data) ? data.length : data === null ? 0 : 1
        return { kind: 'untrusted-mcp-data', data: structuredClone(data), recordCount, truncated: false }
    }
}