import { z } from 'zod'
import { acquisitionSchema } from '../../../../packages/common/contracts/collaboration.js'
import { meetingChangeSetProposalSchema } from '../../../../packages/common/contracts/meeting.js'
import { TeamsRequestError } from './data-client.js'

export const meetingResultSchema = z.object({
  status: acquisitionSchema, proposals: z.array(meetingChangeSetProposalSchema),
  subscription: z.object({ state: z.enum(['active', 'unconfirmed', 'foreground-only']), detail: z.string() }).optional()
}).strict()
export type MeetingResult = z.infer<typeof meetingResultSchema>

const messages: Record<string, string> = {
  local_read_only: 'This Azure CLI connection is read-only. You can extract and inspect transcript suggestions, but applying them requires an explicitly enabled reviewed-write profile and your source permissions. No source change was sent.',
  graph_unavailable_in_cli_profile: 'This Azure CLI profile provides MSX access, not Microsoft Graph meeting lookup. Use Paste / upload for a transcript you are authorized to provide. Automatic lookup requires a separately approved Graph-enabled profile.',
  graph_auth_required: 'Meeting lookup requires a separate Microsoft Graph connection or renewed consent. Your MSX connection has not been changed. Use Paste / upload, or connect Graph through your approved profile.',
  graph_denied: 'Microsoft Graph did not grant this user access to the meeting or transcript. Check the meeting account and delegated meeting permissions, or use Paste / upload with an authorized transcript.',
  graph_admin_blocked: 'Your organization has blocked Graph transcript access. Contact your administrator; the app cannot bypass this policy. You can use Paste / upload only with a transcript you are authorized to provide.',
  graph_invalid_meeting_link: 'Paste a valid HTTPS Teams meeting join link from teams.microsoft.com or teams.cloud.microsoft.',
  graph_unsupported: 'This meeting or transcript is unavailable through the current Graph lookup. Check the meeting join link and account, or use Paste / upload.',
  graph_paused: 'Graph meeting lookup is temporarily unavailable or its request budget is paused. Try again later, or use Paste / upload.',
  empty_transcript: 'No readable transcript segments were found. Choose a WebVTT (.vtt) or text (.txt) transcript containing spoken content.',
  too_many_transcript_segments: 'This transcript exceeds 2,000 segments. Provide a shorter authorized transcript.'
}

export function meetingCaptureError(cause: unknown): string {
  if (cause instanceof TeamsRequestError && messages[cause.code]) {
    return `${messages[cause.code]}${cause.correlationId ? ` (reference ${cause.correlationId})` : ''}`
  }
  return cause instanceof Error ? cause.message : String(cause)
}
