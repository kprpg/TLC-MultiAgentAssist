export type MeetingSourceFailure =
  | 'not-configured' | 'sign-in-required' | 'denied' | 'admin-blocked'
  | 'not-found' | 'unavailable' | 'no-transcript' | 'too-large'
  | 'cli-sign-in' | 'sign-in-failed'

/** A user-safe failure from the Teams meeting source. The message never contains tokens or record identifiers. */
export class MeetingSourceError extends Error {
  constructor(readonly code: MeetingSourceFailure, message: string) {
    super(message)
    this.name = 'MeetingSourceError'
  }
}

const pasteHint = 'You can still use Paste / upload with a transcript you are authorized to provide.'

export const meetingSourceMessages: Record<MeetingSourceFailure, string> = {
  'not-configured': `Automatic Teams meeting lookup needs delegated Microsoft Graph access, which this connection does not provide. ${pasteHint}`,
  'sign-in-required': `Microsoft Graph sign-in or consent is required to list your Teams meetings. Approve the Calendars, Online meetings and transcript permissions, then try again. ${pasteHint}`,
  denied: `Microsoft Graph did not allow access to your calendar, this meeting or its transcript. The account may lack the delegated permissions, or you may not be the organizer or an authorized attendee. ${pasteHint}`,
  'admin-blocked': `Your organization has blocked Graph transcript access, and this app cannot bypass that policy. ${pasteHint}`,
  'not-found': `That meeting is no longer in your recent calendar, or its Teams identity could not be verified. Refresh the list and choose again. ${pasteHint}`,
  unavailable: `Microsoft Graph meeting lookup is temporarily unavailable. Try again later. ${pasteHint}`,
  'no-transcript': `No transcript is available for this meeting yet. Transcription may not have been turned on, may still be processing, or you may not be the organizer or an authorized attendee. Choose another meeting. ${pasteHint}`,
  'too-large': `This meeting's transcript is larger than the supported review size. ${pasteHint}`,
  'cli-sign-in': `This connection uses Azure CLI sign-in, which cannot read your calendar or meeting transcripts. Switch to interactive sign-in (authentication mode "interactive-browser") and approve the Calendars permission, or use Paste / upload. ${pasteHint}`,
  'sign-in-failed': `The Microsoft sign-in needed to list your Teams meetings did not complete. ${pasteHint}`
}

/** Collapses a host sign-in failure (never a token) into one short, printable line for the user. */
export function meetingSignInFailure(reason: unknown): MeetingSourceError {
  const text = (reason instanceof Error ? reason.message : String(reason)).replace(/[^\x20-\x7E]+/g, ' ').trim().slice(0, 160)
  const base = meetingSourceMessages['sign-in-failed']
  return new MeetingSourceError('sign-in-failed', text ? `${base} Reason: ${text}` : base)
}

export function meetingSourceError(code: MeetingSourceFailure, reference?: string): MeetingSourceError {
  const base = meetingSourceMessages[code]
  return new MeetingSourceError(code, reference && /^[A-Za-z0-9_]{1,100}$/.test(reference) ? `${base} (reference ${reference})` : base)
}

/**
 * Azure CLI tokens do not carry calendar or meeting permissions. Reading the token's own `scp` claim lets the host say so
 * instead of making a Graph call that can only fail. Opaque or scope-less tokens are left for Graph to judge.
 */
export function assertCliTokenCanReadMeetings(token: string, purpose: 'list' | 'transcript'): string {
  const payload = token.split('.')[1]
  let scopes: string[] | undefined
  try {
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as { scp?: unknown }
    if (typeof claims.scp === 'string') scopes = claims.scp.split(' ')
  } catch { return token }
  if (!scopes) return token
  const required = purpose === 'list' ? 'Calendars.' : 'OnlineMeetingTranscript.'
  if (!scopes.some((scope) => scope.startsWith(required))) throw meetingSourceError('cli-sign-in')
  return token
}
