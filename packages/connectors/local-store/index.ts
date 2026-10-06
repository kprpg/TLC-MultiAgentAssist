import {
  accountSchema,
  discoverableOpportunitySchema,
  meetingChangeSetApprovalSchema,
  meetingChangeSetProposalSchema,
  meetingChangeSetResultSchema,
  meetingTranscriptSchema,
  meetingTranscriptSummarySchema,
  milestoneSchema,
  createMilestoneActivityRequestSchema,
  opportunitySchema,
  type Account,
  type AccountCandidate,
  type AccountListOptions,
  type AccountSearchRequest,
  type AccountVisibility,
  type CreateMilestoneActivityRequest,
  type DealTeamJoinResult,
  type DealTeamLeaveResult,
  type DiscoverableOpportunity,
  type MeetingChangeSetApproval,
  type MeetingChangeSetProposal,
  type MeetingChangeSetResult,
  type MeetingInjectItemResult,
  type MeetingTranscript,
  type MeetingTranscriptSummary,
  type Milestone,
  type MilestoneActivity,
  type MilestoneTeamJoinResult,
  type MilestoneTeamLeaveResult,
  type MilestoneUpdate,
  type Opportunity,
  type OpportunityUpdate,
  type SeDomainId
} from '../../common/index.js'
import type { CriterionObservation, MsxConnector, OpportunityContext } from '../common/index.js'
import {
  extractMeetingSignals,
  MEETING_FIELD_DICTIONARY,
  type ExtractorMilestoneSnapshot,
  type ExtractorOpportunitySnapshot,
  type FieldDictionaryEntry,
  type MeetingExtractionContext
} from '../../agents/meeting-signal-extractor/src/index.js'
import { randomUUID } from 'node:crypto'
import { LocalStore } from './local-store.js'
import {
  ACTIVITY_STATUS,
  BUDGET_STATUS,
  COMMITMENT,
  MILESTONE_STATUS,
  NEED,
  OPPORTUNITY_RATING,
  PURCHASE_PROCESS,
  SAMPLE_USER_ID,
  TIMELINE
} from './seed.js'

export { LocalStore } from './local-store.js'
export * from './seed.js'
export { LOCAL_STORE_SCHEMA } from './schema.js'

/** A meeting / activity tied to an opportunity (mirrors MSX activitypointer / appointment). */
export interface ActivityView {
  id: string
  opportunityId: string
  subject: string
  owner?: string
  activityType?: string
  scheduledStart?: string
  scheduledEnd?: string
  status: string
  isOnlineMeeting: boolean
  onlineMeetingJoinUrl?: string
  location?: string
  description?: string
}

/** A meeting transcript with diarized, timestamped segments (evidence units for extraction). */
export interface TranscriptSegmentView {
  id: string
  startMs?: number
  endMs?: number
  speaker?: string
  speakerRole?: string
  text: string
}
export interface TranscriptView {
  id: string
  opportunityId: string
  activityId?: string
  meetingType: string
  title?: string
  source?: string
  occurredAt: string
  segments: TranscriptSegmentView[]
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** Formats a comment entry per the additive protocol: `<INITIALS> <M/D/YYYY> <text>`. */
export function formatCommentEntry(initials: string, text: string, when: Date = new Date()): string {
  const date = `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`
  return `${initials} ${date} ${text}`
}

/** Prepends a new entry to existing comments (newest-first), preserving history. */
export function prependComment(existing: string | undefined, entry: string): string {
  return existing && existing.trim().length > 0 ? `${entry}\n${existing}` : entry
}

/** Reverse-maps an option label to its numeric code. */
function reverseOption(map: Readonly<Record<number, string>>, label: string): number | undefined {
  const match = Object.entries(map).find(([, l]) => l === label)
  return match ? Number(match[0]) : undefined
}

/** Request for a meeting change-set proposal: anchor opportunity + a transcript source. */
export interface ProposeMeetingChangeSetRequest {
  opportunityId: string
  /** A seeded transcript id (sample path). */
  transcriptId?: string
  /** An inline transcript parsed from an uploaded/pasted recording. */
  transcript?: MeetingTranscript
  changeSetId?: string
}

/** Pluggable extractor: deterministic (default) or a Foundry model-backed one injected by the host. */
export type MeetingExtractorFn = (ctx: MeetingExtractionContext, options: { changeSetId: string }) => MeetingChangeSetProposal | Promise<MeetingChangeSetProposal>

/**
 * MSX connector backed by the relational {@link LocalStore}. Implements the same
 * contract as the live and fixture connectors, so it can be selected for sample/test
 * mode behind the existing data seam. Writes persist in the store (injected values
 * survive when a file-backed store is used).
 */
export class LocalStoreMsxConnector implements MsxConnector {
  private readonly manualAccountIds = new Set<string>()

  constructor(
    private readonly store: LocalStore = new LocalStore(),
    private readonly currentUserId: string = SAMPLE_USER_ID
  ) {}

  private ownerName(ownerId: unknown): string | undefined {
    const id = str(ownerId)
    if (!id) return undefined
    return str(this.store.get('SELECT fullname FROM systemuser WHERE id = ?', id)?.['fullname'])
  }

  private userInitials(): string {
    return str(this.store.get('SELECT initials FROM systemuser WHERE id = ?', this.currentUserId)?.['initials']) ?? '??'
  }

