/**
 * Meeting Signal Extractor — deterministic sample implementation.
 *
 * In production, a GPT-5 reasoning deployment with Structured Outputs returns a
 * `MeetingChangeSetProposal`. For the offline / SQLite test path this module produces the
 * same contract deterministically with transparent rules, so the extract → review → inject
 * slice can be developed and tested without a model call. Both paths obey the same
 * guardrails: dictionary-only fields, evidence on every slot, no-op drop, customer/internal
 * routing, and conservative confidence.
 *
 * See docs/MeetingCapture.md (Parts B, C, I) and prompts/instructions.md.
 */
import {
    meetingChangeSetProposalSchema,
    type McemCriterion,
    type MeetingChangeSetProposal,
    type MeetingNewMilestone,
    type MeetingSlot,
    type MeetingTranscript,
    type MeetingUnmappedSignal,
    type MeetingValueType
} from '../../../common/index.js'

export interface FieldDictionaryEntry {
    /** Canonical field name used across extractor, bridge, and connector. */
    canonical: string
    label: string
    targetKind: 'opportunity' | 'milestone'
    /** SQLite column / MSX logical field the connector writes. */
    msxField: string
    valueType: MeetingValueType
    mcemCriterion: McemCriterion
    /** Allowed option labels for option-set fields. */
    optionLabels?: readonly string[]
    /** Revenue-grade fields: never pre-checked, always visibly flagged. */
    sensitive: boolean
    /** Only settable from internal speakers (competitive / strategy / risk). */
    internalOnly?: boolean
    /** Additive text field (comment protocol) — the proposed value is appended, not replaced. */
    append?: boolean
    /** Narrative text field — proposed only when currently empty (never destructive). */
    fillOnlyWhenEmpty?: boolean
}

/** Canonical field dictionary. The extractor may only propose fields listed here. */
export const MEETING_FIELD_DICTIONARY: Readonly<Record<string, FieldDictionaryEntry>> = {
    budgetAmount: { canonical: 'budgetAmount', label: 'Budget amount', targetKind: 'opportunity', msxField: 'budget_amount', valueType: 'money', mcemCriterion: 'business-case', sensitive: false },
    budgetStatus: { canonical: 'budgetStatus', label: 'Budget confirmed', targetKind: 'opportunity', msxField: 'budget_status', valueType: 'optionset', optionLabels: ['Yes', 'No'], mcemCriterion: 'business-case', sensitive: false },
    estimatedValue: { canonical: 'estimatedValue', label: 'Estimated value', targetKind: 'opportunity', msxField: 'estimated_value', valueType: 'money', mcemCriterion: 'business-case', sensitive: true },
    timeline: { canonical: 'timeline', label: 'Purchase timeline', targetKind: 'opportunity', msxField: 'timeline', valueType: 'optionset', optionLabels: ['Immediate', 'This Quarter', 'Next Quarter', 'This Year', 'Not known'], mcemCriterion: 'next-step', sensitive: false },
    purchaseProcess: { canonical: 'purchaseProcess', label: 'Decision process', targetKind: 'opportunity', msxField: 'purchase_process', valueType: 'optionset', optionLabels: ['Individual', 'Committee', 'Unknown'], mcemCriterion: 'decision-team', sensitive: false },
    decisionMaker: { canonical: 'decisionMaker', label: 'Decision maker identified', targetKind: 'opportunity', msxField: 'decision_maker', valueType: 'boolean', mcemCriterion: 'decision-team', sensitive: false },
    need: { canonical: 'need', label: 'Customer need level', targetKind: 'opportunity', msxField: 'need', valueType: 'optionset', optionLabels: ['Must have', 'Should have', 'Good to have', 'No need'], mcemCriterion: 'customer-outcome', sensitive: false },
    customerNeed: { canonical: 'customerNeed', label: 'Customer need', targetKind: 'opportunity', msxField: 'customer_need', valueType: 'text', mcemCriterion: 'customer-outcome', sensitive: false, fillOnlyWhenEmpty: true },
    proposedSolution: { canonical: 'proposedSolution', label: 'Proposed solution', targetKind: 'opportunity', msxField: 'proposed_solution', valueType: 'text', mcemCriterion: 'technical-validation', sensitive: false, fillOnlyWhenEmpty: true },
    finalDecisionDate: { canonical: 'finalDecisionDate', label: 'Final decision date', targetKind: 'opportunity', msxField: 'final_decision_date', valueType: 'date', mcemCriterion: 'next-step', sensitive: false },
    identifyCompetitors: { canonical: 'identifyCompetitors', label: 'Competitors identified', targetKind: 'opportunity', msxField: 'identify_competitors', valueType: 'boolean', mcemCriterion: 'risk', sensitive: false },
    opportunityRating: { canonical: 'opportunityRating', label: 'Opportunity sentiment', targetKind: 'opportunity', msxField: 'opportunity_rating', valueType: 'optionset', optionLabels: ['Hot', 'Warm', 'Cold'], mcemCriterion: 'sentiment', sensitive: false },
    qualificationComments: { canonical: 'qualificationComments', label: 'Qualification note', targetKind: 'opportunity', msxField: 'qualification_comments', valueType: 'text', mcemCriterion: 'risk', sensitive: false, internalOnly: true, append: true },
    milestoneCommitment: { canonical: 'milestoneCommitment', label: 'Milestone commitment', targetKind: 'milestone', msxField: 'commitment', valueType: 'optionset', optionLabels: ['Uncommitted', 'Committed'], mcemCriterion: 'next-step', sensitive: false },
    milestoneRisk: { canonical: 'milestoneRisk', label: 'Milestone risk', targetKind: 'milestone', msxField: 'risk_details', valueType: 'text', mcemCriterion: 'risk', sensitive: false, internalOnly: true, append: true }
}

