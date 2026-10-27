import type { AuthenticatedRequest, WebRuntime } from './app.js'
import type { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import { renderMarkdownDocument } from '../../../packages/documents/markdown-document.js'
import {
  createBicepCliCompiler, createWorkingSessionService, deckConfigurationFromEnvironment, DownloadStore, zipOutput,
  type StructuredModel, type WorkingSessionService
} from '../../../packages/orchestrator/working-session/index.js'

export interface WorkingSessionWebHost {
  service: WorkingSessionService
  download(id: string): { fileName: string; bytes: Uint8Array } | undefined
}

export interface WebWorkingSessionOptions {
  mode: 'sample' | 'live'
  createRuntime(authentication: AuthenticatedRequest): Promise<WebRuntime> | WebRuntime
  model?: StructuredModel
  inference?: SampleInference
  environment?: Readonly<Record<string, string | undefined>>
}

/**
 * Hosted Web cannot write to the user's disk, so the folder is delivered as a short-lived zip that only the
 * requesting user can download. Local deck folders are never searched on the server.
 */
export function createWebWorkingSessionResolver(options: WebWorkingSessionOptions) {
  const store = new DownloadStore()
  const environment = options.environment ?? process.env
  const compiler = createBicepCliCompiler()
  const { githubRepositories } = deckConfigurationFromEnvironment(environment)
  return async (authentication: AuthenticatedRequest): Promise<WorkingSessionWebHost> => {
    const runtime = options.mode === 'live' ? await options.createRuntime(authentication) : undefined
    const owner = authentication.userEmail.toLowerCase()
    const githubToken = environment['TLC_GITHUB_TOKEN']?.trim()
    return {
      service: createWorkingSessionService({
        mode: options.mode, githubRepositories, ...(githubToken ? { githubToken } : {}),
        ...(options.mode === 'sample' && options.inference ? { inference: options.inference } : {}),
        openOutput: async (folderName) => zipOutput(store, owner, folderName),
        renderDocx: (title, markdown) => renderMarkdownDocument(title, markdown),
        ...(options.mode === 'live' && options.model ? { model: options.model } : {}),
        ...(options.mode === 'live' ? { compiler } : {}),
        ...(runtime ? { knowledgeSearch: runtime } : {})
      }),
      download: (id) => store.get(owner, id)
    }
  }
}