  private dealTeamAccountIds(): Set<string> {
    const rows = this.store.all(
      `SELECT o.account_id AS account_id FROM opportunity o
       JOIN opportunity_dealteam dt ON dt.opportunity_id = o.id
       WHERE dt.systemuser_id = ?
       UNION
       SELECT o.account_id AS account_id FROM opportunity o
       JOIN milestone_team_member mt ON mt.opportunity_id = o.id
       WHERE mt.systemuser_id = ?`,
      this.currentUserId, this.currentUserId
    )
    return new Set(rows.map((row) => String(row['account_id'])))
  }

  private toAccount(row: Record<string, unknown>, dealTeam: ReadonlySet<string>): Account {
    const id = String(row['id'])
    const manual = this.manualAccountIds.has(id)
    const onDealTeam = dealTeam.has(id)
    return accountSchema.parse({
      id,
      name: String(row['name']),
      ...(str(row['segment']) ? { segment: str(row['segment']) } : {}),
      ...(str(row['tpid']) ? { tpid: str(row['tpid']) } : {}),
      provenance: manual && onDealTeam ? 'both' : manual ? 'manual' : 'deal-team',
      visibility: str(row['visibility']) === 'hidden' ? 'hidden' : 'visible'
    })
  }

  private toOpportunity(row: Record<string, unknown>): Opportunity {
    const owner = this.ownerName(row['owner_id'])
    const comments = str(row['description'])
    return opportunitySchema.parse({
      id: String(row['id']),
      accountId: String(row['account_id']),
      name: String(row['name']),
      recordedStage: num(row['recorded_stage']) ?? 1,
      value: num(row['estimated_value']) ?? 0,
      currency: str(row['currency']) ?? 'USD',
      closeDate: String(row['estimated_close_date']),
      ...(owner ? { owner } : {}),
      ...(comments ? { comments } : {})
    })
  }

  private toMilestone(row: Record<string, unknown>): Milestone {
    const owner = this.ownerName(row['owner_id'])
    const status = MILESTONE_STATUS[num(row['status']) ?? -1] ?? 'On Track'
    const commitmentCode = num(row['commitment'])
    const commitment = commitmentCode === undefined ? undefined : COMMITMENT[commitmentCode]
    const targetDate = str(row['milestone_date'])
    const usage = num(row['monthly_use'])
    const risk = str(row['risk_details'])
    const comments = str(row['forecast_comments'])
    return milestoneSchema.parse({
      id: String(row['id']),
      opportunityId: String(row['opportunity_id']),
      name: String(row['name']),
      status,
      ...(targetDate ? { targetDate } : {}),
      ...(usage !== undefined ? { estimatedMonthlyUsage: usage } : {}),
      ...(owner ? { owner } : {}),
      ...(commitment ? { commitment } : {}),
      ...(risk ? { riskDetails: risk } : {}),
      ...(comments ? { comments } : {})
    })
  }

  private assertOpportunityAccess(opportunityId: string): Record<string, unknown> {
    const row = this.store.get('SELECT * FROM opportunity WHERE id = ?', opportunityId)
    if (!row) throw new Error(`Unknown local-store opportunity: ${opportunityId}`)
    const onTeam = this.store.get(
      `SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?
       UNION
       SELECT 1 AS present FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?`,
      opportunityId, this.currentUserId, opportunityId, this.currentUserId
    )
    const account = this.store.get('SELECT visibility FROM account WHERE id = ?', String(row['account_id']))
    if (!onTeam || str(account?.['visibility']) === 'hidden') {
      throw new Error('The opportunity is not in the active local-store portfolio.')
    }
    return row
  }

  async listAccounts(options: AccountListOptions = {}): Promise<Account[]> {
    const dealTeam = this.dealTeamAccountIds()
    const rows = this.store.all('SELECT * FROM account ORDER BY name')
    return rows
      .map((row) => this.toAccount(row, dealTeam))
      .filter((account) => dealTeam.has(account.id) || this.manualAccountIds.has(account.id) || account.visibility === 'hidden')
      .filter((account) => options.includeHidden || account.visibility !== 'hidden')
  }

  async searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]> {
    const query = request.query.toLocaleLowerCase()
    const dealTeam = this.dealTeamAccountIds()
    const visible = new Map((await this.listAccounts({ includeHidden: true })).map((account) => [account.id, account]))
    return this.store.all('SELECT * FROM account ORDER BY name')
      .filter((row) => request.matchBy === 'name'
        ? String(row['name']).toLocaleLowerCase().includes(query)
        : str(row['tpid']) === request.query)
      .map((row) => {
        const base = this.toAccount(row, dealTeam)
        const existing = visible.get(base.id)
        return {
          ...(existing ?? base),
          state: existing?.visibility === 'hidden' ? 'hidden' as const : existing ? 'visible' as const : 'not-added' as const
        }
      })
  }

  async addAccount(accountId: string): Promise<Account> {
    const row = this.store.get('SELECT * FROM account WHERE id = ?', accountId)
    if (!row) throw new Error(`Unknown local-store account: ${accountId}`)
    this.manualAccountIds.add(accountId)
    return this.toAccount(row, this.dealTeamAccountIds())
  }

  async setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account> {
    const row = this.store.get('SELECT * FROM account WHERE id = ?', accountId)
    if (!row) throw new Error(`Unknown local-store account: ${accountId}`)
    this.store.run('UPDATE account SET visibility = ? WHERE id = ?', visibility, accountId)
    const updated = this.store.get('SELECT * FROM account WHERE id = ?', accountId)!
    return this.toAccount(updated, this.dealTeamAccountIds())
  }

