import type { TokenCredential } from '@azure/core-auth'
import type { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import { foundryEnvironmentSchema } from '../../../packages/common/configuration/foundry-environment.js'
import foundryEnvironmentJson from '../../../config/foundry.environment.json' with { type: 'json' }
import { createFoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'
import type { KnowledgeSearch } from '../../../packages/orchestrator/knowledge-search.js'
import { renderMarkdownDocument } from '../../../packages/documents/markdown-document.js'
import {
    createBicepCliCompiler, createWorkingSessionService, deckConfigurationFromEnvironment, folderOutput, foundryStructuredModel,
    resolveDocumentsFolder, workingSessionModelName, type WorkingSessionService
} from '../../../packages/orchestrator/working-session/index.js'

/** One assembly path for the extension host: files go to Documents\TLC\<folder>, local decks are searchable. */
export function createExtensionWorkingSession(options: {
    mode: 'sample' | 'live'
    knowledgeSearch?: KnowledgeSearch
    foundryCredential?: TokenCredential | undefined
    environment?: NodeJS.ProcessEnv
    inference?: SampleInference
}): WorkingSessionService {
    const environment = options.environment ?? process.env
    const modelName = options.mode === 'live' ? workingSessionModelName(environment) : undefined
    const parsed = options.mode === 'live' && options.foundryCredential ? foundryEnvironmentSchema.safeParse(foundryEnvironmentJson) : undefined
    const model = modelName && parsed?.success && options.foundryCredential
        ? foundryStructuredModel(createFoundryOpenAIClient(parsed.data.foundry.projectEndpoint, options.foundryCredential), modelName)
        : undefined
    const githubToken = environment['TLC_GITHUB_TOKEN']?.trim()
    return createWorkingSessionService({
        mode: options.mode,
        ...(options.inference ? { inference: options.inference } : {}),
        openOutput: async (folderName) => folderOutput(await resolveDocumentsFolder(environment), folderName),
        renderDocx: (title, markdown) => renderMarkdownDocument(title, markdown),
        ...deckConfigurationFromEnvironment(environment),
        ...(githubToken ? { githubToken } : {}),
        ...(options.knowledgeSearch ? { knowledgeSearch: options.knowledgeSearch } : {}),
        ...(options.mode === 'live' ? { compiler: createBicepCliCompiler() } : {}),
        ...(model ? { model } : {})
    })
}