export interface ExtractorOpportunitySnapshot {
    id: string
    name: string
    /** Canonical field -> current value (option-set values carry their human label). */
    fields: Readonly<Record<string, unknown>>
}

export interface ExtractorMilestoneSnapshot {
    id: string
    name: string
    fields: Readonly<Record<string, unknown>>
}

export interface MeetingExtractionContext {
    transcript: MeetingTranscript
    opportunity: ExtractorOpportunitySnapshot
    milestones: readonly ExtractorMilestoneSnapshot[]
}

export interface ExtractOptions {
    changeSetId?: string
    /** Injected for deterministic timestamps in tests. */
    now?: () => Date
}

const KNOWN_COMPETITORS = ['AWS', 'Amazon Web Services', 'Google Cloud', 'GCP', 'Snowflake', 'Databricks', 'Palo Alto', 'Oracle', 'IBM', 'SAP', 'ServiceNow']

export interface RawCandidate {
    canonical: string
    targetRecordId?: string
    after: string | number | boolean
    confidence: number
    evidence: string[]
    rationale: string
}

/** The detection output both the deterministic matcher and the model extractor feed into assembly. */
export interface ExtractedSignals {
    candidates: RawCandidate[]
    newMilestones: MeetingNewMilestone[]
    unmappedSignals: MeetingUnmappedSignal[]
}

/** Parse "$900,000", "900 thousand", "900k", "4 million", "4m", "2.5 million" to a number. */
function parseMoney(text: string): number | null {
    const match = text.match(/\$?\s*([\d][\d,]*\.?\d*)\s*(million|mil|m|k|thousand)?\b/i)
    if (!match) return null
    const amountRaw = match[1]
    if (amountRaw === undefined) return null
    const base = Number(amountRaw.replace(/,/g, ''))
    if (!Number.isFinite(base)) return null
    const unit = (match[2] ?? '').toLowerCase()
    if (unit === 'million' || unit === 'mil' || unit === 'm') return Math.round(base * 1_000_000)
    if (unit === 'thousand' || unit === 'k') return Math.round(base * 1_000)
    return Math.round(base)
}

function matchTimeline(text: string): string | null {
    if (/\bnext quarter\b/i.test(text)) return 'Next Quarter'
    if (/\bthis quarter\b/i.test(text)) return 'This Quarter'
    if (/\bthis (fiscal )?year\b/i.test(text)) return 'This Year'
    if (/\b(immediately|right away|asap|as soon as possible)\b/i.test(text)) return 'Immediate'
    if (/\b(not known|unknown|to be determined|tbd)\b/i.test(text)) return 'Not known'
    return null
}

function matchProcess(text: string): string | null {
    if (/\b(committee|steering (group|committee)|board (approv|decid))/i.test(text)) return 'Committee'
    if (/\b(sole decision|single decision[- ]maker|i will decide|i decide)\b/i.test(text)) return 'Individual'
    return null
}

function matchNeed(text: string): string | null {
    if (/\bmust[- ]have\b|\bcritical\b|\bessential\b|\bnon-negotiable\b/i.test(text)) return 'Must have'
    if (/\bshould[- ]have\b/i.test(text)) return 'Should have'
    if (/\b(good to have|nice to have)\b/i.test(text)) return 'Good to have'
    if (/\b(no need|not needed|not a requirement)\b/i.test(text)) return 'No need'
    return null
}