  async listOpportunities(accountId: string): Promise<Opportunity[]> {
    if (str(this.store.get('SELECT visibility FROM account WHERE id = ?', accountId)?.['visibility']) === 'hidden') return []
    return this.store.all(
      `SELECT o.* FROM opportunity o
       WHERE o.account_id = ? AND (
         EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
         OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
       )
       ORDER BY o.estimated_close_date`,
      accountId, this.currentUserId, this.currentUserId
    ).map((row) => this.toOpportunity(row))
  }

  async listMilestones(opportunityId: string): Promise<Milestone[]> {
    this.assertOpportunityAccess(opportunityId)
    const memberMilestoneIds = new Set(this.store.all(
      'SELECT milestone_id FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?',
      opportunityId, this.currentUserId
    ).map((row) => String(row['milestone_id'])))
    return this.store.all('SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date', opportunityId)
      .map((row) => ({ ...this.toMilestone(row), onMilestoneTeam: memberMilestoneIds.has(String(row['id'])) }))
  }

  async listDiscoverableMilestones(opportunityId: string): Promise<Milestone[]> {
    // No portfolio gate: lists milestones for an opportunity in the user's account scope so a
    // milestone team can be joined without Deal Team membership. Returns [] for a discovery
    // candidate that has not yet been promoted into the store.
    const memberMilestoneIds = new Set(this.store.all(
      'SELECT milestone_id FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?',
      opportunityId, this.currentUserId
    ).map((row) => String(row['milestone_id'])))
    return this.store.all('SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date', opportunityId)
      .map((row) => ({ ...this.toMilestone(row), onMilestoneTeam: memberMilestoneIds.has(String(row['id'])) }))
  }

  private toMilestoneActivity(row: Record<string, unknown>): MilestoneActivity {
    const owner = this.ownerName(row['owner_id'])
    const createdBy = this.ownerName(row['created_by'])
    const priority = str(row['priority'])
    const taskCategory = str(row['task_category'])
    const due = str(row['due'])
    const duration = num(row['duration_minutes'])
    const description = str(row['description'])
    const createdOn = str(row['created_on'])
    return {
      id: String(row['id']),
      milestoneId: String(row['milestone_id']),
      opportunityId: String(row['opportunity_id']),
      subject: String(row['subject']),
      activityType: str(row['activity_type']) ?? 'task',
      status: str(row['status']) ?? 'Open',
      ...(priority === 'Low' || priority === 'Normal' || priority === 'High' ? { priority } : {}),
      ...(taskCategory ? { taskCategory } : {}),
      ...(due ? { due } : {}),
      ...(duration !== undefined ? { durationMinutes: duration } : {}),
      ...(description ? { description } : {}),
      ...(owner ? { owner } : {}),
      ...(createdBy ? { createdBy } : {}),
      ...(createdOn ? { createdOn } : {})
    }
  }

  private assertMilestoneInOpportunity(opportunityId: string, milestoneId: string): void {
    const row = this.store.get('SELECT 1 AS present FROM engagement_milestone WHERE id = ? AND opportunity_id = ?', milestoneId, opportunityId)
    if (!row) throw new Error(`Unknown local-store milestone: ${milestoneId}`)
  }

  async listMilestoneActivities(opportunityId: string, milestoneId: string): Promise<MilestoneActivity[]> {
    this.assertMilestoneInOpportunity(opportunityId, milestoneId)
    return this.store.all('SELECT * FROM milestone_activity WHERE milestone_id = ? ORDER BY created_on DESC', milestoneId)
      .map((row) => this.toMilestoneActivity(row))
  }

