/** Delegated Microsoft Graph permissions for listing recent Teams meetings and reading their transcripts. */
export const meetingGraphScopes = [
  'https://graph.microsoft.com/Calendars.Read',
  'https://graph.microsoft.com/OnlineMeetings.Read',
  'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All'
] as const
/** Listing the dropdown needs only user-consentable permissions; transcript scopes are requested on Extract. */
export const meetingListScopes = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Calendars.Read'
] as const
export const meetingGraphDefaultScope = 'https://graph.microsoft.com/.default'

export type MeetingTokenPurpose = 'list' | 'transcript'
export const meetingScopesFor = (purpose: MeetingTokenPurpose): readonly string[] => purpose === 'list' ? meetingListScopes : meetingGraphScopes

export const recentMeetingWindowDays = 14
export const recentMeetingLimit = 25
