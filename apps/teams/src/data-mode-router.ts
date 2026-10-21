import type { IncomingMessage, ServerResponse } from 'node:http'
import { teamsDataModesSchema, teamsDataModeVersion, type TeamsDataMode } from '../../../packages/common/contracts/teams-data-mode.js'
import { isLocalConfiguration, type TeamsConfiguration } from './configuration.js'

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>

export function createTeamsDataModeRouter({ configuration, initialMode = configuration.mode, sample, live }: {
  configuration: TeamsConfiguration; initialMode?: TeamsDataMode; sample: Handler; live?: Handler
}) {
  if (configuration.mode === 'live' && !live) throw new Error('A live runtime requires its authenticated handler.')
  const modes = teamsDataModesSchema.parse({
    contractVersion: teamsDataModeVersion, initialMode, runtimeMode: configuration.mode,
    runtimeAuthentication: isLocalConfiguration(configuration) ? configuration.authentication : 'hosted-obo',
    availableModes: live ? ['sample', 'live'] : ['sample']
  })
  const defaultHandler = configuration.mode === 'live' && live ? live : sample
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', configuration.origin)
    if (request.method === 'GET' && url.pathname === '/api/teams/modes') {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(modes))
      return true
    }
    const match = /^\/api\/teams\/(sample|live)(\/.*)$/.exec(url.pathname)
    if (!match) return defaultHandler(request, response)
    const handler = match[1] === 'sample' ? sample : live
    if (!handler) {
      response.statusCode = 409
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify({ error: 'live_mode_not_configured' }))
      return true
    }
    const original = request.url
    request.url = `/api/teams${match[2]}${url.search}`
    try { return await handler(request, response) }
    finally { request.url = original }
  }
}