  async createMilestoneActivity(opportunityId: string, milestoneId: string, input: CreateMilestoneActivityRequest): Promise<MilestoneActivity> {
    this.assertMilestoneInOpportunity(opportunityId, milestoneId)
    const request = createMilestoneActivityRequestSchema.parse(input)
    const id = `act-${randomUUID()}`
    this.store.run(
      `INSERT INTO milestone_activity (id, milestone_id, opportunity_id, subject, activity_type, status, priority, task_category, due, duration_minutes, description, owner_id, created_by, created_on)
       VALUES (?, ?, ?, ?, 'task', 'Open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, milestoneId, opportunityId, request.subject, request.priority,
      request.taskCategory ?? null, request.due ?? null, request.durationMinutes ?? null,
      request.description ?? null, this.currentUserId, this.currentUserId, new Date().toISOString()
    )
    return this.toMilestoneActivity(this.store.get('SELECT * FROM milestone_activity WHERE id = ?', id)!)
  }

  async updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone> {
    this.assertOpportunityAccess(opportunityId)
    const row = this.store.get('SELECT * FROM engagement_milestone WHERE id = ? AND opportunity_id = ?', milestoneId, opportunityId)
    if (!row) throw new Error(`Unknown local-store milestone: ${milestoneId}`)
    if (update.status !== undefined) {
      const code = Number(Object.entries(MILESTONE_STATUS).find(([, label]) => label === update.status)?.[0])
      this.store.run('UPDATE engagement_milestone SET status = ? WHERE id = ?', code, milestoneId)
    }
    if (update.targetDate !== undefined) this.store.run('UPDATE engagement_milestone SET milestone_date = ? WHERE id = ?', update.targetDate, milestoneId)
    if (update.customerCommitment !== undefined) {
      const code = update.customerCommitment === 'Committed' ? 861980003 : 861980000
      this.store.run('UPDATE engagement_milestone SET commitment = ? WHERE id = ?', code, milestoneId)
    }
    if (update.riskDetails !== undefined) this.store.run('UPDATE engagement_milestone SET risk_details = ? WHERE id = ?', update.riskDetails, milestoneId)
    if (update.comments !== undefined) this.store.run('UPDATE engagement_milestone SET forecast_comments = ? WHERE id = ?', update.comments, milestoneId)
    return this.toMilestone(this.store.get('SELECT * FROM engagement_milestone WHERE id = ?', milestoneId)!)
  }

  async updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity> {
    this.assertOpportunityAccess(opportunityId)
    this.store.run('UPDATE opportunity SET description = ? WHERE id = ?', update.comments, opportunityId)
    return this.toOpportunity(this.store.get('SELECT * FROM opportunity WHERE id = ?', opportunityId)!)
  }

  async updateOpportunityStage(opportunityId: string, targetStage: number, auditNote: string): Promise<Opportunity> {
    const row = this.assertOpportunityAccess(opportunityId)
    const comments = [str(row['description']), auditNote].filter(Boolean).join('\n\n')
    this.store.run('UPDATE opportunity SET recorded_stage = ?, description = ? WHERE id = ?', targetStage, comments, opportunityId)
    return this.toOpportunity(this.store.get('SELECT * FROM opportunity WHERE id = ?', opportunityId)!)
  }

  /**
   * Appends a comment to an opportunity using the additive protocol (newest-first prepend
   * with an `<INITIALS> <M/D/YYYY>` prefix), preserving prior history. Intended for the
   * meeting-inject flow and the Portfolio "type a new comment" UX.
   */
  async appendOpportunityComment(opportunityId: string, text: string): Promise<Opportunity> {
    const row = this.assertOpportunityAccess(opportunityId)
    const entry = formatCommentEntry(this.userInitials(), text)
    this.store.run('UPDATE opportunity SET description = ? WHERE id = ?', prependComment(str(row['description']), entry), opportunityId)
    return this.toOpportunity(this.store.get('SELECT * FROM opportunity WHERE id = ?', opportunityId)!)
  }

  async getOpportunityContext(opportunityId: string): Promise<OpportunityContext> {
    const row = this.assertOpportunityAccess(opportunityId)
    const accountRow = this.store.get('SELECT * FROM account WHERE id = ?', String(row['account_id']))!
    const now = new Date().toISOString()
    return {
      account: this.toAccount(accountRow, this.dealTeamAccountIds()),
      opportunity: this.toOpportunity(row),
      observations: this.buildObservations(row),
      retrievedAt: now,
      sourceHealth: { source: 'msx', state: 'sample', detail: 'Local SQLite test store; no live MSX call was made.', checkedAt: now }
    }
  }

  private buildObservations(row: Record<string, unknown>): CriterionObservation[] {
    const observations: CriterionObservation[] = []
    if (num(row['budget_amount']) !== undefined) {
      observations.push({ criterionId: 'budget', status: num(row['budget_status']) === 1 ? 'met' : 'partial', detail: 'Budget amount is recorded on the opportunity.' })
    }
    if (str(row['final_decision_date'])) {
      observations.push({ criterionId: 'next-step', status: 'partial', detail: 'A final decision date is recorded.' })
    }
    if (str(row['proposed_solution'])) {
      observations.push({ criterionId: 'technical-validation', status: 'partial', detail: 'A proposed solution is recorded.' })
    }
    if (str(row['customer_need'])) {
      observations.push({ criterionId: 'customer-outcome', status: 'partial', detail: 'A customer need is recorded.' })
    }
    return observations
  }

  async discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]> {
    const rows = this.store.all(
      `SELECT d.*, a.name AS account_name, a.visibility AS visibility
       FROM discoverable_opportunity d JOIN account a ON a.id = d.account_id
       WHERE d.domain = ? ORDER BY d.close_date`,
      domain
    )
    return rows
      .filter((row) => str(row['visibility']) !== 'hidden')
      .map((row) => {
        const id = String(row['id'])
        const onDealTeam = Boolean(this.store.get(
          'SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?',
          id, this.currentUserId
        ))
        const solutionArea = str(row['solution_area'])
        const technicalCapability = str(row['technical_capability'])
        const accountName = str(row['account_name'])
        return discoverableOpportunitySchema.parse({
          id,
          accountId: String(row['account_id']),
          name: String(row['name']),
          recordedStage: num(row['recorded_stage']) ?? 1,
          value: num(row['value']) ?? 0,
          currency: str(row['currency']) ?? 'USD',
          closeDate: String(row['close_date']),
          domain,
          onDealTeam,
          ...(accountName ? { accountName } : {}),
          ...(solutionArea ? { solutionArea } : {}),
          ...(technicalCapability ? { technicalCapability } : {})
        })
      })
  }

  async joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult> {
    const existing = this.store.get('SELECT 1 AS present FROM opportunity WHERE id = ?', opportunityId)
    if (!existing) {
      // Promote a discovery candidate into the portfolio (mirrors the live/fixture behavior).
      const discovered = this.store.get('SELECT * FROM discoverable_opportunity WHERE id = ?', opportunityId)
      if (!discovered) throw new Error(`Unknown local-store opportunity: ${opportunityId}`)
      this.store.run(
        `INSERT INTO opportunity (id, account_id, name, recorded_stage, estimated_value, currency, estimated_close_date, solution_area, technical_capability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        opportunityId,
        String(discovered['account_id']),
        String(discovered['name']),
        num(discovered['recorded_stage']) ?? 1,
        num(discovered['value']) ?? 0,
        str(discovered['currency']) ?? 'USD',
        String(discovered['close_date']),
        str(discovered['solution_area']) ?? null,
        str(discovered['technical_capability']) ?? null
      )
    }
    const alreadyMember = Boolean(this.store.get(
      'SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?',
      opportunityId, this.currentUserId
    ))
    if (!alreadyMember) {
      this.store.run('INSERT INTO opportunity_dealteam (opportunity_id, systemuser_id) VALUES (?, ?)', opportunityId, this.currentUserId)
    }
    return { opportunityId, onDealTeam: true, alreadyMember }
  }