function matchSentiment(text: string): string | null {
    if (/\b(excited|thrilled|love it|great fit|strong fit|very positive|enthusiastic|eager to proceed|ready to move forward)\b/i.test(text)) return 'Hot'
    if (/\b(cautiously optimistic|positive but|interested|promising|leaning positive)\b/i.test(text)) return 'Warm'
    if (/\b(concerned|worried|frustrated|hesitant|skeptical|not convinced)\b/i.test(text)) return 'Cold'
    return null
}

function matchDecisionMaker(text: string): boolean {
    return /\b(decision[- ]maker (?:is|identified)|final decision[- ]maker|has final approval|makes? the final (?:call|decision)|owns? the final decision)\b/i.test(text)
}

function matchCustomerNeed(text: string): string | null {
    const match = text.match(/\b(?:customer|business) need\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)
    return match?.[1]?.trim() || null
}

function matchProposedSolution(text: string): string | null {
    const match = text.match(/\b(?:proposed|recommended) solution\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)
    return match?.[1]?.trim() || null
}

function normalizedDate(year: number, month: number, day: number): string | null {
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return date.toISOString().slice(0, 10)
}

function matchFinalDecisionDate(text: string): string | null {
    if (!/\b(final decision|decision date|decide by|decision by)\b/i.test(text)) return null

    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
    if (iso?.[1] && iso[2] && iso[3]) return normalizedDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

    const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
    if (numeric?.[1] && numeric[2] && numeric[3]) return normalizedDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]))

    const monthNames: Readonly<Record<string, number>> = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
    }
    const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i)
    if (!named?.[1] || !named[2] || !named[3]) return null
    const month = monthNames[named[1].toLowerCase()]
    return month ? normalizedDate(Number(named[3]), month, Number(named[2])) : null
}

function matchMilestoneRisk(text: string): string | null {
    const match = text.match(/\brisk\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)
    return match?.[1]?.trim() || null
}

function findCompetitor(text: string): string | null {
    for (const name of KNOWN_COMPETITORS) {
        if (new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(text)) return name
    }
    return null
}

const NEW_MILESTONE_PATTERNS: ReadonlyArray<{ re: RegExp, name: string }> = [
    { re: /\bproof of value\b|\bpov\b/i, name: 'Proof of value' },
    { re: /\bproof of concept\b|\bpoc\b/i, name: 'Proof of concept' },
    { re: /\bpilot\b/i, name: 'Pilot' },
    { re: /\bworkshop\b/i, name: 'Workshop' },
    { re: /\b(architecture|design) review\b/i, name: 'Architecture review' }
]

function formatMoney(value: number): string {
    return `$${value.toLocaleString('en-US')}`
}

