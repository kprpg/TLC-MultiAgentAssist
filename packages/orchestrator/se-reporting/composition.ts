import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TokenCredential } from '@azure/core-auth'
import { loadFoundryEnvironmentFromEnvironment } from '../../common/configuration/foundry-environment.js'
import { createFoundryOpenAIClient } from '../../connectors/foundry/index.js'
import type { SeDataverseSource } from '../../connectors/se-reporting/dataverse.js'
import { FileSeProfileStore } from '../../connectors/se-reporting/profiles.js'
import { LiveSeReportingSource } from '../../connectors/se-reporting/publish.js'
import { createSeNarrativeSynthesizer } from '../../connectors/se-reporting/synthesis.js'
import { SeReportingError, type SeReportingResource } from '../../connectors/se-reporting/types.js'
export { seReportingScopes } from '../../connectors/se-reporting/types.js'
import { SharedSeReportingHost, type SeReportingHost, type SeReportingOwner } from './host.js'
import { createSampleSeReportingHost } from './sample.js'
import type { SampleInference } from '../sample-inference.js'

export function resolveSeSourcePreference(environment: NodeJS.ProcessEnv): 'powerbi' | 'dataverse' | 'auto' {
    const value = environment['TLC_SE_SOURCE']?.trim().toLowerCase()
    return value === 'auto' || value === 'dataverse' ? value : 'powerbi'
}

export function createSeReportingHost(options: {
    mode: 'sample' | 'live'
    identity(): Promise<SeReportingOwner | undefined>
    getToken?(resource: SeReportingResource): Promise<string>
    foundryCredential?: TokenCredential
    inference?: SampleInference
    environment?: NodeJS.ProcessEnv
    profileDirectory?: string
    fetcher?: typeof fetch
    /** Delegated MSX Dataverse access for the Dataverse-first milestone/task provider (see TLC_SE_SOURCE). */
    dataverse?: SeDataverseSource
}): SeReportingHost {
    if (options.mode === 'sample') return createSampleSeReportingHost(options.inference ? { inference: options.inference } : {})
    const environment = options.environment ?? process.env
    const source = new LiveSeReportingSource({
        getToken: async (resource) => {
            if (!options.getToken) throw new SeReportingError('reporting-grant-unavailable', 'This host has no delegated reporting source grant.')
            return options.getToken(resource)
        },
        expectedEmail: async () => (await options.identity())?.email,
        expectedObjectId: async () => (await options.identity())?.objectId,
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        ...(options.dataverse ? { dataverse: options.dataverse, sourcePreference: resolveSeSourcePreference(environment) } : {}),
        ...(environment['TLC_MSX_RISK_DETAILS_FIELD']?.trim() ? { riskField: environment['TLC_MSX_RISK_DETAILS_FIELD'].trim() } : {})
    })
    let model: ReturnType<typeof createSeNarrativeSynthesizer> | undefined
    return new SharedSeReportingHost({
        mode: 'live', owner: options.identity, source,
        profiles: new FileSeProfileStore(options.profileDirectory ?? environment['TLC_SE_REPORTING_PROFILE_DIR'] ?? join(homedir(), '.tlc', 'se-reporting', 'profiles')),
        synthesize: async (input) => {
            if (!model) {
                if (!options.foundryCredential) throw new SeReportingError('reporting-model-unconfigured', 'This host has no approved Foundry narrative credential. Configure it separately from the delegated reporting sources.')
                const foundry = await loadFoundryEnvironmentFromEnvironment(environment, process.cwd())
                const deployment = environment['TLC_SE_REPORTING_MODEL']?.trim()
                if (!deployment) throw new SeReportingError('reporting-model-unconfigured', 'Set TLC_SE_REPORTING_MODEL to an approved deployed model name before live report generation.')
                model = createSeNarrativeSynthesizer({
                    client: createFoundryOpenAIClient(foundry.foundry.projectEndpoint, options.foundryCredential),
                    model: deployment, timeoutMs: foundry.foundry.requestTimeoutMs
                })
            }
            return model(input)
        },
        onError: (code) => console.warn(`[se-reporting] ${code}`)
    })
}