  async leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult> {
    const alreadyAbsent = !this.store.get(
      'SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?',
      opportunityId, this.currentUserId
    )
    this.store.run('DELETE FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?', opportunityId, this.currentUserId)
    return { opportunityId, onDealTeam: false, alreadyAbsent }
  }

  async joinMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamJoinResult> {
    const milestone = this.store.get('SELECT 1 AS present FROM engagement_milestone WHERE id = ? AND opportunity_id = ?', milestoneId, opportunityId)
    if (!milestone) throw new Error(`Unknown local-store milestone: ${milestoneId}`)
    const alreadyMember = Boolean(this.store.get(
      'SELECT 1 AS present FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?',
      milestoneId, this.currentUserId
    ))
    if (!alreadyMember) {
      this.store.run(
        'INSERT INTO milestone_team_member (milestone_id, systemuser_id, opportunity_id) VALUES (?, ?, ?)',
        milestoneId, this.currentUserId, opportunityId
      )
    }
    return { opportunityId, milestoneId, onMilestoneTeam: true, alreadyMember }
  }

  async leaveMilestoneTeam(opportunityId: string, milestoneId: string): Promise<MilestoneTeamLeaveResult> {
    const alreadyAbsent = !this.store.get(
      'SELECT 1 AS present FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?',
      milestoneId, this.currentUserId
    )
    this.store.run('DELETE FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?', milestoneId, this.currentUserId)
    return { opportunityId, milestoneId, onMilestoneTeam: false, alreadyAbsent }
  }

  /** Meetings / activities linked to an opportunity (the meetings a transcript can come from). */
  async listActivities(opportunityId: string): Promise<ActivityView[]> {
    this.assertOpportunityAccess(opportunityId)
    return this.store.all('SELECT * FROM activity WHERE opportunity_id = ? ORDER BY scheduled_end', opportunityId)
      .map((row) => {
        const owner = this.ownerName(row['owner_id'])
        const activityType = str(row['activity_type'])
        const scheduledStart = str(row['scheduled_start'])
        const scheduledEnd = str(row['scheduled_end'])
        const joinUrl = str(row['online_meeting_join_url'])
        const location = str(row['location'])
        const description = str(row['description'])
        return {
          id: String(row['id']),
          opportunityId: String(row['opportunity_id']),
          subject: String(row['subject']),
          status: ACTIVITY_STATUS[num(row['status']) ?? -1] ?? 'Open',
          isOnlineMeeting: num(row['is_online_meeting']) === 1,
          ...(owner ? { owner } : {}),
          ...(activityType ? { activityType } : {}),
          ...(scheduledStart ? { scheduledStart } : {}),
          ...(scheduledEnd ? { scheduledEnd } : {}),
          ...(joinUrl ? { onlineMeetingJoinUrl: joinUrl } : {}),
          ...(location ? { location } : {}),
          ...(description ? { description } : {})
        }
      })
  }

  /** Transcripts (with diarized segments) linked to an opportunity's meetings. */
  async listTranscripts(opportunityId: string): Promise<TranscriptView[]> {
    this.assertOpportunityAccess(opportunityId)
    return this.store.all('SELECT * FROM transcript WHERE opportunity_id = ? ORDER BY occurred_at', opportunityId)
      .map((row) => {
        const id = String(row['id'])
        const segments: TranscriptSegmentView[] = this.store.all('SELECT * FROM transcript_segment WHERE transcript_id = ? ORDER BY start_ms', id)
          .map((segment) => {
            const startMs = num(segment['start_ms'])
            const endMs = num(segment['end_ms'])
            const speaker = str(segment['speaker'])
            const speakerRole = str(segment['speaker_role'])
            return {
              id: String(segment['id']),
              text: String(segment['text']),
              ...(startMs !== undefined ? { startMs } : {}),
              ...(endMs !== undefined ? { endMs } : {}),
              ...(speaker ? { speaker } : {}),
              ...(speakerRole ? { speakerRole } : {})
            }
          })
        const activityId = str(row['activity_id'])
        const title = str(row['title'])
        const source = str(row['source'])
        return {
          id,
          opportunityId: String(row['opportunity_id']),
          meetingType: String(row['meeting_type']),
          occurredAt: String(row['occurred_at']),
          segments,
          ...(activityId ? { activityId } : {}),
          ...(title ? { title } : {}),
          ...(source ? { source } : {})
        }
      })
  }

  // ---- Meeting capture: transcript sources, proposal, and injection --------------------

