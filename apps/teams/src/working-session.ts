import { principalPartition, type ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import type { ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { renderMarkdownDocument } from '../../../packages/documents/markdown-document.js'
import {
  createBicepCliCompiler, createWorkingSessionService, deckConfigurationFromEnvironment, DownloadStore, zipOutput,
  type StructuredModel, type WorkingSessionService
} from '../../../packages/orchestrator/working-session/index.js'

export interface TeamsWorkingSessionHost {
  service(principal: ExecutionPrincipal, services: ApplicationServices): WorkingSessionService
  download(principal: ExecutionPrincipal, id: string): { fileName: string; bytes: Uint8Array } | undefined
}

/** Teams hosts cannot write to the user's disk, so the folder is a short-lived zip only the same user can download. */
export function createTeamsWorkingSessionHost(options: {
  mode: 'sample' | 'live'
  model?: StructuredModel | undefined
  environment?: Readonly<Record<string, string | undefined>>
}): TeamsWorkingSessionHost {
  const store = new DownloadStore()
  const environment = options.environment ?? process.env
  const compiler = options.mode === 'live' ? createBicepCliCompiler() : undefined
  const { githubRepositories } = deckConfigurationFromEnvironment(environment)
  const githubToken = environment['TLC_GITHUB_TOKEN']?.trim()
  return {
    service: (principal, services) => createWorkingSessionService({
      mode: options.mode, githubRepositories, knowledgeSearch: services.orchestrator,
      ...(githubToken ? { githubToken } : {}),
      openOutput: async (folderName) => zipOutput(store, principalPartition(principal), folderName),
      renderDocx: (title, markdown) => renderMarkdownDocument(title, markdown),
      ...(compiler ? { compiler } : {}),
      ...(options.mode === 'live' && options.model ? { model: options.model } : {})
    }),
    download: (principal, id) => store.get(principalPartition(principal), id)
  }
}