function displayValue(valueType: MeetingValueType, value: unknown): string {
    if (value === null || value === undefined || value === '') return '(empty)'
    if (valueType === 'money' && typeof value === 'number') return formatMoney(value)
    if (valueType === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
}

function valuesEqual(valueType: MeetingValueType, before: unknown, after: unknown): boolean {
    if (valueType === 'money') return Number(before) === Number(after)
    if (valueType === 'boolean') return Boolean(before) === Boolean(after)
    return String(before ?? '').trim() === String(after ?? '').trim()
}

/** Deterministically extract MCEM signals from a transcript into a change-set proposal. */
export function extractMeetingSignals(ctx: MeetingExtractionContext, options: ExtractOptions = {}): MeetingChangeSetProposal {
    const candidates: RawCandidate[] = []
    const competitorNotes: Array<{ name: string, segmentId: string, internal: boolean }> = []
    const newMilestones: MeetingNewMilestone[] = []
    const unmappedSignals: MeetingUnmappedSignal[] = []
    const seenMilestoneNames = new Set(ctx.milestones.map((m) => m.name.toLowerCase()))

    for (const seg of ctx.transcript.segments) {
        const internal = seg.speakerRole === 'internal'
        const text = seg.text

        if (/\b(budget|spend|sign[- ]?off|approved to (buy|spend)|commit)\b/i.test(text)) {
            const amount = parseMoney(text)
            if (amount !== null) {
                candidates.push({ canonical: 'budgetAmount', after: amount, confidence: 0.82, evidence: [seg.segmentId], rationale: `Customer stated a budget of ${formatMoney(amount)}.` })
                if (/\b(approved|sign(?:ed)?[- ]?off|commit|secured|allocated)\b/i.test(text)) {
                    candidates.push({ canonical: 'budgetStatus', after: 'Yes', confidence: 0.8, evidence: [seg.segmentId], rationale: 'Customer confirmed budget is approved.' })
                }
            }
        }

        if (/\b(estimated|expected|projected)\s+(deal|opportunity|contract)?\s*value\b|\bdeal value\b/i.test(text)) {
            const amount = parseMoney(text)
            if (amount !== null) {
                candidates.push({ canonical: 'estimatedValue', after: amount, confidence: 0.92, evidence: [seg.segmentId], rationale: `Meeting participants estimated the opportunity value at ${formatMoney(amount)}.` })
            }
        }

        const timeline = matchTimeline(text)
        if (timeline) candidates.push({ canonical: 'timeline', after: timeline, confidence: 0.75, evidence: [seg.segmentId], rationale: `Customer indicated a "${timeline}" buying timeline.` })

        const process = matchProcess(text)
        if (process) candidates.push({ canonical: 'purchaseProcess', after: process, confidence: 0.76, evidence: [seg.segmentId], rationale: `Decision process described as "${process}".` })

        if (matchDecisionMaker(text)) {
            candidates.push({ canonical: 'decisionMaker', after: true, confidence: 0.8, evidence: [seg.segmentId], rationale: 'The meeting identified who owns the final decision.' })
        }

        const need = matchNeed(text)
        if (need) candidates.push({ canonical: 'need', after: need, confidence: 0.72, evidence: [seg.segmentId], rationale: `Customer framed the need as "${need}".` })

        if (!internal) {
            const customerNeed = matchCustomerNeed(text)
            if (customerNeed) candidates.push({ canonical: 'customerNeed', after: customerNeed, confidence: 0.78, evidence: [seg.segmentId], rationale: 'Customer stated the business need in the meeting.' })

            const proposedSolution = matchProposedSolution(text)
            if (proposedSolution) candidates.push({ canonical: 'proposedSolution', after: proposedSolution, confidence: 0.78, evidence: [seg.segmentId], rationale: 'Meeting participants described the proposed solution.' })
        }

        const finalDecisionDate = matchFinalDecisionDate(text)
        if (finalDecisionDate) {
            candidates.push({ canonical: 'finalDecisionDate', after: finalDecisionDate, confidence: 0.86, evidence: [seg.segmentId], rationale: `Customer stated a final decision date of ${finalDecisionDate}.` })
        }

        const sentiment = matchSentiment(text)
        if (sentiment) candidates.push({ canonical: 'opportunityRating', after: sentiment, confidence: 0.45, evidence: [seg.segmentId], rationale: `Tone suggests a "${sentiment}" sentiment.` })

        const referencedMilestone = ctx.milestones.find((milestone) => text.toLowerCase().includes(milestone.name.toLowerCase()))
        if (referencedMilestone && /\b(committed|commitment confirmed|confirmed commitment)\b/i.test(text)) {
            candidates.push({
                canonical: 'milestoneCommitment',
                targetRecordId: referencedMilestone.id,
                after: 'Committed',
                confidence: 0.83,
                evidence: [seg.segmentId],
                rationale: `Commitment was confirmed for milestone "${referencedMilestone.name}".`
            })
        }
        if (internal && referencedMilestone) {
            const risk = matchMilestoneRisk(text)
            if (risk) {
                candidates.push({
                    canonical: 'milestoneRisk',
                    targetRecordId: referencedMilestone.id,
                    after: risk,
                    confidence: 0.74,
                    evidence: [seg.segmentId],
                    rationale: `Internal risk recorded for milestone "${referencedMilestone.name}".`
                })
            }
        }

        const competitor = findCompetitor(text)
        if (competitor) {
            competitorNotes.push({ name: competitor, segmentId: seg.segmentId, internal })
            candidates.push({ canonical: 'identifyCompetitors', after: true, confidence: 0.78, evidence: [seg.segmentId], rationale: `Competitor mentioned: ${competitor}.` })
        }

        for (const pattern of NEW_MILESTONE_PATTERNS) {
            if (pattern.re.test(text) && !seenMilestoneNames.has(pattern.name.toLowerCase())) {
                seenMilestoneNames.add(pattern.name.toLowerCase())
                newMilestones.push({
                    tempId: `new-ms-${newMilestones.length + 1}`,
                    name: pattern.name,
                    confidence: internal ? 0.68 : 0.6,
                    checkedByDefault: false,
                    evidence: [seg.segmentId]
                })
            }
        }
    }

    // Competitive intel from internal speakers routes to the internal qualification note.
    const internalCompetitors = competitorNotes.filter((c) => c.internal)
    if (internalCompetitors.length > 0) {
        const names = [...new Set(internalCompetitors.map((c) => c.name))].join(', ')
        candidates.push({
            canonical: 'qualificationComments',
            after: `Competitive: evaluating against ${names}.`,
            confidence: 0.7,
            evidence: internalCompetitors.map((c) => c.segmentId),
            rationale: `Internal note: competing against ${names}.`
        })
        unmappedSignals.push({
            label: 'Competitor mentioned',
            text: `Evaluating against ${names}.`,
            mcemCriterion: 'risk',
            evidence: internalCompetitors.map((c) => c.segmentId)
        })
    }

    return assembleProposal(ctx, { candidates, newMilestones, unmappedSignals }, options)
}

/**
 * Deterministically turns detected signals into a validated change-set proposal. Shared by the
 * rule-based matcher and the Foundry model path so every guardrail (dictionary-only fields,
 * option-set coercion, no-op drop, before/after from the live snapshot, sensitive gating) is
 * enforced in code regardless of how the signals were detected.
 */
export function assembleProposal(ctx: MeetingExtractionContext, signals: ExtractedSignals, options: ExtractOptions = {}): MeetingChangeSetProposal {
    const now = options.now ? options.now() : new Date()
    const changeSetId = options.changeSetId ?? `cs-${ctx.transcript.id}`

    // Keep the highest-confidence candidate per (field, target) to avoid duplicate rows.
    const bestByKey = new Map<string, RawCandidate>()
    for (const candidate of signals.candidates) {
        const entry = MEETING_FIELD_DICTIONARY[candidate.canonical]
        if (!entry) continue
        const key = `${candidate.canonical}:${entry.targetKind === 'milestone' ? candidate.targetRecordId ?? '' : ctx.opportunity.id}`
        const existing = bestByKey.get(key)
        if (!existing || candidate.confidence > existing.confidence) bestByKey.set(key, candidate)
    }

    const slots: MeetingSlot[] = []
    for (const cand of bestByKey.values()) {
        const entry = MEETING_FIELD_DICTIONARY[cand.canonical]
        if (!entry) continue
        const isMilestone = entry.targetKind === 'milestone'
        const targetRecordId = isMilestone ? cand.targetRecordId : ctx.opportunity.id
        if (!targetRecordId) continue
        const snapshotFields = isMilestone
            ? ctx.milestones.find((milestone) => milestone.id === targetRecordId)?.fields
            : ctx.opportunity.fields
        if (!snapshotFields) continue
        if (entry.internalOnly && cand.evidence.length === 0) continue

        const before = snapshotFields[cand.canonical]

        if (entry.append) {
            const existing = String(before ?? '')
            if (existing.toLowerCase().includes(String(cand.after).toLowerCase())) continue
        } else if (entry.fillOnlyWhenEmpty) {
            if (before !== null && before !== undefined && String(before).trim() !== '') continue
        } else if (valuesEqual(entry.valueType, before, cand.after)) {
            continue
        }

        if (entry.optionLabels && entry.valueType === 'optionset' && !entry.optionLabels.includes(String(cand.after))) continue

        const confidence = Math.max(0, Math.min(1, cand.confidence))
        const blocked = entry.sensitive && confidence < 0.9
        const checkedByDefault = confidence >= 0.7 && !entry.sensitive && !blocked

        slots.push({
            slotId: `slot-${slots.length + 1}-${entry.canonical}`,
            label: entry.label,
            mcemCriterion: entry.mcemCriterion,
            targetKind: entry.targetKind,
            targetRecordId,
            targetField: entry.canonical,
            valueType: entry.valueType,
            before: before ?? null,
            after: cand.after,
            displayBefore: displayValue(entry.valueType, before),
            displayAfter: entry.append ? String(cand.after) : displayValue(entry.valueType, cand.after),
            confidence,
            checkedByDefault,
            blocked,
            ...(blocked ? { blockedReason: 'Sensitive field requires manual confirmation.' } : {}),
            sensitive: entry.sensitive,
            rationale: cand.rationale,
            evidence: cand.evidence
        })
    }

    const suggestedMilestoneIds = [...new Set(slots
        .filter((slot) => slot.targetKind === 'milestone' && slot.targetRecordId)
        .map((slot) => slot.targetRecordId as string))]

    const proposal = {
        changeSetId,
        transcriptId: ctx.transcript.id,
        opportunityId: ctx.opportunity.id,
        meetingType: ctx.transcript.meetingType,
        slots,
        newMilestones: signals.newMilestones,
        suggestedMilestoneIds,
        unmappedSignals: signals.unmappedSignals,
        proposedAt: now.toISOString()
    }

    return meetingChangeSetProposalSchema.parse(proposal)
}