  /** Meeting transcript candidates for the launcher picker (sample path reads seeded rows). */
  async listMeetingTranscripts(opportunityId?: string): Promise<MeetingTranscriptSummary[]> {
    if (opportunityId) this.assertOpportunityAccess(opportunityId)
    const rows = opportunityId
      ? this.store.all(
          `SELECT t.*, o.name AS opp_name FROM transcript t JOIN opportunity o ON o.id = t.opportunity_id
           WHERE t.opportunity_id = ? ORDER BY t.occurred_at DESC`, opportunityId)
      : this.store.all(
          `SELECT t.*, o.name AS opp_name FROM transcript t JOIN opportunity o ON o.id = t.opportunity_id
           ORDER BY t.occurred_at DESC`)
    return rows.map((row) => {
      const id = String(row['id'])
      const count = num(this.store.get('SELECT COUNT(*) AS c FROM transcript_segment WHERE transcript_id = ?', id)?.['c']) ?? 0
      const oppId = str(row['opportunity_id'])
      const oppName = str(row['opp_name'])
      return meetingTranscriptSummarySchema.parse({
        id,
        subject: str(row['title']) ?? 'Meeting transcript',
        occurredAt: String(row['occurred_at']),
        meetingType: String(row['meeting_type']) === 'internal' ? 'internal' : 'customer',
        source: str(row['source']) === 'upload' || str(row['source']) === 'paste' ? str(row['source']) : 'teams',
        segmentCount: count,
        ...(oppId ? { opportunityId: oppId } : {}),
        ...(oppName ? { opportunityName: oppName } : {})
      })
    })
  }

  /** Loads a seeded transcript (with diarized segments) as the canonical contract shape. */
  async getMeetingTranscript(transcriptId: string): Promise<MeetingTranscript | undefined> {
    const row = this.store.get('SELECT * FROM transcript WHERE id = ?', transcriptId)
    if (!row) return undefined
    const segments = this.store.all('SELECT * FROM transcript_segment WHERE transcript_id = ? ORDER BY start_ms', transcriptId)
      .map((segment) => {
        const startMs = num(segment['start_ms'])
        const endMs = num(segment['end_ms'])
        const speaker = str(segment['speaker'])
        const role = str(segment['speaker_role'])
        return {
          segmentId: String(segment['id']),
          text: String(segment['text']),
          ...(startMs !== undefined ? { startMs } : {}),
          ...(endMs !== undefined ? { endMs } : {}),
          ...(speaker ? { speaker } : {}),
          ...(role === 'internal' || role === 'customer' ? { speakerRole: role } : {})
        }
      })
    const oppId = str(row['opportunity_id'])
    const title = str(row['title'])
    return meetingTranscriptSchema.parse({
      id: String(row['id']),
      meetingType: String(row['meeting_type']) === 'internal' ? 'internal' : 'customer',
      source: str(row['source']) === 'upload' || str(row['source']) === 'paste' ? str(row['source']) : 'teams',
      segments,
      ...(oppId ? { opportunityId: oppId } : {}),
      ...(title ? { title } : {})
    })
  }

  private labelFor(canonical: string, code: number | undefined): string | null {
    if (code === undefined) return null
    switch (canonical) {
      case 'budgetStatus': return BUDGET_STATUS[code] ?? null
      case 'timeline': return TIMELINE[code] ?? null
      case 'purchaseProcess': return PURCHASE_PROCESS[code] ?? null
      case 'need': return NEED[code] ?? null
      case 'opportunityRating': return OPPORTUNITY_RATING[code] ?? null
      case 'milestoneCommitment': return COMMITMENT[code] ?? null
      default: return null
    }
  }

  private buildOpportunitySnapshot(row: Record<string, unknown>): ExtractorOpportunitySnapshot {
    return {
      id: String(row['id']),
      name: String(row['name']),
      fields: {
        budgetAmount: num(row['budget_amount']) ?? null,
        budgetStatus: this.labelFor('budgetStatus', num(row['budget_status'])),
        estimatedValue: num(row['estimated_value']) ?? null,
        timeline: this.labelFor('timeline', num(row['timeline'])),
        purchaseProcess: this.labelFor('purchaseProcess', num(row['purchase_process'])),
        decisionMaker: num(row['decision_maker']) === 1,
        need: this.labelFor('need', num(row['need'])),
        customerNeed: str(row['customer_need']) ?? null,
        proposedSolution: str(row['proposed_solution']) ?? null,
        finalDecisionDate: str(row['final_decision_date']) ?? null,
        identifyCompetitors: num(row['identify_competitors']) === 1,
        opportunityRating: this.labelFor('opportunityRating', num(row['opportunity_rating'])),
        qualificationComments: str(row['qualification_comments']) ?? null
      }
    }
  }

  private buildMilestoneSnapshot(row: Record<string, unknown>): ExtractorMilestoneSnapshot {
    return {
      id: String(row['id']),
      name: String(row['name']),
      fields: {
        milestoneCommitment: this.labelFor('milestoneCommitment', num(row['commitment'])),
        milestoneRisk: str(row['risk_details']) ?? null
      }
    }
  }

