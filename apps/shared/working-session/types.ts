import type {
  WorkingSessionPrepareRequest, WorkingSessionResult, WorkingSessionTopicRequest, WorkingSessionTopicResponse
} from '../../../packages/common/contracts/working-session.js'
import type { OperationResultSession } from '../operation-result-session.js'

/** What every surface provides to the shared launcher. Folder hosts open the folder; hosted hosts download the zip. */
export interface WorkingSessionClient {
  readonly cacheSession?: { readonly operationResults: OperationResultSession }
  deriveWorkingSessionTopic(request: WorkingSessionTopicRequest): Promise<WorkingSessionTopicResponse>
  prepareWorkingSession(request: WorkingSessionPrepareRequest): Promise<WorkingSessionResult>
  openWorkingSessionFolder?(folderPath: string): Promise<void>
  downloadWorkingSession?(downloadId: string, fileName: string): Promise<void>
}