  /** Produces a reviewable change-set proposal from a transcript against the live opp snapshot. */
  async proposeMeetingChangeSet(request: ProposeMeetingChangeSetRequest, extractor?: MeetingExtractorFn): Promise<MeetingChangeSetProposal> {
    const oppRow = this.assertOpportunityAccess(request.opportunityId)
    let transcript: MeetingTranscript
    if (request.transcript) {
      transcript = meetingTranscriptSchema.parse(request.transcript)
    } else if (request.transcriptId) {
      const loaded = await this.getMeetingTranscript(request.transcriptId)
      if (!loaded) throw new Error(`Unknown local-store transcript: ${request.transcriptId}`)
      transcript = loaded
    } else {
      throw new Error('proposeMeetingChangeSet requires a transcript or transcriptId.')
    }
    const anchored: MeetingTranscript = { ...transcript, opportunityId: request.opportunityId }
    const opportunity = this.buildOpportunitySnapshot(oppRow)
    const milestones = this.store
      .all('SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date', request.opportunityId)
      .map((milestoneRow) => this.buildMilestoneSnapshot(milestoneRow))
    const changeSetId = request.changeSetId ?? `cs-${request.opportunityId}-${Date.now().toString(36)}`
    const run: MeetingExtractorFn = extractor ?? ((ctx, options) => extractMeetingSignals(ctx, options))
    return run({ transcript: anchored, opportunity, milestones }, { changeSetId })
  }

  private optionCodeFor(canonical: string, label: string): number | undefined {
    switch (canonical) {
      case 'budgetStatus': return reverseOption(BUDGET_STATUS, label)
      case 'timeline': return reverseOption(TIMELINE, label)
      case 'purchaseProcess': return reverseOption(PURCHASE_PROCESS, label)
      case 'need': return reverseOption(NEED, label)
      case 'opportunityRating': return reverseOption(OPPORTUNITY_RATING, label)
      case 'milestoneCommitment': return reverseOption(COMMITMENT, label)
      default: return undefined
    }
  }

  private applyOpportunityField(opportunityId: string, entry: FieldDictionaryEntry, after: unknown): void {
    const column = entry.msxField
    if (entry.valueType === 'money') {
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, Number(after), opportunityId)
    } else if (entry.valueType === 'boolean') {
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, after ? 1 : 0, opportunityId)
    } else if (entry.valueType === 'date') {
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, String(after), opportunityId)
    } else if (entry.valueType === 'optionset') {
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, this.optionCodeFor(entry.canonical, String(after)) ?? null, opportunityId)
    } else if (entry.append) {
      const current = str(this.store.get(`SELECT ${column} AS v FROM opportunity WHERE id = ?`, opportunityId)?.['v'])
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, prependComment(current, String(after)), opportunityId)
    } else {
      this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, String(after), opportunityId)
    }
  }

  private applyMilestoneField(milestoneId: string, entry: FieldDictionaryEntry, after: unknown): void {
    const column = entry.msxField
    if (entry.valueType === 'optionset') {
      this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, this.optionCodeFor(entry.canonical, String(after)) ?? null, milestoneId)
    } else if (entry.append) {
      const current = str(this.store.get(`SELECT ${column} AS v FROM engagement_milestone WHERE id = ?`, milestoneId)?.['v'])
      this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, prependComment(current, String(after)), milestoneId)
    } else {
      this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, String(after), milestoneId)
    }
  }

  private concurrencyMatches(entry: FieldDictionaryEntry, before: unknown, current: unknown): boolean {
    if (entry.valueType === 'money') {
      const a = before === null || before === undefined ? null : Number(before)
      const b = current === null || current === undefined ? null : Number(current)
      return a === b
    }
    if (entry.valueType === 'boolean') return Boolean(before) === Boolean(current)
    const a = before === null || before === undefined ? '' : String(before).trim()
    const b = current === null || current === undefined ? '' : String(current).trim()
    return a === b
  }

  private insertNewMilestone(opportunityId: string, name: string, milestoneDate: string | undefined, commitment: string | undefined): string {
    const id = `ms-new-${opportunityId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const commitmentCode = commitment ? reverseOption(COMMITMENT, commitment) ?? null : null
    this.store.run(
      `INSERT INTO engagement_milestone (id, opportunity_id, name, status, milestone_date, owner_id, commitment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, opportunityId, name, 861980000, milestoneDate ?? null, this.currentUserId, commitmentCode
    )
    return id
  }

  private buildResultItems(
    proposal: MeetingChangeSetProposal,
    approval: MeetingChangeSetApproval,
    outcome: { conflicts: ReadonlySet<string>; applied: ReadonlySet<string>; appliedMilestones?: ReadonlySet<string> }
  ): MeetingInjectItemResult[] {
    const items: MeetingInjectItemResult[] = []
    for (const slot of proposal.slots) {
      if (!approval.approvedSlotIds.includes(slot.slotId)) continue
      let state: MeetingInjectItemResult['state']
      let detail: string
      if (outcome.conflicts.has(slot.slotId)) {
        state = 'conflict'
        detail = `"${slot.label}" changed since review; no update applied.`
      } else if (outcome.applied.has(slot.slotId)) {
        state = 'applied'
        detail = `${slot.label}: ${slot.displayAfter}`
      } else if (slot.targetKind === 'milestone' && slot.targetRecordId && !approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
        state = 'skipped'
        detail = `${slot.label}: milestone not selected.`
      } else {
        state = 'skipped'
        detail = `${slot.label}: not applied (change set rolled back).`
      }
      items.push({ id: slot.slotId, kind: 'field', state, detail })
    }
    for (const milestone of proposal.newMilestones) {
      if (!approval.approvedNewMilestoneTempIds.includes(milestone.tempId)) continue
      const applied = outcome.appliedMilestones?.has(milestone.tempId) ?? false
      items.push({
        id: milestone.tempId,
        kind: 'new-milestone',
        state: applied ? 'applied' : 'skipped',
        detail: applied ? `Created milestone "${milestone.name}".` : `Milestone "${milestone.name}" not created (rolled back).`
      })
    }
    return items
  }

  /** Applies an approved change set atomically (all-or-none), with optimistic concurrency. */
  async applyMeetingChangeSet(input: { proposal: MeetingChangeSetProposal; approval: MeetingChangeSetApproval }): Promise<MeetingChangeSetResult> {
    const proposal = meetingChangeSetProposalSchema.parse(input.proposal)
    const approval = meetingChangeSetApprovalSchema.parse(input.approval)
    if (approval.changeSetId !== proposal.changeSetId) throw new Error('Approval does not match the proposal.')
    if (approval.opportunityId !== proposal.opportunityId) throw new Error('Approval targets a different opportunity.')
    this.assertOpportunityAccess(proposal.opportunityId)

    const approvedSlots = proposal.slots.filter((slot) => approval.approvedSlotIds.includes(slot.slotId))

    // Phase 1: validate-all (optimistic concurrency) over replaceable field slots.
    const oppSnapshot = this.buildOpportunitySnapshot(this.store.get('SELECT * FROM opportunity WHERE id = ?', proposal.opportunityId)!)
    const conflicts = new Set<string>()
    for (const slot of approvedSlots) {
      const entry = MEETING_FIELD_DICTIONARY[slot.targetField]
      if (!entry || entry.append) continue
      let current: unknown
      if (slot.targetKind === 'opportunity') {
        current = oppSnapshot.fields[slot.targetField]
      } else if (slot.targetKind === 'milestone' && slot.targetRecordId) {
        if (!approval.selectedMilestoneIds.includes(slot.targetRecordId)) continue
        const milestoneRow = this.store.get('SELECT * FROM engagement_milestone WHERE id = ?', slot.targetRecordId)
        current = milestoneRow ? this.buildMilestoneSnapshot(milestoneRow).fields[slot.targetField] : undefined
      } else {
        continue
      }
      if (!this.concurrencyMatches(entry, slot.before, current)) conflicts.add(slot.slotId)
    }
    if (conflicts.size > 0) {
      return meetingChangeSetResultSchema.parse({
        changeSetId: proposal.changeSetId,
        state: 'rolled-back',
        items: this.buildResultItems(proposal, approval, { conflicts, applied: new Set() }),
        auditNote: `Rolled back: ${conflicts.size} field(s) changed since review; no updates applied.`
      })
    }

    // Phase 2: apply-all atomically.
    const applied = new Set<string>()
    const appliedMilestones = new Set<string>()
    this.store.exec('BEGIN')
    try {
      for (const slot of approvedSlots) {
        const entry = MEETING_FIELD_DICTIONARY[slot.targetField]
        if (!entry) continue
        if (slot.targetKind === 'opportunity') {
          this.applyOpportunityField(proposal.opportunityId, entry, slot.after)
          applied.add(slot.slotId)
        } else if (slot.targetKind === 'milestone' && slot.targetRecordId && approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
          this.applyMilestoneField(slot.targetRecordId, entry, slot.after)
          applied.add(slot.slotId)
        }
      }
      for (const milestone of proposal.newMilestones) {
        if (!approval.approvedNewMilestoneTempIds.includes(milestone.tempId)) continue
        this.insertNewMilestone(proposal.opportunityId, milestone.name, milestone.milestoneDate, milestone.commitment)
        appliedMilestones.add(milestone.tempId)
      }
      const auditNote = `Meeting inject (${proposal.meetingType}): applied ${applied.size} field update(s) and ${appliedMilestones.size} new milestone(s). Reason: ${approval.reason}`
      const descRow = this.store.get('SELECT description FROM opportunity WHERE id = ?', proposal.opportunityId)
      const commentEntry = formatCommentEntry(this.userInitials(), auditNote)
      this.store.run('UPDATE opportunity SET description = ? WHERE id = ?', prependComment(str(descRow?.['description']), commentEntry), proposal.opportunityId)
      this.store.exec('COMMIT')
    } catch (error) {
      this.store.exec('ROLLBACK')
      throw error
    }

    return meetingChangeSetResultSchema.parse({
      changeSetId: proposal.changeSetId,
      state: 'applied',
      items: this.buildResultItems(proposal, approval, { conflicts: new Set(), applied, appliedMilestones }),
      auditNote: `Meeting inject (${proposal.meetingType}): applied ${applied.size} field update(s) and ${appliedMilestones.size} new milestone(s). Reason: ${approval.reason}`
    })
  }
}

/**
 * Factory for sample/test mode: returns a local-store-backed connector when
 * `TLC_DATA_STORE=sqlite`, else `undefined` so the caller keeps its existing fixture.
 */
export function createLocalStoreMsxConnector(
  environment: NodeJS.ProcessEnv = process.env
): LocalStoreMsxConnector | undefined {
  if ((environment['TLC_DATA_STORE'] ?? '').toLowerCase() !== 'sqlite') return undefined
  const path = environment['TLC_DATA_STORE_PATH']?.trim()
  return new LocalStoreMsxConnector(new LocalStore(path ? { path } : {}))
}
