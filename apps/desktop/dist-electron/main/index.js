import { createRequire } from "node:module";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { AzureCliCredential, InteractiveBrowserCredential } from "@azure/identity";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { AIProjectClient } from "@azure/ai-projects";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
var workflowAgentCapabilityValues = [
	"account-pulse",
	"mcem-coach",
	"pursuit-executive",
	"risk-solution-play"
];
var workflowAgentCapabilitySchema = z.enum(workflowAgentCapabilityValues);
var scopeRefSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("portfolio") }).strict(),
	z.object({
		kind: z.literal("account"),
		accountId: z.string().min(1)
	}).strict(),
	z.object({
		kind: z.literal("opportunity"),
		accountId: z.string().min(1),
		opportunityId: z.string().min(1)
	}).strict()
]);
var workflowExecutionModeSchema = z.enum([
	"deterministic",
	"composite",
	"agentic"
]);
var workflowOutcomeStateSchema = z.enum([
	"complete",
	"partial",
	"unauthorized"
]);
var workflowRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled"
]);
var workflowConnectorStepSchema = z.object({
	connector: z.enum(["dataverse-mcp", "msx-mcp"]),
	operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
	required: z.boolean()
}).strict();
var workflowDefinitionSchema = z.object({
	contractVersion: z.literal("1.0"),
	id: z.string().regex(/^WF-[0-9]{3}$/),
	name: z.string().min(1).max(120),
	version: z.string().regex(/^\d+\.\d+\.\d+$/),
	scope: z.enum([
		"portfolio",
		"account",
		"opportunity"
	]),
	personaTargets: z.array(z.string().min(1)).min(1),
	category: z.string().regex(/^[a-z][a-z0-9-]*$/),
	executionMode: workflowExecutionModeSchema,
	connectorPlan: z.array(workflowConnectorStepSchema).min(1).max(6),
	inputSchemaRef: z.string().min(1),
	outputSchemaRef: z.string().min(1),
	sla: z.object({
		targetMs: z.number().int().min(1),
		timeoutMs: z.number().int().min(1)
	}).strict().refine((sla) => sla.timeoutMs >= sla.targetMs, "Workflow timeout must not be less than its target."),
	auth: z.object({
		requiresDelegatedUser: z.literal(true),
		allowedWrite: z.boolean()
	}).strict(),
	ui: z.object({
		cardStyle: z.enum([
			"exception-list",
			"metric-strip",
			"record-table",
			"timeline",
			"action-list"
		]),
		resultPriority: z.enum([
			"high",
			"medium",
			"low"
		]),
		showInQuickLaunch: z.boolean()
	}).strict()
}).strict();
var workflowConnectorCallSchema = z.object({
	connector: z.enum(["dataverse-mcp", "msx-mcp"]),
	operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
	status: z.enum([
		"success",
		"partial",
		"unauthorized",
		"failed",
		"cancelled"
	]),
	durationMs: z.number().int().nonnegative(),
	recordCount: z.number().int().nonnegative(),
	truncated: z.boolean()
}).strict();
var workflowRunSchema = z.object({
	contractVersion: z.literal("1.0"),
	runId: z.string().uuid(),
	workflowId: z.string().regex(/^WF-[0-9]{3}$/),
	status: workflowRunStatusSchema,
	state: workflowOutcomeStateSchema.optional(),
	scope: scopeRefSchema,
	startedAt: z.string().datetime().optional(),
	completedAt: z.string().datetime().optional(),
	connectorCalls: z.array(workflowConnectorCallSchema),
	resultRef: z.string().min(1).optional(),
	telemetry: z.object({
		correlationId: z.string().uuid(),
		firstResultMs: z.number().int().nonnegative().optional(),
		cacheHit: z.boolean()
	}).strict()
}).strict().superRefine((run, context) => {
	if (run.status === "queued" && (run.startedAt || run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Queued runs cannot have execution results."
	});
	if (run.status === "running" && (!run.startedAt || run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Running runs require startedAt and cannot be complete."
	});
	if (run.status === "completed" && (!run.startedAt || !run.completedAt || !run.state || !run.resultRef)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Completed runs require timestamps, outcome state, and a result."
	});
	if ((run.status === "failed" || run.status === "cancelled") && (!run.startedAt || !run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Terminal runs require timestamps and no outcome state."
	});
});
var workflowStatusTransitions = {
	queued: ["running", "cancelled"],
	running: [
		"completed",
		"failed",
		"cancelled"
	],
	completed: [],
	failed: [],
	cancelled: []
};
function isWorkflowRunTransitionAllowed(from, to) {
	return workflowStatusTransitions[from].includes(to);
}
var cardBaseSchema = z.object({
	title: z.string().min(1),
	evidenceIds: z.array(z.string().min(1))
});
var workflowResultCardSchema = z.discriminatedUnion("kind", [
	cardBaseSchema.extend({
		kind: z.literal("exception-list"),
		exceptions: z.array(z.object({
			id: z.string().min(1),
			title: z.string().min(1),
			priority: z.enum([
				"P0",
				"P1",
				"P2"
			]),
			detail: z.string().min(1),
			evidenceIds: z.array(z.string().min(1))
		}).strict())
	}).strict(),
	cardBaseSchema.extend({
		kind: z.literal("metric-strip"),
		metrics: z.array(z.object({
			label: z.string().min(1),
			value: z.union([z.string(), z.number()])
		}).strict()).min(1)
	}).strict(),
	cardBaseSchema.extend({
		kind: z.literal("record-table"),
		columns: z.array(z.string().min(1)).min(1),
		rows: z.array(z.record(z.string(), z.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.null()
		])))
	}).strict(),
	cardBaseSchema.extend({
		kind: z.literal("timeline"),
		events: z.array(z.object({
			at: z.string().datetime(),
			label: z.string().min(1)
		}).strict())
	}).strict(),
	cardBaseSchema.extend({
		kind: z.literal("action-list"),
		actions: z.array(z.object({
			id: z.string().min(1),
			label: z.string().min(1),
			priority: z.enum([
				"P0",
				"P1",
				"P2"
			])
		}).strict())
	}).strict()
]);
var mcpEvidenceLineageSchema = z.object({
	connector: z.enum(["dataverse-mcp", "msx-mcp"]),
	operation: z.string().regex(/^[a-z][a-z0-9_]*$/),
	queryTemplateId: z.string().min(1).optional(),
	toolCallId: z.string().min(1)
}).strict();
var changeSetItemSchema = z.object({
	itemId: z.string().uuid(),
	entity: z.string().min(1),
	recordId: z.string().min(1),
	field: z.string().min(1),
	before: z.unknown(),
	after: z.unknown(),
	rationale: z.string().min(1),
	evidenceIds: z.array(z.string().min(1)).min(1)
}).strict().refine((item) => !Object.is(item.before, item.after), "A change-set item must change its value.");
z.object({
	contractVersion: z.literal("1.0"),
	changeSetId: z.string().uuid(),
	proposedByCorrelationId: z.string().uuid(),
	scope: scopeRefSchema,
	proposedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	items: z.array(changeSetItemSchema).min(1)
}).strict().refine((proposal) => proposal.expiresAt > proposal.proposedAt, "Change-set expiry must follow proposal time.");
z.object({
	contractVersion: z.literal("1.0"),
	changeSetId: z.string().uuid(),
	approvedItemIds: z.array(z.string().uuid()).min(1),
	approvedAt: z.string().datetime(),
	reason: z.string().trim().min(3).max(1e3)
}).strict();
z.object({
	contractVersion: z.literal("1.0"),
	changeSetId: z.string().uuid(),
	state: z.enum([
		"applied",
		"conflict",
		"failed"
	]),
	auditNote: z.string().min(1),
	itemResults: z.array(z.object({
		itemId: z.string().uuid(),
		state: z.enum([
			"applied",
			"conflict",
			"failed"
		]),
		detail: z.string().min(1)
	}).strict()).min(1)
}).strict();
z.object({
	contractVersion: z.literal("1.0"),
	capability: workflowAgentCapabilitySchema,
	scope: scopeRefSchema,
	prompt: z.string().min(3).max(1e3)
}).strict();
var workflowGuidanceFactSchema = z.object({
	label: z.string().trim().min(1).max(80),
	value: z.string().trim().min(1).max(500)
}).strict();
var workflowGuidanceHandoffSchema = z.object({
	contractVersion: z.literal("1.0"),
	workflowId: z.string().regex(/^WF-[0-9]{3}$/),
	resultRef: z.string().min(1).max(200),
	capability: workflowAgentCapabilitySchema,
	scope: z.object({
		kind: z.literal("opportunity"),
		accountId: z.string().min(1).max(200),
		opportunityId: z.string().min(1).max(200)
	}).strict(),
	prompt: z.string().trim().min(3).max(1e3),
	context: z.object({
		cardTitle: z.string().trim().min(1).max(120),
		queueItemId: z.string().min(1).max(200).optional(),
		queueItemTitle: z.string().trim().min(1).max(240).optional(),
		facts: z.array(workflowGuidanceFactSchema).max(20),
		evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(20)
	}).strict()
}).strict();
//#endregion
//#region packages/common/configuration/se-domains.ts
/**
* Solution Engineer domains used to route MSX opportunity discovery.
*
* The classification is derived from the MSX `opportunity` Dataverse schema:
* `msp_solutionarea` is too coarse to separate Infrastructure, Data, and
* AI/Apps work (all three fall under "Cloud and AI Platforms"), so the fine
* grained `msp_technicalcapability` choice is used as the primary discriminator.
*/
var seDomainIds = [
	"infra",
	"data",
	"ai-apps",
	"security",
	"modern-work",
	"biz-apps",
	"devices",
	"services"
];
var seDomainSchema = z.enum(seDomainIds);
/**
* `msp_solutionarea` option code for "Cloud and AI Platforms". All three SE
* domains sit under this single solution area, so it is shared across them and
* used only as a coarse gate.
*/
var CLOUD_AND_AI_PLATFORMS = 39438e4;
var seDomainDefinitions = {
	infra: {
		id: "infra",
		label: "Infrastructure",
		description: "Azure infrastructure, migration, networking, and hybrid/edge opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			86198e4,
			861980074,
			861980075,
			861980076,
			861980005,
			861980029,
			861980011,
			861980008,
			861980015,
			861980024,
			861980030,
			861980072,
			861980028,
			861980026,
			861980019,
			861980018,
			861980014
		],
		conversationCodes: [884800006, 884800001]
	},
	data: {
		id: "data",
		label: "Data",
		description: "Analytics, data platform, and database modernization opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			861980073,
			861980077,
			861980085,
			861980020,
			861980049,
			861980027
		],
		conversationCodes: [
			884800007,
			884800015,
			884800002
		]
	},
	"ai-apps": {
		id: "ai-apps",
		label: "AI & Apps",
		description: "AI, machine learning, app modernization, and cloud-native application opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			861980002,
			861980009,
			861980023,
			861980007,
			861980071,
			861980041,
			861980082
		],
		conversationCodes: [8848e5, 884800012]
	},
	security: {
		id: "security",
		label: "Security",
		description: "Security, identity, threat protection, and information governance opportunities.",
		solutionAreaCodes: [861980005],
		technicalCapabilityCodes: [
			861980063,
			861980059,
			861980054,
			861980056,
			861980062,
			861980052,
			861980061
		],
		conversationCodes: [884800003, 884800013]
	},
	"modern-work": {
		id: "modern-work",
		label: "Modern Work",
		description: "Teams, collaboration, frontline, and workplace productivity opportunities.",
		solutionAreaCodes: [],
		technicalCapabilityCodes: [
			861980068,
			861980057,
			861980058,
			861980067,
			861980086,
			861980069,
			861980065,
			861980084,
			861980070
		],
		conversationCodes: [884800004, 884800011]
	},
	"biz-apps": {
		id: "biz-apps",
		label: "BizApps / Power Platform / D365",
		description: "Dynamics 365 and Power Platform business application opportunities.",
		solutionAreaCodes: [394380002],
		technicalCapabilityCodes: [
			861980034,
			861980050,
			861980046,
			861980047,
			861980051,
			861980078,
			861980035,
			861980032,
			861980079,
			861980080,
			861980081,
			861980083,
			861980031,
			861980033
		],
		conversationCodes: [884800005, 884800014]
	},
	devices: {
		id: "devices",
		label: "Devices / Mixed Reality",
		description: "Surface, device deployment/management, and mixed reality opportunities.",
		solutionAreaCodes: [861980012],
		technicalCapabilityCodes: [
			861980064,
			861980060,
			861980022
		],
		conversationCodes: [884800009]
	},
	services: {
		id: "services",
		label: "Services",
		description: "Microsoft advisory and consulting services opportunities.",
		solutionAreaCodes: [861980011],
		technicalCapabilityCodes: [861980055],
		conversationCodes: [884800008]
	}
};
seDomainIds.map((id) => seDomainDefinitions[id]);
function getSeDomainDefinition(id) {
	return seDomainDefinitions[id];
}
//#endregion
//#region packages/common/contracts/mcp.ts
var canonicalFieldSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);
var guardedQueryValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.union([z.string(), z.number()])).min(1).max(50)
]);
var guardedQueryFilterSchema = z.object({
	field: canonicalFieldSchema,
	operator: z.enum([
		"eq",
		"ne",
		"gt",
		"ge",
		"lt",
		"le",
		"contains",
		"startswith",
		"in",
		"on-or-after",
		"on-or-before"
	]),
	value: guardedQueryValueSchema
}).strict();
var guardedQueryOrderSchema = z.object({
	field: canonicalFieldSchema,
	direction: z.enum(["asc", "desc"])
}).strict();
var guardedQueryExpandSchema = z.object({
	relationship: canonicalFieldSchema,
	select: z.array(canonicalFieldSchema).min(1).max(12).refine(isUnique, "Expanded select fields must be unique.")
}).strict();
var guardedQueryRequestSchema = z.object({
	entity: canonicalFieldSchema,
	select: z.array(canonicalFieldSchema).min(1).max(40).refine(isUnique, "Select fields must be unique."),
	filter: z.array(guardedQueryFilterSchema).max(12).default([]),
	orderBy: z.array(guardedQueryOrderSchema).max(3).default([]).refine((orders) => isUnique(orders.map((order) => order.field)), "Order fields must be unique."),
	top: z.number().int().min(1).max(2e3).default(200),
	expand: z.array(guardedQueryExpandSchema).max(3).default([]).refine((expands) => isUnique(expands.map((expand) => expand.relationship)), "Expanded relationships must be unique.")
}).strict();
function isUnique(values) {
	return new Set(values).size === values.length;
}
//#endregion
//#region packages/common/contracts/portfolio.ts
var accountProvenanceSchema = z.enum([
	"deal-team",
	"manual",
	"both"
]);
var accountVisibilitySchema = z.enum(["visible", "hidden"]);
var accountSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	segment: z.string().min(1),
	tpid: z.string().min(1).optional(),
	provenance: accountProvenanceSchema.optional(),
	visibility: accountVisibilitySchema.optional()
});
var accountSearchRequestSchema = z.object({
	query: z.string().trim().min(1).max(120),
	matchBy: z.enum(["name", "tpid"])
}).strict().superRefine((value, context) => {
	if (value.matchBy === "name" && value.query.length < 2) context.addIssue({
		code: "custom",
		path: ["query"],
		message: "Account name searches require at least two characters."
	});
});
accountSchema.extend({ state: z.enum([
	"not-added",
	"visible",
	"hidden"
]) }).strict();
var accountListOptionsSchema = z.object({ includeHidden: z.boolean().optional() }).strict();
z.object({ visibility: accountVisibilitySchema }).strict();
z.object({
	opportunityId: z.string().min(1),
	onDealTeam: z.literal(true),
	alreadyMember: z.boolean()
}).strict();
z.object({
	opportunityId: z.string().min(1),
	onDealTeam: z.literal(false),
	alreadyAbsent: z.boolean()
}).strict();
//#endregion
//#region packages/common/contracts/meeting.ts
/**
* Contracts for the meeting-signal extraction → review → injection flow.
* See docs/MeetingCapture.md (Parts B, D, H). The transcript is untrusted input; the
* proposal/approval/result mirror the generic change-set contract with the fields the
* review UI needs (MCEM criterion, confidence, evidence, target kind).
*/
var meetingTypeSchema = z.enum(["customer", "internal"]);
var meetingSourceSchema = z.enum([
	"teams",
	"upload",
	"paste"
]);
var meetingTargetKindSchema = z.enum([
	"opportunity",
	"milestone",
	"new-milestone"
]);
var meetingValueTypeSchema = z.enum([
	"text",
	"money",
	"date",
	"optionset",
	"boolean",
	"percent"
]);
var mcemCriterionSchema = z.enum([
	"customer-outcome",
	"decision-team",
	"technical-validation",
	"business-case",
	"next-step",
	"risk",
	"sentiment",
	"stage",
	"notes"
]);
/** A meeting candidate shown in the launcher's picker. */
var meetingTranscriptSummarySchema = z.object({
	id: z.string().min(1),
	subject: z.string().min(1),
	occurredAt: z.string().datetime(),
	meetingType: meetingTypeSchema,
	source: meetingSourceSchema,
	opportunityId: z.string().min(1).optional(),
	opportunityName: z.string().min(1).optional(),
	segmentCount: z.number().int().nonnegative()
}).strict();
var meetingTranscriptSegmentSchema = z.object({
	segmentId: z.string().min(1),
	startMs: z.number().int().nonnegative().optional(),
	endMs: z.number().int().nonnegative().optional(),
	speaker: z.string().min(1).optional(),
	speakerRole: meetingTypeSchema.optional(),
	text: z.string().min(1)
}).strict();
var meetingTranscriptSchema = z.object({
	id: z.string().min(1),
	opportunityId: z.string().min(1).optional(),
	meetingType: meetingTypeSchema,
	title: z.string().min(1).optional(),
	source: meetingSourceSchema,
	segments: z.array(meetingTranscriptSegmentSchema)
}).strict();
/** One proposed field change, rendered as a review-table row. */
var meetingSlotSchema = z.object({
	slotId: z.string().min(1),
	label: z.string().min(1),
	mcemCriterion: mcemCriterionSchema,
	targetKind: meetingTargetKindSchema,
	targetRecordId: z.string().min(1).optional(),
	targetField: z.string().min(1),
	valueType: meetingValueTypeSchema,
	before: z.unknown().optional(),
	after: z.unknown(),
	displayBefore: z.string().optional(),
	displayAfter: z.string().min(1),
	confidence: z.number().min(0).max(1),
	checkedByDefault: z.boolean(),
	blocked: z.boolean(),
	blockedReason: z.string().min(1).optional(),
	sensitive: z.boolean(),
	rationale: z.string().min(1),
	evidence: z.array(z.string().min(1))
}).strict();
var meetingNewMilestoneSchema = z.object({
	tempId: z.string().min(1),
	name: z.string().min(1),
	milestoneDate: z.string().date().optional(),
	ownerName: z.string().min(1).optional(),
	commitment: z.enum(["Uncommitted", "Committed"]).optional(),
	confidence: z.number().min(0).max(1),
	checkedByDefault: z.boolean(),
	evidence: z.array(z.string().min(1))
}).strict();
var meetingUnmappedSignalSchema = z.object({
	label: z.string().min(1),
	text: z.string().min(1),
	mcemCriterion: mcemCriterionSchema,
	evidence: z.array(z.string().min(1))
}).strict();
var meetingChangeSetProposalSchema = z.object({
	changeSetId: z.string().min(1),
	transcriptId: z.string().min(1),
	opportunityId: z.string().min(1),
	meetingType: meetingTypeSchema,
	slots: z.array(meetingSlotSchema),
	newMilestones: z.array(meetingNewMilestoneSchema),
	suggestedMilestoneIds: z.array(z.string().min(1)),
	unmappedSignals: z.array(meetingUnmappedSignalSchema),
	proposedAt: z.string().datetime()
}).strict();
var meetingChangeSetApprovalSchema = z.object({
	changeSetId: z.string().min(1),
	opportunityId: z.string().min(1),
	approvedSlotIds: z.array(z.string().min(1)),
	approvedNewMilestoneTempIds: z.array(z.string().min(1)),
	selectedMilestoneIds: z.array(z.string().min(1)),
	reason: z.string().trim().min(3).max(1e3)
}).strict();
var meetingInjectItemResultSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["field", "new-milestone"]),
	state: z.enum([
		"applied",
		"conflict",
		"failed",
		"skipped"
	]),
	detail: z.string().min(1)
}).strict();
var meetingChangeSetResultSchema = z.object({
	changeSetId: z.string().min(1),
	state: z.enum(["applied", "rolled-back"]),
	items: z.array(meetingInjectItemResultSchema),
	auditNote: z.string().min(1)
}).strict();
var dataModeSchema = z.enum(["sample", "live"]);
var sourceStateSchema = z.enum([
	"sample",
	"live",
	"stale",
	"partial",
	"unauthorized",
	"unavailable"
]);
var sourceHealthSchema = z.object({
	source: z.enum([
		"msx",
		"mcem",
		"seismic",
		"linkedin",
		"dataverse-mcp",
		"msx-mcp"
	]),
	state: sourceStateSchema,
	detail: z.string().min(1),
	checkedAt: z.string().datetime()
});
var authStatusSchema = z.object({
	state: z.enum([
		"ready",
		"cli-missing",
		"login-required",
		"tenant-mismatch",
		"consent-required",
		"permission-missing"
	]),
	displayName: z.string().min(1).optional(),
	userEmail: z.string().email().optional(),
	tenantName: z.string().min(1).optional(),
	detail: z.string().min(1)
});
z.object({
	mode: dataModeSchema,
	auth: authStatusSchema
});
var opportunitySchema = z.object({
	id: z.string().min(1),
	accountId: z.string().min(1),
	name: z.string().min(1),
	owner: z.string().min(1).optional(),
	recordedStage: z.number().int().min(1).max(5),
	value: z.number().nonnegative(),
	currency: z.string().length(3),
	closeDate: z.string().date(),
	comments: z.string().optional()
});
var milestoneSchema = z.object({
	id: z.string().min(1),
	opportunityId: z.string().min(1),
	name: z.string().min(1),
	status: z.string().min(1),
	targetDate: z.string().date().optional(),
	estimatedMonthlyUsage: z.number().optional(),
	owner: z.string().min(1).optional(),
	commitment: z.string().min(1).optional(),
	riskDetails: z.string().optional(),
	comments: z.string().optional(),
	/**
	* Whether the signed-in user is on this milestone's team. Independent of
	* opportunity Deal Team membership and of the milestone owner. Set per-user by
	* the connector at read time; omitted means membership is unknown/not evaluated.
	*/
	onMilestoneTeam: z.boolean().optional()
});
var milestoneStatusSchema = z.enum([
	"On Track",
	"At Risk",
	"Blocked",
	"Completed",
	"Cancelled",
	"Lost to Competitor",
	"Hygiene/Duplicate"
]);
var customerCommitmentSchema = z.enum(["Uncommitted", "Committed"]);
var milestoneUpdateSchema = z.object({
	status: milestoneStatusSchema.optional(),
	riskDetails: z.string().max(3e4).optional(),
	targetDate: z.string().date().optional(),
	customerCommitment: customerCommitmentSchema.optional(),
	comments: z.string().max(3e4).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one milestone field is required.");
var opportunityUpdateSchema = z.object({ comments: z.string().max(3e4) });
z.object({
	opportunityId: z.string().min(1),
	milestoneId: z.string().min(1),
	onMilestoneTeam: z.literal(true),
	alreadyMember: z.boolean()
}).strict();
z.object({
	opportunityId: z.string().min(1),
	milestoneId: z.string().min(1),
	onMilestoneTeam: z.literal(false),
	alreadyAbsent: z.boolean()
}).strict();
/** Activity priority, mapped to the Dataverse task `prioritycode` (Low 0 / Normal 1 / High 2). */
var milestoneActivityPrioritySchema = z.enum([
	"Low",
	"Normal",
	"High"
]);
/**
* Task Category option set shown on the MSX "Quick Create: Task" form. Bundled so sample mode needs
* no network; in live mode the field + option codes are environment-configured.
*/
var taskCategorySchema = z.enum([
	"Architecture Design Session",
	"Assessment",
	"Blocker Escalation",
	"Briefing",
	"Call Back Requested",
	"Consumption Plan",
	"Cross Segment",
	"Cross Workload",
	"Customer Engagement",
	"Demo",
	"External (Co-creation of Value)",
	"Internal",
	"L300+ Demo",
	"Negotiate Pricing",
	"New Partner Request",
	"PoC/Pilot",
	"Post Sales",
	"Rapid Prototyping",
	"RFP/RFI",
	"Solution Whiteboarding",
	"Tech Support",
	"Technical Close/Win Plan",
	"Technical Workshop",
	"Workshop"
]);
z.object({
	id: z.string().min(1),
	milestoneId: z.string().min(1),
	opportunityId: z.string().min(1),
	subject: z.string().min(1),
	activityType: z.string().min(1),
	status: z.string().min(1),
	priority: milestoneActivityPrioritySchema.optional(),
	taskCategory: z.string().min(1).optional(),
	due: z.string().date().optional(),
	durationMinutes: z.number().int().positive().optional(),
	description: z.string().optional(),
	owner: z.string().min(1).optional(),
	createdBy: z.string().min(1).optional(),
	createdOn: z.string().datetime().optional()
});
/** Request to create a Task regarding a milestone (owner defaults to the signed-in user). */
var createMilestoneActivityRequestSchema = z.object({
	subject: z.string().trim().min(1).max(200),
	taskCategory: taskCategorySchema.optional(),
	description: z.string().max(3e4).optional(),
	due: z.string().date().optional(),
	priority: milestoneActivityPrioritySchema.default("Normal"),
	durationMinutes: z.number().int().positive().max(1e5).optional()
}).strict();
/**
* An opportunity surfaced by SE-domain discovery. It extends the base
* opportunity with the domain it matched and whether the signed-in user is
* already on its deal team, so a client can present a one-click join action.
*/
var discoverableOpportunitySchema = opportunitySchema.extend({
	domain: seDomainSchema,
	accountName: z.string().min(1).optional(),
	solutionArea: z.string().min(1).optional(),
	technicalCapability: z.string().min(1).optional(),
	onDealTeam: z.boolean()
});
var mcemStageTransitionRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	accountId: z.string().min(1),
	opportunityId: z.string().min(1),
	targetStage: z.number().int().min(1).max(5),
	reason: z.string().trim().min(10).max(1e3).optional()
}).strict();
var mcemStageTransitionResultSchema = z.object({
	opportunity: opportunitySchema,
	previousStage: z.number().int().min(1).max(5),
	targetStage: z.number().int().min(1).max(5),
	disposition: z.enum([
		"advanced",
		"override",
		"recycled"
	]),
	auditNote: z.string().min(1)
}).strict();
var evidenceSchema = z.object({
	id: z.string().min(1),
	source: z.enum([
		"msx",
		"mcem",
		"dataverse-mcp",
		"msx-mcp"
	]),
	recordId: z.string().min(1),
	title: z.string().min(1),
	url: z.string().url().optional(),
	retrievedAt: z.string().datetime(),
	modifiedAt: z.string().datetime().optional(),
	accessContext: z.enum(["sample", "delegated-user"]),
	quality: z.enum([
		"authoritative",
		"observed",
		"stale",
		"incomplete"
	]),
	excerpt: z.string().min(1)
});
var criterionSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	status: z.enum([
		"met",
		"partial",
		"missing"
	]),
	rationale: z.string().min(1),
	evidenceIds: z.array(z.string().min(1))
});
var recommendationSchema = z.object({
	id: z.string().min(1),
	action: z.string().min(1),
	ownerRole: z.string().min(1),
	rationale: z.string().min(1),
	evidenceIds: z.array(z.string().min(1)),
	assumption: z.boolean(),
	confidence: z.enum([
		"high",
		"medium",
		"low"
	])
}).superRefine((recommendation, context) => {
	if (recommendation.evidenceIds.length === 0 && !recommendation.assumption) context.addIssue({
		code: "custom",
		path: ["evidenceIds"],
		message: "A recommendation must cite evidence or be labeled as an assumption."
	});
});
var mcemRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	accountId: z.string().min(1),
	opportunityId: z.string().min(1),
	prompt: z.string().min(3).max(1e3)
});
var agentCapabilitySchema = z.enum(workflowAgentCapabilityValues);
var agentTaskRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	capability: agentCapabilitySchema,
	accountId: z.string().min(1),
	opportunityId: z.string().min(1),
	prompt: z.string().min(3).max(1e3)
});
z.object({
	contractVersion: z.literal("1.0"),
	correlationId: z.string().uuid(),
	capability: agentCapabilitySchema,
	agentVersion: z.string().min(1),
	generatedAt: z.string().datetime(),
	mode: dataModeSchema,
	state: z.enum([
		"complete",
		"partial",
		"unauthorized"
	]),
	content: z.string().min(1),
	sourceHealth: z.array(sourceHealthSchema).min(1)
});
var emailComposeRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	recipients: z.array(z.string().email()).min(1).max(20),
	subject: z.string().trim().min(1).max(255),
	responseTitle: z.string().trim().min(1).max(255),
	responseMarkdown: z.string().min(1).max(2e5)
}).strict();
z.object({ state: z.literal("opened") }).strict();
var exportResponseRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	responseTitle: z.string().trim().min(1).max(255),
	responseMarkdown: z.string().min(1).max(2e5),
	generatedAt: z.string().datetime()
}).strict();
z.discriminatedUnion("state", [z.object({
	state: z.literal("saved"),
	filePath: z.string().min(1)
}).strict(), z.object({ state: z.literal("cancelled") }).strict()]);
var mcemResponseSchema = z.object({
	contractVersion: z.literal("1.0"),
	correlationId: z.string().uuid(),
	capability: z.literal("mcem-coach"),
	agentVersion: z.string().min(1),
	generatedAt: z.string().datetime(),
	mode: dataModeSchema,
	state: z.enum([
		"complete",
		"partial",
		"unauthorized"
	]),
	summary: z.string().min(1),
	recordedStage: z.number().int().min(1).max(5),
	evidenceBasedStage: z.number().int().min(1).max(5),
	criteria: z.array(criterionSchema).min(1),
	recommendations: z.array(recommendationSchema).min(1),
	missingData: z.array(z.string().min(1)),
	evidence: z.array(evidenceSchema).min(1),
	sourceHealth: z.array(sourceHealthSchema).min(1)
});
z.object({
	correlationId: z.string().uuid(),
	agentVersion: z.string().min(1),
	capability: z.literal("mcem-coach"),
	category: z.enum([
		"useful",
		"incorrect",
		"missing-source",
		"wrong-owner",
		"other"
	]),
	comment: z.string().max(500).optional()
});
//#endregion
//#region packages/common/configuration/dataverse-entity-map.ts
var canonicalNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);
var logicalNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
var attributeLogicalNameSchema = z.string().regex(/^_?[a-z][a-z0-9_]*$/);
var dataverseAttributeMappingSchema = z.object({
	canonical: canonicalNameSchema,
	logicalName: attributeLogicalNameSchema,
	label: z.string().min(1),
	dataType: z.enum([
		"string",
		"number",
		"boolean",
		"date",
		"datetime",
		"money",
		"lookup",
		"optionset",
		"uniqueidentifier"
	]),
	optionSet: z.record(z.string(), z.number().int()).optional(),
	sensitivity: z.enum([
		"public",
		"internal",
		"restricted"
	]),
	includeInPrompt: z.boolean(),
	format: z.string().min(1).optional()
}).strict().superRefine((attribute, context) => {
	if (attribute.sensitivity === "restricted" && attribute.includeInPrompt) context.addIssue({
		code: "custom",
		path: ["includeInPrompt"],
		message: "Restricted attributes cannot be included in model prompts."
	});
});
var dataverseEntityMappingSchema = z.object({
	canonical: canonicalNameSchema,
	logicalName: logicalNameSchema,
	entitySetName: logicalNameSchema,
	primaryIdAttribute: logicalNameSchema,
	primaryNameAttribute: logicalNameSchema,
	label: z.string().min(1),
	scope: z.enum([
		"opportunity",
		"account",
		"portfolio",
		"reference"
	]),
	deepLinkTemplate: z.string().url().optional(),
	userScopePredicate: z.string().min(1).optional(),
	attributes: z.array(dataverseAttributeMappingSchema).min(1)
}).strict().superRefine((entity, context) => {
	if (entity.scope !== "reference" && !entity.userScopePredicate) context.addIssue({
		code: "custom",
		path: ["userScopePredicate"],
		message: "Non-reference entities require a delegated-user scope predicate."
	});
	addDuplicateIssue(entity.attributes.map((attribute) => attribute.canonical), ["attributes"], "canonical names", context);
	addDuplicateIssue(entity.attributes.map((attribute) => attribute.logicalName), ["attributes"], "logical names", context);
});
var dataverseEntityMapSchema = z.object({
	schemaVersion: z.literal(1),
	environmentLabel: z.string().min(1),
	refreshedAt: z.string().datetime(),
	entities: z.array(dataverseEntityMappingSchema).min(1)
}).strict().superRefine((mapping, context) => {
	addDuplicateIssue(mapping.entities.map((entity) => entity.canonical), ["entities"], "canonical names", context);
	addDuplicateIssue(mapping.entities.map((entity) => entity.logicalName), ["entities"], "logical names", context);
});
function addDuplicateIssue(values, path, label, context) {
	if (new Set(values).size !== values.length) context.addIssue({
		code: "custom",
		path,
		message: `Dataverse mapping ${label} must be unique.`
	});
}
async function loadDataverseEntityMap(filePath) {
	let content;
	try {
		content = await readFile(filePath, "utf8");
	} catch (cause) {
		throw new Error(`Unable to read Dataverse entity map: ${filePath}`, { cause });
	}
	let candidate;
	try {
		candidate = JSON.parse(content);
	} catch (cause) {
		throw new Error(`Dataverse entity map is not valid JSON: ${filePath}`, { cause });
	}
	return dataverseEntityMapSchema.parse(candidate);
}
//#endregion
//#region packages/common/configuration/mcp-servers.ts
var mcpServerIdSchema = z.enum(["dataverse", "msx"]);
var mcpServerSchema = z.object({
	id: mcpServerIdSchema,
	connectionId: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
	displayName: z.string().min(1),
	enabled: z.boolean(),
	execution: z.literal("local-client"),
	serverUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", { message: "MCP server URLs must use HTTPS." }),
	serverLabel: z.string().regex(/^[a-z][a-z0-9_]*$/),
	authentication: z.object({
		kind: z.literal("entra-delegated"),
		scopes: z.array(z.string().min(1)).min(1)
	}).strict(),
	limits: z.object({
		connectTimeoutMs: z.number().int().min(1e3).max(6e4),
		callTimeoutMs: z.number().int().min(1e3).max(12e4),
		maxConcurrentCalls: z.number().int().min(1).max(8),
		maxToolCallsPerRequest: z.number().int().min(1).max(12),
		maxRowsPerCall: z.number().int().min(1).max(5e3),
		maxResultBytes: z.number().int().min(1024).max(2e6)
	}).strict(),
	retry: z.object({
		maxAttempts: z.number().int().min(1).max(4),
		initialDelayMs: z.number().int().min(50).max(5e3),
		backoffMultiplier: z.number().min(1).max(4),
		retryOnStatus: z.array(z.number().int().min(400).max(599)).default([
			429,
			500,
			502,
			503,
			504
		])
	}).strict(),
	circuitBreaker: z.object({
		failureThreshold: z.number().int().min(1).max(20),
		openDurationMs: z.number().int().min(1e3).max(6e5)
	}).strict()
}).strict();
var mcpServerRegistrySchema = z.object({
	schemaVersion: z.literal(1),
	servers: z.array(mcpServerSchema).min(1)
}).strict().superRefine((registry, context) => {
	const ids = registry.servers.map((server) => server.id);
	if (new Set(ids).size !== ids.length) context.addIssue({
		code: "custom",
		path: ["servers"],
		message: "MCP server ids must be unique."
	});
	const connections = /* @__PURE__ */ new Map();
	for (const [index, server] of registry.servers.entries()) {
		const connectionId = server.connectionId ?? server.id;
		const fingerprint = JSON.stringify({
			serverUrl: server.serverUrl,
			authentication: server.authentication,
			limits: server.limits,
			retry: server.retry,
			circuitBreaker: server.circuitBreaker
		});
		const existing = connections.get(connectionId);
		if (existing !== void 0 && existing !== fingerprint) context.addIssue({
			code: "custom",
			path: [
				"servers",
				index,
				"connectionId"
			],
			message: "MCP servers sharing a connectionId must use identical connection settings."
		});
		else connections.set(connectionId, fingerprint);
	}
});
async function loadMcpServerRegistry(filePath) {
	return mcpServerRegistrySchema.parse(await readJson(filePath, "MCP server registry"));
}
async function readJson(filePath, label) {
	let content;
	try {
		content = await readFile(filePath, "utf8");
	} catch (cause) {
		throw new Error(`Unable to read ${label}: ${filePath}`, { cause });
	}
	try {
		return JSON.parse(content);
	} catch (cause) {
		throw new Error(`${label} is not valid JSON: ${filePath}`, { cause });
	}
}
//#endregion
//#region packages/common/configuration/mcp-tool-policy.ts
var toolRiskClassSchema = z.enum([
	"explore",
	"read",
	"write",
	"forbidden"
]);
var mcpScopeKindSchema = z.enum([
	"opportunity",
	"account",
	"portfolio"
]);
var mcpToolPolicyEntrySchema = z.object({
	serverId: mcpServerIdSchema,
	tool: z.string().regex(/^[a-z][a-z0-9_]*$/),
	riskClass: toolRiskClassSchema,
	enabled: z.boolean(),
	approval: z.enum([
		"none",
		"confirm",
		"confirm-with-reason"
	]),
	allowedCapabilities: z.array(agentCapabilitySchema).min(1),
	allowedScopes: z.array(mcpScopeKindSchema).min(1),
	maxRows: z.number().int().min(1).max(5e3).optional(),
	redactFields: z.array(z.string().min(1)).default([]),
	rateLimitPerMinute: z.number().int().min(1).max(120).optional(),
	notes: z.string().max(500).optional()
}).strict().superRefine((entry, context) => {
	if (entry.riskClass === "write" && entry.approval === "none") context.addIssue({
		code: "custom",
		path: ["approval"],
		message: "Write tools must require approval."
	});
	if (entry.riskClass === "forbidden" && entry.enabled) context.addIssue({
		code: "custom",
		path: ["enabled"],
		message: "Forbidden tools cannot be enabled."
	});
	if (/^(delete|drop|truncate)(_|$)/i.test(entry.tool) && entry.enabled) context.addIssue({
		code: "custom",
		path: ["enabled"],
		message: "Destructive tools cannot be enabled."
	});
});
var mcpToolPolicySchema = z.object({
	schemaVersion: z.literal(1),
	defaultDeny: z.literal(true),
	entries: z.array(mcpToolPolicyEntrySchema)
}).strict().superRefine((policy, context) => {
	const keys = policy.entries.map((entry) => `${entry.serverId}:${entry.tool}`);
	if (new Set(keys).size !== keys.length) context.addIssue({
		code: "custom",
		path: ["entries"],
		message: "MCP tool policy entries must be unique by server and tool."
	});
});
async function loadMcpToolPolicy(filePath) {
	let content;
	try {
		content = await readFile(filePath, "utf8");
	} catch (cause) {
		throw new Error(`Unable to read MCP tool policy: ${filePath}`, { cause });
	}
	let candidate;
	try {
		candidate = JSON.parse(content);
	} catch (cause) {
		throw new Error(`MCP tool policy is not valid JSON: ${filePath}`, { cause });
	}
	return mcpToolPolicySchema.parse(candidate);
}
//#endregion
//#region packages/common/configuration/workflow-descriptions.ts
var workflowDescriptionSchema = z.object({
	summary: z.string().min(1).max(400),
	reads: z.string().min(1).max(400),
	useIt: z.string().min(1).max(400)
}).strict();
z.object({
	schemaVersion: z.literal(1),
	descriptions: z.record(z.string().regex(/^WF-[0-9]{3}$/), workflowDescriptionSchema)
}).strict();
//#endregion
//#region packages/common/sharing/opportunity-link.ts
function addMsxOpportunityLink(content, opportunityId) {
	if (/microsoftsales\.crm\.dynamics\.com\/main\.aspx[^\s)]*\bopportunity\b/i.test(content)) return content;
	const opportunityUrl = new URL("https://microsoftsales.crm.dynamics.com/main.aspx");
	opportunityUrl.searchParams.set("pagetype", "entityrecord");
	opportunityUrl.searchParams.set("etn", "opportunity");
	opportunityUrl.searchParams.set("id", opportunityId);
	const link = `**MSX Opportunity:** [Open opportunity in MSX](${opportunityUrl.toString()})`;
	const lines = content.split("\n");
	const accountLine = lines.findIndex((line) => /^\s*\*\*Account:\*\*/i.test(line));
	const headingLine = lines.findIndex((line) => /^\s*#{1,6}\s+/.test(line));
	const insertionIndex = accountLine >= 0 ? accountLine + 1 : headingLine >= 0 ? headingLine + 1 : 0;
	lines.splice(insertionIndex, 0, link);
	return lines.join("\n");
}
//#endregion
//#region packages/common/telemetry/performance.ts
async function measurePerformance(operation, reporter, action) {
	const startedAt = globalThis.performance.now();
	try {
		const result = await action();
		report(reporter, operation, startedAt, "success");
		return result;
	} catch (error) {
		report(reporter, operation, startedAt, "failure");
		throw error;
	}
}
function report(reporter, operation, startedAt, outcome) {
	try {
		reporter?.({
			operation,
			durationMs: Math.round((globalThis.performance.now() - startedAt) * 10) / 10,
			outcome
		});
	} catch {}
}
//#endregion
//#region packages/common/configuration/foundry-environment.ts
var windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/;
var templatePlaceholderIds = /* @__PURE__ */ new Set([
	"11111111-1111-4111-8111-111111111111",
	"22222222-2222-4222-8222-222222222222",
	"33333333-3333-4333-8333-333333333333"
]);
var configuredUuidSchema = z.string().uuid().refine((value) => !templatePlaceholderIds.has(value), "Replace the template UUID with the Azure resource value.");
var appRegistrationSchema = z.object({
	tenantId: configuredUuidSchema,
	clientId: configuredUuidSchema,
	redirectUri: z.string().url()
}).strict();
var resourceScopesSchema = z.object({
	foundry: z.array(z.string().min(1)).min(1),
	msx: z.array(z.string().min(1)).min(1),
	graph: z.array(z.string().min(1)).min(1)
}).strict();
var authenticationSchema = z.discriminatedUnion("mode", [z.object({
	mode: z.literal("azure-cli"),
	expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
	foundryTenantId: configuredUuidSchema,
	scopes: resourceScopesSchema,
	appRegistration: appRegistrationSchema.optional()
}).strict(), z.object({
	mode: z.literal("interactive-browser"),
	expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
	foundryTenantId: configuredUuidSchema,
	scopes: resourceScopesSchema,
	appRegistration: appRegistrationSchema
}).strict()]);
var foundryAgentSchema = z.object({
	name: z.string().min(1),
	type: z.enum(["prompt", "hosted"]),
	protocol: z.enum(["responses", "invocations"])
}).strict();
var foundryEnvironmentSchema = z.object({
	schemaVersion: z.literal(1),
	environment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	authentication: authenticationSchema,
	foundry: z.object({
		projectEndpoint: z.string().url().refine((value) => !value.includes("YOUR-FOUNDRY-ACCOUNT") && !value.includes("/YOUR-PROJECT"), "Replace the template endpoint with the Microsoft Foundry project endpoint."),
		requestTimeoutMs: z.number().int().min(1e3).max(3e5),
		agents: z.object({
			mcemCoach: foundryAgentSchema,
			riskSolutionPlay: foundryAgentSchema,
			pursuitExecutive: foundryAgentSchema,
			accountPulse: foundryAgentSchema
		}).strict()
	}).strict()
}).strict();
function resolveFoundryEnvironmentPath(environment = process.env, workingDirectory = process.cwd()) {
	const relativePath = environment["TLC_FOUNDRY_ENV_FILE"]?.trim() || "config/foundry.environment.json";
	return (windowsAbsolutePathPattern.test(workingDirectory) ? win32 : posix).resolve(workingDirectory, relativePath);
}
async function loadFoundryEnvironment(filePath) {
	let content;
	try {
		content = await readFile(filePath, "utf8");
	} catch (cause) {
		throw new Error(`Unable to read Foundry environment file: ${filePath}`, { cause });
	}
	let candidate;
	try {
		candidate = JSON.parse(content);
	} catch (cause) {
		throw new Error(`Foundry environment file is not valid JSON: ${filePath}`, { cause });
	}
	return foundryEnvironmentSchema.parse(candidate);
}
//#endregion
//#region packages/connectors/common/portfolio-preferences.ts
var preferencesSchema = z.object({
	manualAccountIds: z.array(z.string().min(1)),
	hiddenAccountIds: z.array(z.string().min(1)),
	revision: z.number().int().nonnegative()
}).strict();
var preferencesFileSchema = z.record(z.string().min(1), preferencesSchema);
function emptyPreferences() {
	return {
		manualAccountIds: [],
		hiddenAccountIds: [],
		revision: 0
	};
}
function updatedPreferences(current, manualAccountIds, hiddenAccountIds) {
	const nextManual = [...manualAccountIds].sort();
	const nextHidden = [...hiddenAccountIds].sort();
	return {
		manualAccountIds: nextManual,
		hiddenAccountIds: nextHidden,
		revision: nextManual.join("\0") !== current.manualAccountIds.join("\0") || nextHidden.join("\0") !== current.hiddenAccountIds.join("\0") ? current.revision + 1 : current.revision
	};
}
var MemoryPortfolioPreferenceStore = class {
	records = /* @__PURE__ */ new Map();
	async read(userKey) {
		return structuredClone(this.records.get(userKey) ?? emptyPreferences());
	}
	async addAccount(userKey, accountId) {
		const current = await this.read(userKey);
		const manual = new Set(current.manualAccountIds);
		manual.add(accountId);
		const next = updatedPreferences(current, manual, new Set(current.hiddenAccountIds));
		this.records.set(userKey, next);
		return structuredClone(next);
	}
	async setVisibility(userKey, accountId, visibility) {
		const current = await this.read(userKey);
		const hidden = new Set(current.hiddenAccountIds);
		if (visibility === "hidden") hidden.add(accountId);
		else hidden.delete(accountId);
		const next = updatedPreferences(current, new Set(current.manualAccountIds), hidden);
		this.records.set(userKey, next);
		return structuredClone(next);
	}
};
var JsonFilePortfolioPreferenceStore = class {
	filePath;
	mutationQueue = Promise.resolve();
	constructor(filePath) {
		this.filePath = filePath;
	}
	read(userKey) {
		return this.withQueue(async () => {
			const records = await this.readRecords();
			return structuredClone(records[userKey] ?? emptyPreferences());
		});
	}
	addAccount(userKey, accountId) {
		return this.mutate(userKey, (current) => {
			const manual = new Set(current.manualAccountIds);
			manual.add(accountId);
			return updatedPreferences(current, manual, new Set(current.hiddenAccountIds));
		});
	}
	setVisibility(userKey, accountId, visibility) {
		return this.mutate(userKey, (current) => {
			const hidden = new Set(current.hiddenAccountIds);
			if (visibility === "hidden") hidden.add(accountId);
			else hidden.delete(accountId);
			return updatedPreferences(current, new Set(current.manualAccountIds), hidden);
		});
	}
	withQueue(operation) {
		const result = this.mutationQueue.then(operation, operation);
		this.mutationQueue = result.then(() => void 0, () => void 0);
		return result;
	}
	mutate(userKey, update) {
		return this.withQueue(async () => {
			const records = await this.readRecords();
			const next = update(records[userKey] ?? emptyPreferences());
			records[userKey] = next;
			await this.writeRecords(records);
			return structuredClone(next);
		});
	}
	async readRecords() {
		let content;
		try {
			content = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return {};
			throw error;
		}
		return preferencesFileSchema.parse(JSON.parse(content));
	}
	async writeRecords(records) {
		await mkdir(dirname(this.filePath), { recursive: true });
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
		await rename(temporaryPath, this.filePath);
	}
};
//#endregion
//#region packages/connectors/common/milestone-membership.ts
/**
* A single milestone-team membership for a user. The opportunity id is denormalized
* alongside the milestone id so portfolio assembly can union milestone-team
* opportunities without an extra per-milestone lookup.
*/
var milestoneMembershipSchema = z.object({
	milestoneId: z.string().min(1),
	opportunityId: z.string().min(1)
}).strict();
z.record(z.string().min(1), z.array(milestoneMembershipSchema));
//#endregion
//#region packages/connectors/msx/live.ts
var defaultBaseUrl = "https://microsoftsales.crm.dynamics.com/api/data/v9.2/";
var formattedValueSuffix = "@OData.Community.Display.V1.FormattedValue";
var guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var milestoneStatusCodes = {
	"On Track": 86198e4,
	"At Risk": 861980001,
	Blocked: 861980002,
	Completed: 861980003,
	Cancelled: 861980004
};
var customerCommitmentCodes = {
	Uncommitted: 86198e4,
	Committed: 861980003
};
var defaultDealTeamWriteMetadata = {
	entitySet: "msp_dealteams",
	logicalName: "msp_dealteam",
	userLookupField: "_msp_dealteamuserid_value",
	opportunityLookupField: "_msp_parentopportunityid_value"
};
/** Applies the default template name to a partial milestone-team access-team config. */
function resolveMilestoneTeamAccessMetadata(partial) {
	return {
		templateName: partial?.templateName?.trim() || "Milestone Team",
		...partial?.templateId ? { templateId: partial.templateId } : {}
	};
}
var MILESTONE_TEAM_NOT_CONFIGURED_MESSAGE = "The Milestone Team is not set up in this MSX environment, so your change was not saved. Ask your administrator to enable the Milestone Team access team on the milestone form.";
/** Derives a lookup attribute logical name (e.g. `msp_dealteamuserid`) from its `_x_value` field. */
function lookupAttributeName(valueField) {
	return valueField.replace(/^_/, "").replace(/_value$/, "");
}
/** Dataverse task `prioritycode`: Low 0 / Normal 1 / High 2. */
var taskPriorityCodes = {
	Low: 0,
	Normal: 1,
	High: 2
};
var taskPriorityByCode = {
	0: "Low",
	1: "Normal",
	2: "High"
};
/** Dataverse task `statecode`: Open 0 / Completed 1 / Canceled 2. */
var taskStatusByState = {
	0: "Open",
	1: "Completed",
	2: "Canceled"
};
var navigationPropertyPattern = /^[A-Za-z][A-Za-z0-9_]*$/;
function msxWriteMetadataFromEnvironment(environment) {
	const riskDetailsField = environment["TLC_MSX_RISK_DETAILS_FIELD"]?.trim();
	const accountTpidField = environment["TLC_MSX_ACCOUNT_TPID_FIELD"]?.trim();
	if (accountTpidField && !navigationPropertyPattern.test(accountTpidField)) throw new Error("TLC_MSX_ACCOUNT_TPID_FIELD must be a valid Dataverse identifier.");
	const configuredCodes = {};
	const stageCodes = {};
	for (const [status, variable] of [["Lost to Competitor", "TLC_MSX_STATUS_LOST_TO_COMPETITOR"], ["Hygiene/Duplicate", "TLC_MSX_STATUS_HYGIENE_DUPLICATE"]]) {
		const rawValue = environment[variable]?.trim();
		if (!rawValue) continue;
		const code = Number(rawValue);
		if (!Number.isSafeInteger(code)) throw new Error(`${variable} must be an integer MSX option code.`);
		configuredCodes[status] = code;
	}
	for (const stage of [
		1,
		2,
		3,
		4,
		5
	]) {
		const variable = `TLC_MSX_STAGE_${stage}`;
		const rawValue = environment[variable]?.trim();
		if (!rawValue) continue;
		const code = Number(rawValue);
		if (!Number.isSafeInteger(code)) throw new Error(`${variable} must be an integer MSX option code.`);
		stageCodes[stage] = code;
	}
	const dealTeam = {};
	for (const [key, variable] of [
		["entitySet", "TLC_MSX_DEALTEAM_ENTITY_SET"],
		["logicalName", "TLC_MSX_DEALTEAM_LOGICAL_NAME"],
		["userNavigationProperty", "TLC_MSX_DEALTEAM_USER_NAV_PROPERTY"],
		["opportunityNavigationProperty", "TLC_MSX_DEALTEAM_OPPORTUNITY_NAV_PROPERTY"],
		["userLookupField", "TLC_MSX_DEALTEAM_USER_LOOKUP_FIELD"],
		["opportunityLookupField", "TLC_MSX_DEALTEAM_OPPORTUNITY_LOOKUP_FIELD"]
	]) {
		const rawValue = environment[variable]?.trim();
		if (!rawValue) continue;
		if (!navigationPropertyPattern.test(rawValue)) throw new Error(`${variable} must be a valid Dataverse identifier.`);
		dealTeam[key] = rawValue;
	}
	const milestoneTeam = {};
	const milestoneTeamTemplateName = environment["TLC_MSX_MILESTONE_TEAM_TEMPLATE_NAME"]?.trim();
	if (milestoneTeamTemplateName) milestoneTeam.templateName = milestoneTeamTemplateName;
	const milestoneTeamTemplateId = environment["TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID"]?.trim();
	if (milestoneTeamTemplateId) {
		if (!guidPattern.test(milestoneTeamTemplateId)) throw new Error("TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID must be a valid GUID.");
		milestoneTeam.templateId = milestoneTeamTemplateId;
	}
	const taskCategoryField = environment["TLC_MSX_TASK_CATEGORY_FIELD"]?.trim();
	if (taskCategoryField && !navigationPropertyPattern.test(taskCategoryField)) throw new Error("TLC_MSX_TASK_CATEGORY_FIELD must be a valid Dataverse identifier.");
	let taskCategoryCodes;
	const rawTaskCategoryCodes = environment["TLC_MSX_TASK_CATEGORY_CODES"]?.trim();
	if (rawTaskCategoryCodes) {
		let parsed;
		try {
			parsed = JSON.parse(rawTaskCategoryCodes);
		} catch {
			throw new Error("TLC_MSX_TASK_CATEGORY_CODES must be a JSON object mapping category labels to integer codes.");
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("TLC_MSX_TASK_CATEGORY_CODES must be a JSON object mapping category labels to integer codes.");
		const codes = {};
		for (const [label, code] of Object.entries(parsed)) {
			if (!Number.isSafeInteger(code)) throw new Error(`TLC_MSX_TASK_CATEGORY_CODES["${label}"] must be an integer option code.`);
			codes[label] = code;
		}
		taskCategoryCodes = codes;
	}
	return {
		...riskDetailsField ? { riskDetailsField } : {},
		...accountTpidField ? { accountTpidField } : {},
		...Object.keys(configuredCodes).length > 0 ? { milestoneStatusCodes: configuredCodes } : {},
		...Object.keys(stageCodes).length > 0 ? { stageCodes } : {},
		...Object.keys(dealTeam).length > 0 ? { dealTeam } : {},
		...Object.keys(milestoneTeam).length > 0 ? { milestoneTeam } : {},
		...taskCategoryField ? { taskCategoryField } : {},
		...taskCategoryCodes ? { taskCategoryCodes } : {}
	};
}
var MsxRequestError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "MsxRequestError";
	}
};
var LiveMsxConnector = class {
	tokenProvider;
	fetchImplementation;
	performanceReporter;
	writeMetadata;
	preferenceStore;
	baseUrl;
	portfolioPromise;
	observationPromises = /* @__PURE__ */ new Map();
	milestonePromises = /* @__PURE__ */ new Map();
	currentUserIdPromise;
	dealTeamBindingsPromise;
	milestoneTeamTemplateIdPromise;
	constructor(tokenProvider, fetchImplementation = fetch, baseUrl = defaultBaseUrl, performanceReporter, writeMetadata = {}, preferenceStore = new MemoryPortfolioPreferenceStore()) {
		this.tokenProvider = tokenProvider;
		this.fetchImplementation = fetchImplementation;
		this.performanceReporter = performanceReporter;
		this.writeMetadata = writeMetadata;
		this.preferenceStore = preferenceStore;
		this.baseUrl = new URL(baseUrl);
		if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) throw new Error("The MSX risk details logical field name is invalid.");
	}
	async listAccounts(options = {}) {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.accounts.filter((account) => options.includeHidden || account.visibility !== "hidden"));
	}
	async searchAccounts(input) {
		const request = accountSearchRequestSchema.parse(input);
		const escapedQuery = escapeODataStringLiteral(request.query);
		const tpidField = this.writeMetadata.accountTpidField;
		if (request.matchBy === "tpid" && !tpidField) throw new Error("TPID search requires TLC_MSX_ACCOUNT_TPID_FIELD to contain the verified account TPID logical field.");
		const rows = await measurePerformance("msx.search-accounts", this.performanceReporter, () => this.requestAll("accounts", {
			"$select": [
				"accountid",
				"name",
				tpidField
			].filter(isPresent).join(","),
			"$filter": request.matchBy === "name" ? `statecode eq 0 and contains(name,'${escapedQuery}')` : `statecode eq 0 and ${tpidField} eq '${escapedQuery}'`,
			"$orderby": "name asc",
			"$top": "25"
		}));
		const portfolio = await this.getPortfolio();
		const existingById = new Map(portfolio.accounts.map((account) => [account.id, account]));
		return rows.map((row) => {
			const existing = existingById.get(row.accountid);
			return {
				...existing ?? this.mapAccount(row),
				state: existing?.visibility === "hidden" ? "hidden" : existing ? "visible" : "not-added"
			};
		});
	}
	async addAccount(accountId) {
		this.assertAccountId(accountId);
		if ((await this.requestByIds("accounts", "accountid", [accountId], [
			"accountid",
			"name",
			this.writeMetadata.accountTpidField
		].filter(isPresent).join(","))).length !== 1) throw new Error("The selected account is unavailable or inactive in MSX.");
		await this.preferenceStore.addAccount(await this.getCurrentUserId(), accountId);
		this.portfolioPromise = void 0;
		const account = (await this.getPortfolio()).accounts.find((candidate) => candidate.id === accountId);
		if (!account) throw new Error("The account preference was saved but the account could not be reloaded.");
		return structuredClone(account);
	}
	async setAccountVisibility(accountId, visibility) {
		this.assertAccountId(accountId);
		const row = (await this.requestByIds("accounts", "accountid", [accountId], [
			"accountid",
			"name",
			this.writeMetadata.accountTpidField
		].filter(isPresent).join(",")))[0];
		if (!row) throw new Error("The selected account is unavailable or inactive in MSX.");
		const userId = await this.getCurrentUserId();
		const preferences = await this.preferenceStore.setVisibility(userId, accountId, visibility);
		this.portfolioPromise = void 0;
		const account = (await this.getPortfolio()).accounts.find((candidate) => candidate.id === accountId);
		return structuredClone(account ?? this.mapAccount(row, preferences, /* @__PURE__ */ new Set()));
	}
	async listOpportunities(accountId) {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.opportunities.filter((opportunity) => opportunity.accountId === accountId));
	}
	async listMilestones(opportunityId) {
		if (!(await this.getPortfolio()).opportunities.some((opportunity) => opportunity.id === opportunityId)) throw new Error("The opportunity is not in the signed-in user’s active MSX portfolio.");
		return this.mapMilestoneRows(opportunityId, await this.milestoneTeamMilestoneIds());
	}
	async listDiscoverableMilestones(opportunityId) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		return this.mapMilestoneRows(opportunityId, await this.milestoneTeamMilestoneIds());
	}
	async mapMilestoneRows(opportunityId, memberMilestoneIds) {
		return (await this.getMilestoneRows(opportunityId)).map((row) => ({
			id: row.msp_engagementmilestoneid,
			opportunityId,
			name: row.msp_name?.trim() || "Unnamed milestone",
			status: formattedValue(row, "msp_milestonestatus") ?? "Status not recorded",
			...row.msp_milestonedate ? { targetDate: row.msp_milestonedate.slice(0, 10) } : {},
			...typeof row.msp_monthlyuse === "number" ? { estimatedMonthlyUsage: row.msp_monthlyuse } : {},
			...formattedValue(row, "_ownerid_value") ? { owner: formattedValue(row, "_ownerid_value") } : {},
			...formattedValue(row, "msp_commitmentrecommendation") ? { commitment: formattedValue(row, "msp_commitmentrecommendation") } : {},
			...this.writeMetadata.riskDetailsField && typeof row[this.writeMetadata.riskDetailsField] === "string" ? { riskDetails: row[this.writeMetadata.riskDetailsField] } : {},
			...typeof row.msp_forecastcomments === "string" ? { comments: row.msp_forecastcomments } : {},
			onMilestoneTeam: memberMilestoneIds.has(row.msp_engagementmilestoneid)
		}));
	}
	/**
	* Milestone ids whose access team (the "Milestone Team" subgrid) currently includes the signed-in
	* user, read from the Dataverse `teams`/`teammembership` tables. Empty when the Milestone Team
	* access-team template is not set up in this environment.
	*/
	async milestoneTeamMemberships() {
		const templateId = await this.resolveMilestoneTeamTemplateId().catch(() => void 0);
		if (!templateId) return [];
		const userId = await this.getCurrentUserId();
		return unique((await this.requestAll("teams", {
			"$select": "_regardingobjectid_value",
			"$filter": `teamtype eq 1 and _teamtemplateid_value eq ${templateId} and teammembership_association/any(member:member/systemuserid eq ${userId})`
		})).map((team) => team._regardingobjectid_value).filter(isPresent)).map((milestoneId) => ({ milestoneId }));
	}
	/** The signed-in user's milestone-team milestone ids, read from MSX. */
	async milestoneTeamMilestoneIds() {
		return new Set((await this.milestoneTeamMemberships()).map((membership) => membership.milestoneId));
	}
	/**
	* Parent opportunity ids of the signed-in user's milestone-team memberships (for the portfolio
	* union), resolved from the member milestone rows.
	*/
	async milestoneTeamOpportunityIds() {
		const memberships = await this.milestoneTeamMemberships();
		if (memberships.length === 0) return [];
		return unique((await this.requestByIds("msp_engagementmilestones", "msp_engagementmilestoneid", unique(memberships.map((membership) => membership.milestoneId)), "msp_engagementmilestoneid,_msp_opportunityid_value")).map((row) => row._msp_opportunityid_value).filter(isPresent));
	}
	async updateMilestone(opportunityId, milestoneId, input) {
		const update = milestoneUpdateSchema.parse(input);
		const statusCode = update.status ? {
			...milestoneStatusCodes,
			...this.writeMetadata.milestoneStatusCodes
		}[milestoneStatusSchema.parse(update.status)] : void 0;
		if (update.status && statusCode === void 0) throw new Error(`The MSX option code for milestone status "${update.status}" is not configured.`);
		if (update.riskDetails !== void 0 && !this.writeMetadata.riskDetailsField) throw new Error("The MSX logical field name for Risk/Blocker Details is not configured.");
		await this.assertOpportunityAccess(opportunityId);
		if (!(await this.getMilestoneRows(opportunityId)).some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) throw new Error("The milestone is not in the selected opportunity.");
		await this.patch(`msp_engagementmilestones(${milestoneId})`, {
			...statusCode !== void 0 ? { msp_milestonestatus: statusCode } : {},
			...update.riskDetails !== void 0 ? { [this.writeMetadata.riskDetailsField]: update.riskDetails } : {},
			...update.targetDate ? { msp_milestonedate: update.targetDate } : {},
			...update.customerCommitment ? { msp_commitmentrecommendation: customerCommitmentCodes[customerCommitmentSchema.parse(update.customerCommitment)] } : {},
			...update.comments !== void 0 ? { msp_forecastcomments: update.comments } : {}
		});
		this.milestonePromises.delete(opportunityId);
		this.observationPromises.delete(opportunityId);
		const updated = (await this.listMilestones(opportunityId)).find((milestone) => milestone.id === milestoneId);
		if (!updated) throw new Error("MSX updated the milestone but it could not be reloaded.");
		return updated;
	}
	async updateOpportunity(opportunityId, input) {
		const update = opportunityUpdateSchema.parse(input);
		await this.assertOpportunityAccess(opportunityId);
		await this.patch(`opportunities(${opportunityId})`, { description: update.comments });
		this.portfolioPromise = void 0;
		const opportunity = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error("MSX updated the opportunity but it could not be reloaded.");
		return structuredClone(opportunity);
	}
	async updateOpportunityStage(opportunityId, targetStage, auditNote) {
		if (!Number.isInteger(targetStage) || targetStage < 1 || targetStage > 5) throw new Error("The target MCEM stage must be between 1 and 5.");
		const stageCode = this.writeMetadata.stageCodes?.[targetStage];
		if (stageCode === void 0) throw new Error(`Live MSX stage ${targetStage} writes require TLC_MSX_STAGE_${targetStage} to contain the tenant option code.`);
		await this.assertOpportunityAccess(opportunityId);
		const current = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId);
		if (!current) throw new Error("The opportunity is not in the signed-in user’s active MSX portfolio.");
		const description = [current.comments, auditNote].filter(Boolean).join("\n\n");
		await this.patch(`opportunities(${opportunityId})`, {
			msp_activesalesstage: stageCode,
			description
		});
		this.portfolioPromise = void 0;
		this.observationPromises.delete(opportunityId);
		const opportunity = (await this.getPortfolio()).opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error("MSX updated the stage but the opportunity could not be reloaded.");
		return structuredClone(opportunity);
	}
	async getOpportunityContext(opportunityId) {
		const portfolio = await this.getPortfolio();
		const opportunity = portfolio.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error("The opportunity is not in the signed-in user’s active MSX portfolio.");
		const account = portfolio.accounts.find((candidate) => candidate.id === opportunity.accountId);
		if (!account) throw new Error("MSX returned an opportunity without an accessible parent account.");
		const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
		const observations = await this.getOpportunityObservations(opportunity);
		return {
			account: structuredClone(account),
			opportunity: structuredClone(opportunity),
			observations: structuredClone(observations),
			retrievedAt,
			sourceHealth: {
				source: "msx",
				state: "live",
				detail: "Live MSX opportunity and engagement-milestone evidence scoped to the signed-in user’s active deal-team portfolio.",
				checkedAt: retrievedAt
			}
		};
	}
	async discoverOpportunities(domain) {
		const definition = getSeDomainDefinition(domain);
		const domainMatch = [definition.technicalCapabilityCodes.map((code) => `msp_technicalcapability eq ${code}`).join(" or "), definition.conversationCodes.map((code) => `msp_conversation eq ${code}`).join(" or ")].filter(Boolean).join(" or ");
		const domainClauses = domainMatch ? [`(${domainMatch})`] : [];
		const portfolio = await this.getPortfolio();
		const accountNameById = new Map(portfolio.accounts.filter((account) => account.visibility !== "hidden").map((account) => [account.id, account.name]));
		const assignedAccountIds = [...accountNameById.keys()];
		if (assignedAccountIds.length === 0) return [];
		const dealTeamOpportunityIds = new Set(portfolio.opportunities.map((opportunity) => opportunity.id));
		return (await measurePerformance("msx.discover-opportunities", this.performanceReporter, () => this.requestOpportunitiesForAccounts(assignedAccountIds, domainClauses))).filter((row) => row._parentaccountid_value && accountNameById.has(row._parentaccountid_value)).map((row) => {
			const accountName = accountNameById.get(row._parentaccountid_value) ?? formattedValue(row, "_parentaccountid_value");
			const solutionArea = formattedValue(row, "msp_solutionarea");
			const technicalCapability = formattedValue(row, "msp_technicalcapability");
			return {
				...this.mapOpportunity(row),
				domain,
				...accountName ? { accountName } : {},
				...solutionArea ? { solutionArea } : {},
				...technicalCapability ? { technicalCapability } : {},
				onDealTeam: dealTeamOpportunityIds.has(row.opportunityid)
			};
		}).sort((left, right) => left.name.localeCompare(right.name));
	}
	/** Fetches open opportunities within the given assigned accounts, filtered by the domain clauses. */
	async requestOpportunitiesForAccounts(accountIds, domainClauses) {
		const select = "opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description,msp_solutionarea,msp_technicalcapability,msp_conversation";
		const rows = [];
		for (let offset = 0; offset < accountIds.length; offset += 40) {
			const filterClauses = [
				"statecode eq 0",
				`(${accountIds.slice(offset, offset + 40).map((id) => `_parentaccountid_value eq ${id}`).join(" or ")})`,
				...domainClauses
			];
			rows.push(...await this.requestAll("opportunities", {
				"$select": select,
				"$filter": filterClauses.join(" and "),
				"$orderby": "name asc"
			}));
		}
		return rows;
	}
	async joinDealTeam(opportunityId) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		const dealTeam = {
			...defaultDealTeamWriteMetadata,
			...this.writeMetadata.dealTeam
		};
		const userId = await this.getCurrentUserId();
		if ((await this.requestAll(dealTeam.entitySet, {
			"$select": "msp_dealteamid",
			"$filter": `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
			"$top": "1"
		})).length > 0) {
			this.portfolioPromise = void 0;
			return {
				opportunityId,
				onDealTeam: true,
				alreadyMember: true
			};
		}
		const bindings = await this.resolveDealTeamBindings(dealTeam);
		await this.post(dealTeam.entitySet, {
			[`${bindings.userNavigationProperty}@odata.bind`]: `/systemusers(${userId})`,
			[`${bindings.opportunityNavigationProperty}@odata.bind`]: `/opportunities(${opportunityId})`
		});
		this.portfolioPromise = void 0;
		return {
			opportunityId,
			onDealTeam: true,
			alreadyMember: false
		};
	}
	async leaveDealTeam(opportunityId) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		const dealTeam = {
			...defaultDealTeamWriteMetadata,
			...this.writeMetadata.dealTeam
		};
		const userId = await this.getCurrentUserId();
		const existing = await this.requestAll(dealTeam.entitySet, {
			"$select": "msp_dealteamid",
			"$filter": `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
			"$top": "2"
		});
		if (existing.length === 0) {
			this.portfolioPromise = void 0;
			return {
				opportunityId,
				onDealTeam: false,
				alreadyAbsent: true
			};
		}
		if (existing.length > 1) throw new Error("MSX returned duplicate active Deal Team memberships for this user and opportunity. Resolve the duplicate rows before retrying.");
		const membershipId = existing[0]?.msp_dealteamid;
		if (!membershipId || !guidPattern.test(membershipId)) throw new Error("MSX returned a Deal Team membership without a valid row id.");
		await this.delete(`${dealTeam.entitySet}(${membershipId})`);
		this.portfolioPromise = void 0;
		this.observationPromises.delete(opportunityId);
		this.milestonePromises.delete(opportunityId);
		return {
			opportunityId,
			onDealTeam: false,
			alreadyAbsent: false
		};
	}
	async joinMilestoneTeam(opportunityId, milestoneId) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		if (!guidPattern.test(milestoneId)) throw new Error("The milestone id must be a valid MSX GUID.");
		if (!(await this.getMilestoneRows(opportunityId)).some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) throw new Error("The milestone is not in the selected opportunity.");
		const userId = await this.getCurrentUserId();
		const templateId = await this.resolveMilestoneTeamTemplateId();
		if (await this.isMilestoneTeamMember(milestoneId)) {
			this.invalidateMilestoneTeamCaches(opportunityId);
			return {
				opportunityId,
				milestoneId,
				onMilestoneTeam: true,
				alreadyMember: true
			};
		}
		await this.post(`systemusers(${userId})/Microsoft.Dynamics.CRM.AddUserToRecordTeam`, this.recordTeamActionBody(milestoneId, templateId));
		this.invalidateMilestoneTeamCaches(opportunityId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: true,
			alreadyMember: false
		};
	}
	async leaveMilestoneTeam(opportunityId, milestoneId) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		if (!guidPattern.test(milestoneId)) throw new Error("The milestone id must be a valid MSX GUID.");
		const userId = await this.getCurrentUserId();
		const templateId = await this.resolveMilestoneTeamTemplateId();
		if (!await this.isMilestoneTeamMember(milestoneId)) {
			this.invalidateMilestoneTeamCaches(opportunityId);
			return {
				opportunityId,
				milestoneId,
				onMilestoneTeam: false,
				alreadyAbsent: true
			};
		}
		await this.post(`systemusers(${userId})/Microsoft.Dynamics.CRM.RemoveUserFromRecordTeam`, this.recordTeamActionBody(milestoneId, templateId));
		this.invalidateMilestoneTeamCaches(opportunityId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: false,
			alreadyAbsent: false
		};
	}
	async listMilestoneActivities(opportunityId, milestoneId) {
		if (!guidPattern.test(milestoneId)) throw new Error("The milestone id must be a valid MSX GUID.");
		const categoryField = this.writeMetadata.taskCategoryField;
		return (await this.requestAll("tasks", {
			"$select": [
				"activityid",
				"subject",
				"statecode",
				"prioritycode",
				"scheduledend",
				"actualdurationminutes",
				"description",
				"_ownerid_value",
				"createdon",
				"_createdby_value",
				categoryField
			].filter(isPresent).join(","),
			"$filter": `_regardingobjectid_value eq ${milestoneId}`,
			"$orderby": "createdon desc"
		})).map((row) => this.toMilestoneActivity(row, opportunityId, milestoneId));
	}
	async createMilestoneActivity(opportunityId, milestoneId, input) {
		if (!guidPattern.test(opportunityId)) throw new Error("The opportunity id must be a valid MSX GUID.");
		if (!guidPattern.test(milestoneId)) throw new Error("The milestone id must be a valid MSX GUID.");
		const request = createMilestoneActivityRequestSchema.parse(input);
		if (!(await this.getMilestoneRows(opportunityId)).some((milestone) => milestone.msp_engagementmilestoneid === milestoneId)) throw new Error("The milestone is not in the selected opportunity.");
		const userId = await this.getCurrentUserId();
		const categoryField = this.writeMetadata.taskCategoryField;
		const categoryCode = request.taskCategory ? this.writeMetadata.taskCategoryCodes?.[request.taskCategory] : void 0;
		const body = {
			subject: request.subject,
			prioritycode: taskPriorityCodes[request.priority],
			"regardingobjectid_msp_engagementmilestone@odata.bind": `/msp_engagementmilestones(${milestoneId})`,
			"ownerid@odata.bind": `/systemusers(${userId})`,
			...request.description !== void 0 ? { description: request.description } : {},
			...request.due ? { scheduledend: request.due } : {},
			...request.durationMinutes !== void 0 ? { actualdurationminutes: request.durationMinutes } : {},
			...categoryField && categoryCode !== void 0 ? { [categoryField]: categoryCode } : {}
		};
		const created = await this.postReturningEntity("tasks", body);
		return this.toMilestoneActivity(created, opportunityId, milestoneId);
	}
	toMilestoneActivity(row, opportunityId, milestoneId) {
		const categoryField = this.writeMetadata.taskCategoryField;
		const priority = typeof row.prioritycode === "number" ? taskPriorityByCode[row.prioritycode] : void 0;
		const category = categoryField ? formattedValue(row, categoryField) : void 0;
		return {
			id: row.activityid,
			milestoneId,
			opportunityId,
			subject: row.subject?.trim() || "Untitled task",
			activityType: "task",
			status: typeof row.statecode === "number" ? taskStatusByState[row.statecode] ?? "Open" : "Open",
			...priority ? { priority } : {},
			...category ? { taskCategory: category } : {},
			...row.scheduledend ? { due: row.scheduledend.slice(0, 10) } : {},
			...typeof row.actualdurationminutes === "number" ? { durationMinutes: row.actualdurationminutes } : {},
			...typeof row.description === "string" && row.description.length > 0 ? { description: row.description } : {},
			...formattedValue(row, "_ownerid_value") ? { owner: formattedValue(row, "_ownerid_value") } : {},
			...formattedValue(row, "_createdby_value") ? { createdBy: formattedValue(row, "_createdby_value") } : {},
			...row.createdon ? { createdOn: row.createdon } : {}
		};
	}
	resolveMilestoneTeamTemplateId() {
		const configured = resolveMilestoneTeamAccessMetadata(this.writeMetadata.milestoneTeam);
		if (configured.templateId && guidPattern.test(configured.templateId)) return Promise.resolve(configured.templateId);
		this.milestoneTeamTemplateIdPromise ??= this.discoverMilestoneTeamTemplateId(configured.templateName).catch((error) => {
			this.milestoneTeamTemplateIdPromise = void 0;
			throw error;
		});
		return this.milestoneTeamTemplateIdPromise;
	}
	/** Finds the "Milestone Team" access-team template id by name (cached for the connector's lifetime). */
	async discoverMilestoneTeamTemplateId(templateName) {
		const rows = await this.requestAll("teamtemplates", {
			"$select": "teamtemplateid,teamtemplatename",
			"$filter": `teamtemplatename eq '${escapeODataStringLiteral(templateName)}'`,
			"$top": "2"
		});
		if (rows.length > 1) throw new Error(`MSX has multiple access-team templates named "${templateName}". Set TLC_MSX_MILESTONE_TEAM_TEMPLATE_ID to the correct team template id.`);
		const templateId = rows[0]?.teamtemplateid;
		if (typeof templateId !== "string" || !guidPattern.test(templateId)) throw new Error(MILESTONE_TEAM_NOT_CONFIGURED_MESSAGE);
		return templateId;
	}
	/**
	* True when the milestone's access team currently includes the signed-in user. Uses the same
	* membership read as `onMilestoneTeam` (the all-teams query that only `$select`s
	* `_regardingobjectid_value`) rather than a per-record `_regardingobjectid_value` **filter**, which
	* Dataverse does not reliably support on the polymorphic `team.regardingobjectid` lookup. This also
	* keeps the join/leave decision consistent with what the UI shows.
	*/
	async isMilestoneTeamMember(milestoneId) {
		return (await this.milestoneTeamMilestoneIds()).has(milestoneId);
	}
	/** Body for the AddUserToRecordTeam / RemoveUserFromRecordTeam bound actions. */
	recordTeamActionBody(milestoneId, templateId) {
		return {
			Record: {
				"@odata.type": "Microsoft.Dynamics.CRM.msp_engagementmilestone",
				msp_engagementmilestoneid: milestoneId
			},
			TeamTemplate: {
				"@odata.type": "Microsoft.Dynamics.CRM.teamtemplate",
				teamtemplateid: templateId
			}
		};
	}
	invalidateMilestoneTeamCaches(opportunityId) {
		this.portfolioPromise = void 0;
		this.observationPromises.delete(opportunityId);
		this.milestonePromises.delete(opportunityId);
	}
	resolveDealTeamBindings(dealTeam) {
		if (dealTeam.userNavigationProperty && dealTeam.opportunityNavigationProperty) return Promise.resolve({
			userNavigationProperty: dealTeam.userNavigationProperty,
			opportunityNavigationProperty: dealTeam.opportunityNavigationProperty
		});
		this.dealTeamBindingsPromise ??= this.discoverDealTeamBindings(dealTeam).catch((error) => {
			this.dealTeamBindingsPromise = void 0;
			throw error;
		});
		return this.dealTeamBindingsPromise;
	}
	async discoverDealTeamBindings(dealTeam) {
		const userAttribute = lookupAttributeName(dealTeam.userLookupField);
		const opportunityAttribute = lookupAttributeName(dealTeam.opportunityLookupField);
		const fallback = {
			userNavigationProperty: dealTeam.userNavigationProperty ?? userAttribute,
			opportunityNavigationProperty: dealTeam.opportunityNavigationProperty ?? opportunityAttribute
		};
		try {
			const relationships = await this.requestAll(`EntityDefinitions(LogicalName='${dealTeam.logicalName}')/ManyToOneRelationships`, { "$select": "ReferencingAttribute,ReferencingEntityNavigationPropertyName" });
			const userNav = relationships.find((row) => row.ReferencingAttribute === userAttribute)?.ReferencingEntityNavigationPropertyName;
			const opportunityNav = relationships.find((row) => row.ReferencingAttribute === opportunityAttribute)?.ReferencingEntityNavigationPropertyName;
			return {
				userNavigationProperty: dealTeam.userNavigationProperty ?? userNav ?? fallback.userNavigationProperty,
				opportunityNavigationProperty: dealTeam.opportunityNavigationProperty ?? opportunityNav ?? fallback.opportunityNavigationProperty
			};
		} catch {
			return fallback;
		}
	}
	refresh() {
		this.portfolioPromise = void 0;
		this.observationPromises.clear();
		this.milestonePromises.clear();
		this.currentUserIdPromise = void 0;
	}
	/** Returns the signed-in user's Dataverse systemuser id (WhoAmI UserId), cached for reuse. */
	getCurrentUserId() {
		this.currentUserIdPromise ??= this.requestJson("WhoAmI").then((identity) => identity.UserId).catch((error) => {
			this.currentUserIdPromise = void 0;
			throw error;
		});
		return this.currentUserIdPromise;
	}
	async assertOpportunityAccess(opportunityId) {
		if (!(await this.getPortfolio()).opportunities.some((opportunity) => opportunity.id === opportunityId)) throw new Error("The opportunity is not in the signed-in user’s active MSX portfolio.");
	}
	getOpportunityObservations(opportunity) {
		let observations = this.observationPromises.get(opportunity.id);
		if (!observations) {
			observations = measurePerformance("msx.opportunity-evidence", this.performanceReporter, async () => {
				return mapOpportunityObservations(opportunity, await this.getMilestoneRows(opportunity.id));
			}).catch((error) => {
				this.observationPromises.delete(opportunity.id);
				throw error;
			});
			this.observationPromises.set(opportunity.id, observations);
		}
		return observations;
	}
	getMilestoneRows(opportunityId) {
		let milestones = this.milestonePromises.get(opportunityId);
		if (!milestones) {
			milestones = this.requestAll("msp_engagementmilestones", {
				"$select": [
					"msp_engagementmilestoneid",
					"msp_name",
					"_ownerid_value",
					"msp_milestonedate",
					"msp_milestonestatus",
					"msp_commitmentrecommendation",
					"msp_monthlyuse",
					"msp_forecastcomments",
					this.writeMetadata.riskDetailsField
				].filter(Boolean).join(","),
				"$filter": `statecode eq 0 and _msp_opportunityid_value eq ${opportunityId}`,
				"$orderby": "msp_milestonedate asc"
			}).catch((error) => {
				this.milestonePromises.delete(opportunityId);
				throw error;
			});
			this.milestonePromises.set(opportunityId, milestones);
		}
		return milestones;
	}
	getPortfolio() {
		this.portfolioPromise ??= this.loadPortfolio().catch((error) => {
			this.portfolioPromise = void 0;
			throw error;
		});
		return this.portfolioPromise;
	}
	async loadPortfolio() {
		const userId = await measurePerformance("msx.identity", this.performanceReporter, () => this.getCurrentUserId());
		const preferences = await this.preferenceStore.read(userId);
		const dealTeamRows = await measurePerformance("msx.deal-team", this.performanceReporter, () => this.requestAll("msp_dealteams", {
			"$select": "_msp_parentopportunityid_value",
			"$filter": `statecode eq 0 and _msp_dealteamuserid_value eq ${userId}`
		}));
		const milestoneOpportunityIds = await this.milestoneTeamOpportunityIds();
		const opportunityIds = unique([...dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent), ...milestoneOpportunityIds]);
		const activeOpportunities = (await measurePerformance("msx.opportunities", this.performanceReporter, () => this.requestByIds("opportunities", "opportunityid", opportunityIds, "opportunityid,statecode,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description"))).filter((row) => row._parentaccountid_value && (row.statecode === void 0 || row.statecode === 0));
		const dealTeamAccountIds = unique(activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent));
		const accountIds = unique([
			...dealTeamAccountIds,
			...preferences.manualAccountIds,
			...preferences.hiddenAccountIds
		]);
		const accounts = (await measurePerformance("msx.accounts", this.performanceReporter, () => this.requestByIds("accounts", "accountid", accountIds, [
			"accountid",
			"name",
			this.writeMetadata.accountTpidField
		].filter(isPresent).join(",")))).map((row) => this.mapAccount(row, preferences, new Set(dealTeamAccountIds))).sort((left, right) => left.name.localeCompare(right.name));
		const visibleAccountIds = new Set(accounts.filter((account) => account.visibility !== "hidden").map((account) => account.id));
		return {
			accounts,
			opportunities: activeOpportunities.filter((row) => row._parentaccountid_value && visibleAccountIds.has(row._parentaccountid_value)).map((row) => this.mapOpportunity(row)).sort((left, right) => left.name.localeCompare(right.name))
		};
	}
	mapAccount(row, preferences = {
		manualAccountIds: [],
		hiddenAccountIds: [],
		revision: 0
	}, dealTeamAccountIds = /* @__PURE__ */ new Set()) {
		const manual = preferences.manualAccountIds.includes(row.accountid);
		const dealTeam = dealTeamAccountIds.has(row.accountid);
		const tpidField = this.writeMetadata.accountTpidField;
		const tpid = tpidField && typeof row[tpidField] === "string" ? row[tpidField].trim() : void 0;
		return {
			id: row.accountid,
			name: row.name,
			segment: "Live MSX",
			...tpid ? { tpid } : {},
			...manual || dealTeam ? { provenance: manual && dealTeam ? "both" : manual ? "manual" : "deal-team" } : {},
			visibility: preferences.hiddenAccountIds.includes(row.accountid) ? "hidden" : "visible"
		};
	}
	assertAccountId(accountId) {
		if (!guidPattern.test(accountId)) throw new Error("The account id must be a valid MSX GUID.");
	}
	mapOpportunity(row) {
		const formattedStage = row[`msp_activesalesstage${formattedValueSuffix}`];
		const parsedStage = typeof formattedStage === "string" ? Number.parseInt(formattedStage.match(/[1-5]/)?.[0] ?? "", 10) : NaN;
		const numericStage = row.msp_activesalesstage;
		const recordedStage = Number.isInteger(parsedStage) ? parsedStage : numericStage && numericStage >= 1 && numericStage <= 5 ? numericStage : 1;
		const closeDate = row.msp_estcompletiondate ?? row.estimatedclosedate;
		return {
			id: row.opportunityid,
			accountId: row._parentaccountid_value,
			name: row.name,
			...formattedValue(row, "_ownerid_value") ? { owner: formattedValue(row, "_ownerid_value") } : {},
			recordedStage,
			value: row.estimatedvalue || row.msp_consumptionconsumedrecurring || 0,
			currency: "USD",
			closeDate: closeDate?.slice(0, 10) ?? "1970-01-01",
			...typeof row.description === "string" ? { comments: row.description } : {}
		};
	}
	async requestByIds(entitySet, idField, ids, select) {
		const rows = [];
		for (let offset = 0; offset < ids.length; offset += 40) {
			const idFilter = ids.slice(offset, offset + 40).map((id) => `${idField} eq ${id}`).join(" or ");
			rows.push(...await this.requestAll(entitySet, {
				"$select": select,
				"$filter": `statecode eq 0 and (${idFilter})`
			}));
		}
		return rows;
	}
	async requestAll(entitySet, parameters) {
		const firstUrl = new URL(entitySet, this.baseUrl);
		for (const [name, value] of Object.entries(parameters)) firstUrl.searchParams.set(name, value);
		const rows = [];
		let nextUrl = firstUrl;
		while (nextUrl) {
			this.assertTrustedUrl(nextUrl);
			const page = await this.requestJson(nextUrl);
			rows.push(...page.value);
			nextUrl = page["@odata.nextLink"] ? new URL(page["@odata.nextLink"]) : void 0;
		}
		return rows;
	}
	async requestJson(pathOrUrl) {
		const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, this.baseUrl);
		this.assertTrustedUrl(url);
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, { headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			Prefer: "odata.include-annotations=\"OData.Community.Display.V1.FormattedValue\",odata.maxpagesize=500"
		} });
		if (!response.ok) throw new MsxRequestError(`MSX request failed with status ${response.status}.`, response.status);
		return await response.json();
	}
	async patch(path, body) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"Content-Type": "application/json",
				"If-Match": "*"
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new MsxRequestError(`MSX update failed with status ${response.status}.`, response.status);
	}
	async post(path, body) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new MsxRequestError(`MSX create failed with status ${response.status}.`, response.status);
	}
	/** POSTs and returns the created row (via `Prefer: return=representation`). */
	async postReturningEntity(path, body) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "POST",
			headers: {
				Authorization: ["Bearer", accessToken].join(" "),
				Accept: "application/json",
				"Content-Type": "application/json",
				Prefer: "return=representation"
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new MsxRequestError(`MSX create failed with status ${response.status}.`, response.status);
		return await response.json();
	}
	async delete(path) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "DELETE",
			headers: {
				Authorization: ["Bearer", accessToken].join(" "),
				Accept: "application/json",
				"If-Match": "*"
			}
		});
		if (!response.ok) throw new MsxRequestError(`MSX delete failed with status ${response.status}.`, response.status);
	}
	assertTrustedUrl(url) {
		if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) throw new MsxRequestError("MSX returned an untrusted continuation URL.");
	}
};
function unique(values) {
	return [...new Set(values)];
}
function isPresent(value) {
	return Boolean(value);
}
function formattedValue(row, field) {
	const value = row[`${field}${formattedValueSuffix}`];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function escapeODataStringLiteral(value) {
	return value.replaceAll("'", "''");
}
function mapOpportunityObservations(opportunity, milestones) {
	const observations = [];
	const value = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: opportunity.currency,
		maximumFractionDigits: 0
	}).format(opportunity.value);
	const datedMilestone = milestones.find((milestone) => milestone.msp_milestonedate);
	if (opportunity.recordedStage === 1) {
		if (opportunity.value > 0) observations.push({
			criterionId: "budget",
			status: "partial",
			detail: `MSX records ${value} of opportunity value, but this does not confirm available customer funding.`
		});
		if (datedMilestone) observations.push({
			criterionId: "timing",
			status: "partial",
			detail: `MSX milestone “${datedMilestone.msp_name ?? "Unnamed milestone"}” is dated ${datedMilestone.msp_milestonedate.slice(0, 10)}, but the complete decision and implementation timeline is not recorded.`
		});
		if (milestones.some((milestone) => milestone.msp_commitmentrecommendation === 861980003)) observations.push({
			criterionId: "approval",
			status: "partial",
			detail: "MSX contains a committed milestone recommendation, but that internal signal does not establish the customer approval path."
		});
		return observations;
	}
	if (opportunity.value > 0 || milestones.some((milestone) => (milestone.msp_monthlyuse ?? 0) !== 0)) observations.push({
		criterionId: "business-case",
		status: "partial",
		detail: `MSX records a financial signal (${value} opportunity value), but expected return, customer priority, and budget validation remain incomplete.`
	});
	if (milestones.length > 0) observations.push({
		criterionId: "customer-outcome",
		status: "partial",
		detail: `MSX contains ${milestones.length} engagement milestone${milestones.length === 1 ? "" : "s"}; confirm that each is tied to a measurable customer outcome and review rhythm.`
	});
	const completedValidation = milestones.find((milestone) => milestone.msp_milestonestatus === 861980003 && /architecture|demo|pilot|poc|technical|validation|workshop/i.test(milestone.msp_name ?? ""));
	if (completedValidation) observations.push({
		criterionId: "technical-validation",
		status: "met",
		detail: `Completed MSX milestone “${completedValidation.msp_name ?? "Technical validation"}” provides recorded validation evidence.`
	});
	const activeMilestone = milestones.find((milestone) => ![
		861980003,
		861980004,
		861980007
	].includes(milestone.msp_milestonestatus ?? -1));
	if (activeMilestone) {
		const hasDate = Boolean(activeMilestone.msp_milestonedate);
		const hasOwner = Boolean(activeMilestone._ownerid_value);
		observations.push({
			criterionId: "next-step",
			status: hasDate && hasOwner ? "met" : "partial",
			detail: hasDate && hasOwner ? `MSX milestone “${activeMilestone.msp_name ?? "Unnamed milestone"}” has a named owner and date ${activeMilestone.msp_milestonedate.slice(0, 10)}.` : `MSX milestone “${activeMilestone.msp_name ?? "Unnamed milestone"}” is active but is missing ${hasDate ? "a named owner" : hasOwner ? "a date" : "a date and named owner"}.`
		});
	}
	return observations;
}
//#endregion
//#region packages/agents/meeting-signal-extractor/src/index.ts
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
/** Canonical field dictionary. The extractor may only propose fields listed here. */
var MEETING_FIELD_DICTIONARY = {
	budgetAmount: {
		canonical: "budgetAmount",
		label: "Budget amount",
		targetKind: "opportunity",
		msxField: "budget_amount",
		valueType: "money",
		mcemCriterion: "business-case",
		sensitive: false
	},
	budgetStatus: {
		canonical: "budgetStatus",
		label: "Budget confirmed",
		targetKind: "opportunity",
		msxField: "budget_status",
		valueType: "optionset",
		optionLabels: ["Yes", "No"],
		mcemCriterion: "business-case",
		sensitive: false
	},
	estimatedValue: {
		canonical: "estimatedValue",
		label: "Estimated value",
		targetKind: "opportunity",
		msxField: "estimated_value",
		valueType: "money",
		mcemCriterion: "business-case",
		sensitive: true
	},
	timeline: {
		canonical: "timeline",
		label: "Purchase timeline",
		targetKind: "opportunity",
		msxField: "timeline",
		valueType: "optionset",
		optionLabels: [
			"Immediate",
			"This Quarter",
			"Next Quarter",
			"This Year",
			"Not known"
		],
		mcemCriterion: "next-step",
		sensitive: false
	},
	purchaseProcess: {
		canonical: "purchaseProcess",
		label: "Decision process",
		targetKind: "opportunity",
		msxField: "purchase_process",
		valueType: "optionset",
		optionLabels: [
			"Individual",
			"Committee",
			"Unknown"
		],
		mcemCriterion: "decision-team",
		sensitive: false
	},
	decisionMaker: {
		canonical: "decisionMaker",
		label: "Decision maker identified",
		targetKind: "opportunity",
		msxField: "decision_maker",
		valueType: "boolean",
		mcemCriterion: "decision-team",
		sensitive: false
	},
	need: {
		canonical: "need",
		label: "Customer need level",
		targetKind: "opportunity",
		msxField: "need",
		valueType: "optionset",
		optionLabels: [
			"Must have",
			"Should have",
			"Good to have",
			"No need"
		],
		mcemCriterion: "customer-outcome",
		sensitive: false
	},
	customerNeed: {
		canonical: "customerNeed",
		label: "Customer need",
		targetKind: "opportunity",
		msxField: "customer_need",
		valueType: "text",
		mcemCriterion: "customer-outcome",
		sensitive: false,
		fillOnlyWhenEmpty: true
	},
	proposedSolution: {
		canonical: "proposedSolution",
		label: "Proposed solution",
		targetKind: "opportunity",
		msxField: "proposed_solution",
		valueType: "text",
		mcemCriterion: "technical-validation",
		sensitive: false,
		fillOnlyWhenEmpty: true
	},
	finalDecisionDate: {
		canonical: "finalDecisionDate",
		label: "Final decision date",
		targetKind: "opportunity",
		msxField: "final_decision_date",
		valueType: "date",
		mcemCriterion: "next-step",
		sensitive: false
	},
	identifyCompetitors: {
		canonical: "identifyCompetitors",
		label: "Competitors identified",
		targetKind: "opportunity",
		msxField: "identify_competitors",
		valueType: "boolean",
		mcemCriterion: "risk",
		sensitive: false
	},
	opportunityRating: {
		canonical: "opportunityRating",
		label: "Opportunity sentiment",
		targetKind: "opportunity",
		msxField: "opportunity_rating",
		valueType: "optionset",
		optionLabels: [
			"Hot",
			"Warm",
			"Cold"
		],
		mcemCriterion: "sentiment",
		sensitive: false
	},
	qualificationComments: {
		canonical: "qualificationComments",
		label: "Qualification note",
		targetKind: "opportunity",
		msxField: "qualification_comments",
		valueType: "text",
		mcemCriterion: "risk",
		sensitive: false,
		internalOnly: true,
		append: true
	},
	milestoneCommitment: {
		canonical: "milestoneCommitment",
		label: "Milestone commitment",
		targetKind: "milestone",
		msxField: "commitment",
		valueType: "optionset",
		optionLabels: ["Uncommitted", "Committed"],
		mcemCriterion: "next-step",
		sensitive: false
	},
	milestoneRisk: {
		canonical: "milestoneRisk",
		label: "Milestone risk",
		targetKind: "milestone",
		msxField: "risk_details",
		valueType: "text",
		mcemCriterion: "risk",
		sensitive: false,
		internalOnly: true,
		append: true
	}
};
var KNOWN_COMPETITORS = [
	"AWS",
	"Amazon Web Services",
	"Google Cloud",
	"GCP",
	"Snowflake",
	"Databricks",
	"Palo Alto",
	"Oracle",
	"IBM",
	"SAP",
	"ServiceNow"
];
/** Parse "$900,000", "900 thousand", "900k", "4 million", "4m", "2.5 million" to a number. */
function parseMoney(text) {
	const match = text.match(/\$?\s*([\d][\d,]*\.?\d*)\s*(million|mil|m|k|thousand)?\b/i);
	if (!match) return null;
	const amountRaw = match[1];
	if (amountRaw === void 0) return null;
	const base = Number(amountRaw.replace(/,/g, ""));
	if (!Number.isFinite(base)) return null;
	const unit = (match[2] ?? "").toLowerCase();
	if (unit === "million" || unit === "mil" || unit === "m") return Math.round(base * 1e6);
	if (unit === "thousand" || unit === "k") return Math.round(base * 1e3);
	return Math.round(base);
}
function matchTimeline(text) {
	if (/\bnext quarter\b/i.test(text)) return "Next Quarter";
	if (/\bthis quarter\b/i.test(text)) return "This Quarter";
	if (/\bthis (fiscal )?year\b/i.test(text)) return "This Year";
	if (/\b(immediately|right away|asap|as soon as possible)\b/i.test(text)) return "Immediate";
	return null;
}
function matchProcess(text) {
	if (/\b(committee|steering (group|committee)|board approv)/i.test(text)) return "Committee";
	if (/\b(sole decision|single decision[- ]maker|i will decide|i decide)\b/i.test(text)) return "Individual";
	return null;
}
function matchNeed(text) {
	if (/\bmust[- ]have\b|\bcritical\b|\bessential\b|\bnon-negotiable\b/i.test(text)) return "Must have";
	if (/\bshould[- ]have\b/i.test(text)) return "Should have";
	if (/\b(good to have|nice to have)\b/i.test(text)) return "Good to have";
	return null;
}
function matchSentiment(text) {
	if (/\b(excited|thrilled|love it|great fit|strong fit|very positive)\b/i.test(text)) return "Hot";
	if (/\b(concerned|worried|frustrated|hesitant|skeptical|not convinced)\b/i.test(text)) return "Cold";
	return null;
}
function findCompetitor(text) {
	for (const name of KNOWN_COMPETITORS) if (new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(text)) return name;
	return null;
}
var NEW_MILESTONE_PATTERNS = [
	{
		re: /\bproof of value\b|\bpov\b/i,
		name: "Proof of value"
	},
	{
		re: /\bproof of concept\b|\bpoc\b/i,
		name: "Proof of concept"
	},
	{
		re: /\bpilot\b/i,
		name: "Pilot"
	},
	{
		re: /\bworkshop\b/i,
		name: "Workshop"
	},
	{
		re: /\b(architecture|design) review\b/i,
		name: "Architecture review"
	}
];
function formatMoney(value) {
	return `$${value.toLocaleString("en-US")}`;
}
function displayValue(valueType, value) {
	if (value === null || value === void 0 || value === "") return "(empty)";
	if (valueType === "money" && typeof value === "number") return formatMoney(value);
	if (valueType === "boolean") return value ? "Yes" : "No";
	return String(value);
}
function valuesEqual(valueType, before, after) {
	if (valueType === "money") return Number(before) === Number(after);
	if (valueType === "boolean") return Boolean(before) === Boolean(after);
	return String(before ?? "").trim() === String(after ?? "").trim();
}
/** Deterministically extract MCEM signals from a transcript into a change-set proposal. */
function extractMeetingSignals(ctx, options = {}) {
	const candidates = [];
	const competitorNotes = [];
	const newMilestones = [];
	const unmappedSignals = [];
	const seenMilestoneNames = new Set(ctx.milestones.map((m) => m.name.toLowerCase()));
	for (const seg of ctx.transcript.segments) {
		const internal = seg.speakerRole === "internal";
		const text = seg.text;
		if (/\b(budget|spend|sign[- ]?off|approved to (buy|spend)|commit)\b/i.test(text)) {
			const amount = parseMoney(text);
			if (amount !== null) {
				candidates.push({
					canonical: "budgetAmount",
					after: amount,
					confidence: .82,
					evidence: [seg.segmentId],
					rationale: `Customer stated a budget of ${formatMoney(amount)}.`
				});
				if (/\b(approved|sign[- ]?off|commit|secured|allocated)\b/i.test(text)) candidates.push({
					canonical: "budgetStatus",
					after: "Yes",
					confidence: .8,
					evidence: [seg.segmentId],
					rationale: "Customer confirmed budget is approved."
				});
			}
		}
		const timeline = matchTimeline(text);
		if (timeline) candidates.push({
			canonical: "timeline",
			after: timeline,
			confidence: .75,
			evidence: [seg.segmentId],
			rationale: `Customer indicated a "${timeline}" buying timeline.`
		});
		const process = matchProcess(text);
		if (process) candidates.push({
			canonical: "purchaseProcess",
			after: process,
			confidence: .76,
			evidence: [seg.segmentId],
			rationale: `Decision process described as "${process}".`
		});
		const need = matchNeed(text);
		if (need) candidates.push({
			canonical: "need",
			after: need,
			confidence: .72,
			evidence: [seg.segmentId],
			rationale: `Customer framed the need as "${need}".`
		});
		const sentiment = matchSentiment(text);
		if (sentiment) candidates.push({
			canonical: "opportunityRating",
			after: sentiment,
			confidence: .45,
			evidence: [seg.segmentId],
			rationale: `Tone suggests a "${sentiment}" sentiment.`
		});
		const competitor = findCompetitor(text);
		if (competitor) {
			competitorNotes.push({
				name: competitor,
				segmentId: seg.segmentId,
				internal
			});
			candidates.push({
				canonical: "identifyCompetitors",
				after: true,
				confidence: .78,
				evidence: [seg.segmentId],
				rationale: `Competitor mentioned: ${competitor}.`
			});
		}
		for (const pattern of NEW_MILESTONE_PATTERNS) if (pattern.re.test(text) && !seenMilestoneNames.has(pattern.name.toLowerCase())) {
			seenMilestoneNames.add(pattern.name.toLowerCase());
			newMilestones.push({
				tempId: `new-ms-${newMilestones.length + 1}`,
				name: pattern.name,
				confidence: internal ? .68 : .6,
				checkedByDefault: false,
				evidence: [seg.segmentId]
			});
		}
	}
	const internalCompetitors = competitorNotes.filter((c) => c.internal);
	if (internalCompetitors.length > 0) {
		const names = [...new Set(internalCompetitors.map((c) => c.name))].join(", ");
		candidates.push({
			canonical: "qualificationComments",
			after: `Competitive: evaluating against ${names}.`,
			confidence: .7,
			evidence: internalCompetitors.map((c) => c.segmentId),
			rationale: `Internal note: competing against ${names}.`
		});
		unmappedSignals.push({
			label: "Competitor mentioned",
			text: `Evaluating against ${names}.`,
			mcemCriterion: "risk",
			evidence: internalCompetitors.map((c) => c.segmentId)
		});
	}
	return assembleProposal(ctx, {
		candidates,
		newMilestones,
		unmappedSignals
	}, options);
}
/**
* Deterministically turns detected signals into a validated change-set proposal. Shared by the
* rule-based matcher and the Foundry model path so every guardrail (dictionary-only fields,
* option-set coercion, no-op drop, before/after from the live snapshot, sensitive gating) is
* enforced in code regardless of how the signals were detected.
*/
function assembleProposal(ctx, signals, options = {}) {
	const now = options.now ? options.now() : /* @__PURE__ */ new Date();
	const changeSetId = options.changeSetId ?? `cs-${ctx.transcript.id}`;
	const bestByKey = /* @__PURE__ */ new Map();
	for (const candidate of signals.candidates) {
		const entry = MEETING_FIELD_DICTIONARY[candidate.canonical];
		if (!entry) continue;
		const key = `${candidate.canonical}:${entry.targetKind === "milestone" ? candidate.targetRecordId ?? "" : ctx.opportunity.id}`;
		const existing = bestByKey.get(key);
		if (!existing || candidate.confidence > existing.confidence) bestByKey.set(key, candidate);
	}
	const slots = [];
	for (const cand of bestByKey.values()) {
		const entry = MEETING_FIELD_DICTIONARY[cand.canonical];
		if (!entry) continue;
		const isMilestone = entry.targetKind === "milestone";
		const targetRecordId = isMilestone ? cand.targetRecordId : ctx.opportunity.id;
		if (!targetRecordId) continue;
		const snapshotFields = isMilestone ? ctx.milestones.find((milestone) => milestone.id === targetRecordId)?.fields : ctx.opportunity.fields;
		if (!snapshotFields) continue;
		if (entry.internalOnly && cand.evidence.length === 0) continue;
		const before = snapshotFields[cand.canonical];
		if (entry.append) {
			if (String(before ?? "").toLowerCase().includes(String(cand.after).toLowerCase())) continue;
		} else if (entry.fillOnlyWhenEmpty) {
			if (before !== null && before !== void 0 && String(before).trim() !== "") continue;
		} else if (valuesEqual(entry.valueType, before, cand.after)) continue;
		if (entry.optionLabels && entry.valueType === "optionset" && !entry.optionLabels.includes(String(cand.after))) continue;
		const confidence = Math.max(0, Math.min(1, cand.confidence));
		const blocked = entry.sensitive && confidence < .9;
		const checkedByDefault = confidence >= .7 && !entry.sensitive && !blocked;
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
			...blocked ? { blockedReason: "Sensitive field requires manual confirmation." } : {},
			sensitive: entry.sensitive,
			rationale: cand.rationale,
			evidence: cand.evidence
		});
	}
	const suggestedMilestoneIds = [...new Set(slots.filter((slot) => slot.targetKind === "milestone" && slot.targetRecordId).map((slot) => slot.targetRecordId))];
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
	};
	return meetingChangeSetProposalSchema.parse(proposal);
}
//#endregion
//#region packages/connectors/msx/index.ts
var accounts = [
	{
		id: "account-contoso",
		name: "Contoso Energy",
		segment: "Strategic",
		tpid: "1000001"
	},
	{
		id: "account-fabrikam",
		name: "Fabrikam Retail",
		segment: "Enterprise",
		tpid: "1000002"
	},
	{
		id: "account-northwind",
		name: "Northwind Health",
		segment: "Enterprise",
		tpid: "1000003"
	},
	{
		id: "account-zava",
		name: "Zava Inc.",
		segment: "Strategic",
		tpid: "1000004"
	},
	{
		id: "account-adventureworks",
		name: "Adventure Works Cycles",
		segment: "Enterprise",
		tpid: "1000005"
	}
];
var opportunities = [
	{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		name: "Grid operations modernization",
		owner: "Avery Johnson",
		recordedStage: 3,
		value: 42e5,
		currency: "USD",
		closeDate: "2026-10-30"
	},
	{
		id: "opp-ai-service",
		accountId: "account-fabrikam",
		name: "AI-assisted customer service",
		recordedStage: 2,
		value: 175e4,
		currency: "USD",
		closeDate: "2026-12-18"
	},
	{
		id: "opp-cloud-security-readiness",
		accountId: "account-contoso",
		name: "Cloud security readiness",
		recordedStage: 1,
		value: 9e5,
		currency: "USD",
		closeDate: "2027-02-26"
	},
	{
		id: "opp-data-estate-consolidation",
		accountId: "account-contoso",
		name: "Data estate consolidation",
		recordedStage: 2,
		value: 265e4,
		currency: "USD",
		closeDate: "2027-01-29"
	},
	{
		id: "opp-ai-factory-rollout",
		accountId: "account-contoso",
		name: "AI factory rollout",
		recordedStage: 4,
		value: 61e5,
		currency: "USD",
		closeDate: "2026-11-20"
	},
	{
		id: "opp-store-modernization",
		accountId: "account-fabrikam",
		name: "Connected store modernization",
		recordedStage: 1,
		value: 12e5,
		currency: "USD",
		closeDate: "2027-03-19"
	},
	{
		id: "opp-unified-commerce",
		accountId: "account-fabrikam",
		name: "Unified commerce platform",
		recordedStage: 3,
		value: 38e5,
		currency: "USD",
		closeDate: "2026-12-11"
	},
	{
		id: "opp-copilot-expansion",
		accountId: "account-fabrikam",
		name: "Store associate Copilot expansion",
		recordedStage: 4,
		value: 24e5,
		currency: "USD",
		closeDate: "2026-10-23"
	},
	{
		id: "opp-resilient-cloud-foundation",
		accountId: "account-contoso",
		name: "Resilient cloud foundation - ready to advance",
		recordedStage: 1,
		value: 145e4,
		currency: "USD",
		closeDate: "2027-03-12"
	},
	{
		id: "opp-predictive-maintenance-scale",
		accountId: "account-contoso",
		name: "Predictive maintenance scale-out - ready to advance",
		recordedStage: 3,
		value: 475e4,
		currency: "USD",
		closeDate: "2026-12-04"
	},
	{
		id: "opp-customer-data-platform",
		accountId: "account-fabrikam",
		name: "Customer data platform - ready to advance",
		recordedStage: 2,
		value: 32e5,
		currency: "USD",
		closeDate: "2027-01-15"
	},
	{
		id: "opp-ai-store-operations",
		accountId: "account-fabrikam",
		name: "AI store operations deployment - ready to advance",
		recordedStage: 4,
		value: 525e4,
		currency: "USD",
		closeDate: "2026-11-13"
	},
	{
		id: "opp-zava-ai-platform",
		accountId: "account-zava",
		name: "Zava AI platform foundation",
		owner: "Avery Johnson",
		recordedStage: 2,
		value: 29e5,
		currency: "USD",
		closeDate: "2027-04-02"
	},
	{
		id: "opp-zava-migration",
		accountId: "account-zava",
		name: "Zava datacenter exit",
		recordedStage: 1,
		value: 16e5,
		currency: "USD",
		closeDate: "2027-05-28"
	},
	{
		id: "opp-aw-commerce",
		accountId: "account-adventureworks",
		name: "Adventure Works commerce replatform",
		owner: "Morgan Diaz",
		recordedStage: 3,
		value: 31e5,
		currency: "USD",
		closeDate: "2027-01-08"
	}
];
var milestonesByOpportunity = Object.fromEntries(opportunities.map((opportunity) => [opportunity.id, [{
	id: `${opportunity.id}-milestone`,
	opportunityId: opportunity.id,
	name: "Customer outcome validation",
	status: "In progress",
	targetDate: opportunity.closeDate,
	owner: "Account team",
	commitment: "Best case"
}]]));
var observationsByOpportunity = {
	"opp-grid-modernization": [
		{
			criterionId: "customer-outcome",
			status: "partial",
			detail: "Reliability improvement is named but has no baseline or target."
		},
		{
			criterionId: "decision-team",
			status: "missing",
			detail: "Economic buyer and procurement path are not recorded."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "Architecture workshop completed with the customer platform team."
		},
		{
			criterionId: "business-case",
			status: "missing",
			detail: "No quantified value hypothesis is attached to the opportunity."
		},
		{
			criterionId: "next-step",
			status: "partial",
			detail: "A workshop is proposed without a confirmed customer date."
		}
	],
	"opp-ai-service": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Target is a 15% reduction in average handling time."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "Business sponsor is known; security stakeholder is not confirmed."
		},
		{
			criterionId: "technical-validation",
			status: "missing",
			detail: "No technical discovery artifact is recorded."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "Value hypothesis exists but has not been validated by finance."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "Discovery workshop is confirmed for September 3."
		}
	],
	"opp-cloud-security-readiness": [
		{
			criterionId: "budget",
			status: "met",
			detail: "The security program has approved discovery funding for the current fiscal year."
		},
		{
			criterionId: "customer-outcome",
			status: "partial",
			detail: "Reducing critical cloud findings is the stated outcome, but the baseline and target are not recorded."
		},
		{
			criterionId: "approval",
			status: "missing",
			detail: "The executive sponsor and security approval path have not been confirmed."
		},
		{
			criterionId: "timing",
			status: "met",
			detail: "The customer must select a remediation approach before its February audit window."
		}
	],
	"opp-data-estate-consolidation": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer targets a 25% reduction in data-platform operating cost."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "The data and infrastructure leads are engaged; the economic buyer is not confirmed."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "Discovery documented the current estate, migration constraints, and candidate landing zones."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "A cost model exists but excludes migration and change-management costs."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "A design review is scheduled with named customer and Microsoft owners."
		}
	],
	"opp-ai-factory-rollout": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Three production use cases have agreed adoption and cycle-time targets."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "The executive sponsor, AI council, security approver, procurement lead, and delivery team are engaged."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "The pilot met its quality, safety, latency, and integration acceptance criteria."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance validated the investment case and phased funding envelope."
		},
		{
			criterionId: "next-step",
			status: "partial",
			detail: "The rollout plan is approved, but the first production deployment date has not been committed."
		}
	],
	"opp-store-modernization": [
		{
			criterionId: "budget",
			status: "partial",
			detail: "Innovation funding is available for a pilot, but rollout funding has not been identified."
		},
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer wants to reduce checkout abandonment by 10% and improve inventory accuracy."
		},
		{
			criterionId: "approval",
			status: "met",
			detail: "The retail operations sponsor and technology decision makers are identified."
		},
		{
			criterionId: "timing",
			status: "missing",
			detail: "No decision date, purchase window, or compelling event is recorded."
		}
	],
	"opp-unified-commerce": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The program has measurable revenue, conversion, and order-fulfillment outcomes."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Commerce, finance, security, procurement, and executive stakeholders are mapped."
		},
		{
			criterionId: "technical-validation",
			status: "partial",
			detail: "Core integration patterns are validated; peak-volume testing remains open."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "The customer approved a quantified business case and funding range."
		},
		{
			criterionId: "next-step",
			status: "partial",
			detail: "A validation workshop is planned, but customer attendees are not final."
		}
	],
	"opp-copilot-expansion": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The expansion targets a 20% reduction in associate task time across 300 stores."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Retail operations, HR, security, finance, and deployment owners approved the expansion path."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "The production pilot met groundedness, adoption, and support acceptance criteria."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "Benefits are validated, but the support-cost assumption needs finance confirmation."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "Wave-one deployment has named owners and a committed October start date."
		}
	],
	"opp-resilient-cloud-foundation": [
		{
			criterionId: "budget",
			status: "met",
			detail: "The customer has confirmed funding for discovery, design, and initial implementation."
		},
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Recovery-time, availability, and operational-efficiency targets have agreed baselines and owners."
		},
		{
			criterionId: "approval",
			status: "met",
			detail: "The executive sponsor, economic buyer, architecture authority, and procurement path are confirmed."
		},
		{
			criterionId: "timing",
			status: "met",
			detail: "The customer has committed to a November decision ahead of its data-center renewal event."
		}
	],
	"opp-predictive-maintenance-scale": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer approved targets for unplanned downtime, maintenance cost, and asset availability."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Operations, finance, security, procurement, and executive stakeholders are aligned."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "The pilot met model-quality, integration, security, and field-operations acceptance criteria."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance validated the scale-out business case using measured pilot outcomes."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "A customer-approved deployment decision meeting has named attendees, owners, and a committed date."
		}
	],
	"opp-customer-data-platform": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer agreed measurable conversion, campaign-cycle, and data-quality outcomes."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Marketing, data, privacy, security, finance, and procurement decision makers are engaged."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "Discovery confirmed source systems, identity resolution, consent, and integration requirements."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "The expected return and implementation budget are documented and customer validated."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The solution-design workshop is confirmed with customer and Microsoft owners."
		}
	],
	"opp-ai-store-operations": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer approved labor-efficiency, task-completion, and associate-adoption targets."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Retail operations, HR, security, finance, legal, and deployment owners approved the path."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "The production pilot met quality, safety, accessibility, support, and integration criteria."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance approved the deployment business case and full rollout funding."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The first deployment wave has a customer-approved date, scope, and accountable owners."
		}
	],
	"opp-zava-ai-platform": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer agreed targets for model-deployment velocity and governed AI adoption."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "The platform sponsor is engaged, but procurement and security owners are not yet confirmed."
		},
		{
			criterionId: "technical-validation",
			status: "partial",
			detail: "A reference architecture is drafted; a customer validation workshop is not yet booked."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "A value hypothesis exists without an approved quantified business case."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "A foundation design review is scheduled with named owners."
		}
	],
	"opp-zava-migration": [
		{
			criterionId: "customer-outcome",
			status: "partial",
			detail: "Datacenter exit is the stated goal, but cost and timeline baselines are not recorded."
		},
		{
			criterionId: "decision-team",
			status: "missing",
			detail: "The economic buyer and migration owner are not yet identified."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "An initial migration assessment of the on-premises estate is complete."
		},
		{
			criterionId: "business-case",
			status: "missing",
			detail: "No quantified migration business case is attached to the opportunity."
		},
		{
			criterionId: "next-step",
			status: "partial",
			detail: "A migration planning session is proposed without a confirmed customer date."
		}
	],
	"opp-aw-commerce": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer targets fewer peak-season outages and faster checkout performance."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "The economic buyer, engineering lead, and procurement path are engaged."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "An approved proof of concept validated the AKS microservices approach."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "A draft business case exists; final finance approval is pending."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "A replatform design and delivery plan has a customer-approved date and owners."
		}
	]
};
var discoverableOpportunities = [
	{
		id: "opp-discover-hybrid-networking",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Hybrid networking modernization",
		recordedStage: 2,
		value: 185e4,
		currency: "USD",
		closeDate: "2027-02-12",
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Advanced Networking",
		onDealTeam: false
	},
	{
		id: "opp-discover-vmware-migration",
		accountId: "account-fabrikam",
		accountName: "Fabrikam Retail",
		name: "Datacenter exit to Azure VMware Solution",
		recordedStage: 1,
		value: 295e4,
		currency: "USD",
		closeDate: "2027-04-02",
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure VMware Solutions",
		onDealTeam: false
	},
	{
		id: "opp-discover-synapse-analytics",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Enterprise analytics on Synapse and Power BI",
		recordedStage: 2,
		value: 21e5,
		currency: "USD",
		closeDate: "2027-01-22",
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "New Analytics with Synapse & PowerBI",
		onDealTeam: false
	},
	{
		id: "opp-discover-sql-managed-instance",
		accountId: "account-fabrikam",
		accountName: "Fabrikam Retail",
		name: "SQL Server migration to Azure SQL MI",
		recordedStage: 3,
		value: 165e4,
		currency: "USD",
		closeDate: "2026-12-19",
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "SQL Server Migration to Azure SQL MI",
		onDealTeam: false
	},
	{
		id: "opp-discover-azure-ai-ml",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Azure AI and ML platform adoption",
		recordedStage: 2,
		value: 34e5,
		currency: "USD",
		closeDate: "2027-02-05",
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure AI and ML",
		onDealTeam: false
	},
	{
		id: "opp-discover-cloud-native-apps",
		accountId: "account-fabrikam",
		accountName: "Fabrikam Retail",
		name: "Cloud-native apps on AKS and Cosmos DB",
		recordedStage: 1,
		value: 275e4,
		currency: "USD",
		closeDate: "2027-03-27",
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB",
		onDealTeam: false
	},
	{
		id: "opp-discover-zero-trust",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Zero Trust security modernization",
		recordedStage: 2,
		value: 22e5,
		currency: "USD",
		closeDate: "2027-02-18",
		domain: "security",
		solutionArea: "Security",
		technicalCapability: "Threat Protection",
		onDealTeam: false
	},
	{
		id: "opp-discover-teams-calling",
		accountId: "account-fabrikam",
		accountName: "Fabrikam Retail",
		name: "Teams Phone and calling rollout",
		recordedStage: 1,
		value: 98e4,
		currency: "USD",
		closeDate: "2027-03-05",
		domain: "modern-work",
		technicalCapability: "Calling",
		onDealTeam: false
	},
	{
		id: "opp-discover-d365-customer-service",
		accountId: "account-fabrikam",
		accountName: "Fabrikam Retail",
		name: "Dynamics 365 Customer Service transformation",
		recordedStage: 2,
		value: 175e4,
		currency: "USD",
		closeDate: "2027-01-28",
		domain: "biz-apps",
		solutionArea: "AI Business Solutions",
		technicalCapability: "Customer Service",
		onDealTeam: false
	},
	{
		id: "opp-discover-surface-deployment",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Surface device deployment and management",
		recordedStage: 1,
		value: 64e4,
		currency: "USD",
		closeDate: "2027-04-15",
		domain: "devices",
		solutionArea: "Windows and Devices",
		technicalCapability: "Surface & Partner Devices",
		onDealTeam: false
	},
	{
		id: "opp-discover-cloud-advisory",
		accountId: "account-contoso",
		accountName: "Contoso Energy",
		name: "Cloud advisory and adoption services",
		recordedStage: 2,
		value: 85e4,
		currency: "USD",
		closeDate: "2027-02-22",
		domain: "services",
		solutionArea: "Microsoft Services",
		technicalCapability: "Advisory Services",
		onDealTeam: false
	},
	{
		id: "opp-discover-northwind-data",
		accountId: "account-northwind",
		accountName: "Northwind Health",
		name: "Clinical data platform modernization",
		recordedStage: 1,
		value: 21e5,
		currency: "USD",
		closeDate: "2027-05-20",
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Analytics",
		onDealTeam: false
	}
];
var discoverableMilestonesByOpportunity = Object.fromEntries(discoverableOpportunities.map((opportunity) => [opportunity.id, [{
	id: `${opportunity.id}-milestone`,
	opportunityId: opportunity.id,
	name: "Customer outcome validation",
	status: "On Track",
	targetDate: opportunity.closeDate,
	owner: "Account team",
	commitment: "Best case"
}]]));
var FixtureMsxConnector = class {
	opportunities = structuredClone(opportunities);
	milestonesByOpportunity = structuredClone(milestonesByOpportunity);
	discoverableMilestonesByOpportunity = structuredClone(discoverableMilestonesByOpportunity);
	discoverable = structuredClone(discoverableOpportunities);
	dealTeamOpportunityIds = new Set(this.opportunities.map((opportunity) => opportunity.id));
	milestoneTeamIds = new Set(this.opportunities.filter((_opportunity, index) => index % 2 === 0).flatMap((opportunity) => (this.milestonesByOpportunity[opportunity.id] ?? []).map((milestone) => milestone.id)));
	manualAccountIds = /* @__PURE__ */ new Set();
	hiddenAccountIds = /* @__PURE__ */ new Set();
	activitiesByMilestone = { "opp-grid-modernization-milestone": [{
		id: "act-grid-ms-1",
		milestoneId: "opp-grid-modernization-milestone",
		opportunityId: "opp-grid-modernization",
		subject: "Architecture design session",
		activityType: "task",
		status: "Open",
		priority: "Normal",
		taskCategory: "Architecture Design Session",
		due: "2026-10-20",
		owner: "Account team",
		createdBy: "Account team"
	}] };
	activitySequence = 0;
	/** Opportunity ids in the portfolio: Deal Team membership OR milestone-team membership. */
	portfolioOpportunityIds() {
		const ids = new Set(this.dealTeamOpportunityIds);
		for (const [opportunityId, milestones] of Object.entries(this.milestonesByOpportunity)) if (milestones.some((milestone) => this.milestoneTeamIds.has(milestone.id))) ids.add(opportunityId);
		return ids;
	}
	/**
	* Promotes a discoverable opportunity into the portfolio pool (without Deal Team membership) so
	* that milestone-team membership can place it in the portfolio union. Idempotent.
	*/
	promoteDiscoverableOpportunity(opportunityId) {
		if (this.opportunities.some((candidate) => candidate.id === opportunityId)) return;
		const seed = this.discoverable.find((candidate) => candidate.id === opportunityId);
		if (!seed) return;
		const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed;
		this.opportunities.push(structuredClone(opportunity));
		this.milestonesByOpportunity[opportunityId] = structuredClone(this.discoverableMilestonesByOpportunity[opportunityId] ?? []);
	}
	async listAccounts(options = {}) {
		const portfolioIds = this.portfolioOpportunityIds();
		const portfolioAccountIds = new Set(this.opportunities.filter((opportunity) => portfolioIds.has(opportunity.id)).map((opportunity) => opportunity.accountId));
		return accounts.filter((account) => portfolioAccountIds.has(account.id) || this.manualAccountIds.has(account.id) || this.hiddenAccountIds.has(account.id)).map((account) => this.mapAccount(account, portfolioAccountIds)).filter((account) => options.includeHidden || account.visibility !== "hidden").map((account) => structuredClone(account));
	}
	async searchAccounts(input) {
		const request = accountSearchRequestSchema.parse(input);
		const query = request.query.toLocaleLowerCase();
		const visibleAccounts = await this.listAccounts({ includeHidden: true });
		const visibleById = new Map(visibleAccounts.map((account) => [account.id, account]));
		return accounts.filter((account) => request.matchBy === "name" ? account.name.toLocaleLowerCase().includes(query) : account.tpid === request.query).map((account) => {
			const existing = visibleById.get(account.id);
			return {
				...existing ?? account,
				state: existing?.visibility === "hidden" ? "hidden" : existing ? "visible" : "not-added"
			};
		});
	}
	async addAccount(accountId) {
		if (!accounts.find((candidate) => candidate.id === accountId)) throw new Error(`Unknown sample account: ${accountId}`);
		this.manualAccountIds.add(accountId);
		const added = (await this.listAccounts({ includeHidden: true })).find((candidate) => candidate.id === accountId);
		if (!added) throw new Error("The sample account could not be added.");
		return added;
	}
	async setAccountVisibility(accountId, visibility) {
		const account = accounts.find((candidate) => candidate.id === accountId);
		if (!account) throw new Error(`Unknown sample account: ${accountId}`);
		if (visibility === "hidden") this.hiddenAccountIds.add(accountId);
		else this.hiddenAccountIds.delete(accountId);
		const portfolioAccountIds = new Set(this.opportunities.filter((opportunity) => this.portfolioOpportunityIds().has(opportunity.id)).map((opportunity) => opportunity.accountId));
		return structuredClone(this.mapAccount(account, portfolioAccountIds));
	}
	async listOpportunities(accountId) {
		if (this.hiddenAccountIds.has(accountId)) return [];
		const portfolioIds = this.portfolioOpportunityIds();
		return structuredClone(this.opportunities.filter((opportunity) => opportunity.accountId === accountId && portfolioIds.has(opportunity.id)));
	}
	async listMilestones(opportunityId) {
		this.assertOpportunityAccess(opportunityId);
		return structuredClone(this.milestonesByOpportunity[opportunityId] ?? []).map((milestone) => ({
			...milestone,
			onMilestoneTeam: this.milestoneTeamIds.has(milestone.id)
		}));
	}
	async updateMilestone(opportunityId, milestoneId, update) {
		this.assertOpportunityAccess(opportunityId);
		const milestone = this.milestonesByOpportunity[opportunityId]?.find((candidate) => candidate.id === milestoneId);
		if (!milestone) throw new Error(`Unknown sample milestone: ${milestoneId}`);
		if (update.status !== void 0) milestone.status = update.status;
		if (update.targetDate !== void 0) milestone.targetDate = update.targetDate;
		if (update.customerCommitment !== void 0) milestone.commitment = update.customerCommitment;
		if (update.riskDetails !== void 0) milestone.riskDetails = update.riskDetails;
		if (update.comments !== void 0) milestone.comments = update.comments;
		return structuredClone(milestone);
	}
	async updateOpportunity(opportunityId, update) {
		this.assertOpportunityAccess(opportunityId);
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		opportunity.comments = update.comments;
		return structuredClone(opportunity);
	}
	async updateOpportunityStage(opportunityId, targetStage, auditNote) {
		this.assertOpportunityAccess(opportunityId);
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		opportunity.recordedStage = targetStage;
		opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join("\n\n");
		return structuredClone(opportunity);
	}
	async getOpportunityContext(opportunityId) {
		this.assertOpportunityAccess(opportunityId);
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		const account = accounts.find((candidate) => candidate.id === opportunity.accountId);
		if (!account) throw new Error(`Missing account for sample opportunity: ${opportunityId}`);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			account: structuredClone(account),
			opportunity: structuredClone(opportunity),
			observations: structuredClone(observationsByOpportunity[opportunityId] ?? []),
			retrievedAt: now,
			sourceHealth: {
				source: "msx",
				state: "sample",
				detail: "Sanitized fixture data; no live MSX call was made.",
				checkedAt: now
			}
		};
	}
	async discoverOpportunities(domain) {
		const visibleAccountIds = new Set((await this.listAccounts()).map((account) => account.id));
		return this.discoverable.filter((opportunity) => opportunity.domain === domain && visibleAccountIds.has(opportunity.accountId)).map((opportunity) => structuredClone({
			...opportunity,
			onDealTeam: this.dealTeamOpportunityIds.has(opportunity.id)
		}));
	}
	async joinDealTeam(opportunityId) {
		const seed = this.discoverable.find((candidate) => candidate.id === opportunityId);
		if (!seed) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		const alreadyMember = this.dealTeamOpportunityIds.has(opportunityId);
		if (!alreadyMember) {
			this.dealTeamOpportunityIds.add(opportunityId);
			const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed;
			if (!this.opportunities.some((candidate) => candidate.id === opportunityId)) this.opportunities.push(structuredClone(opportunity));
		}
		return {
			opportunityId,
			onDealTeam: true,
			alreadyMember
		};
	}
	async leaveDealTeam(opportunityId) {
		const alreadyAbsent = !this.dealTeamOpportunityIds.has(opportunityId);
		this.dealTeamOpportunityIds.delete(opportunityId);
		return {
			opportunityId,
			onDealTeam: false,
			alreadyAbsent
		};
	}
	async joinMilestoneTeam(opportunityId, milestoneId) {
		if (!(this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])?.find((candidate) => candidate.id === milestoneId)) throw new Error(`Unknown sample milestone: ${milestoneId}`);
		this.promoteDiscoverableOpportunity(opportunityId);
		const alreadyMember = this.milestoneTeamIds.has(milestoneId);
		this.milestoneTeamIds.add(milestoneId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: true,
			alreadyMember
		};
	}
	async leaveMilestoneTeam(opportunityId, milestoneId) {
		if (!(this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])?.find((candidate) => candidate.id === milestoneId)) throw new Error(`Unknown sample milestone: ${milestoneId}`);
		const alreadyAbsent = !this.milestoneTeamIds.has(milestoneId);
		this.milestoneTeamIds.delete(milestoneId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: false,
			alreadyAbsent
		};
	}
	async listDiscoverableMilestones(opportunityId) {
		const milestones = this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId];
		if (!milestones) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		return structuredClone(milestones).map((milestone) => ({
			...milestone,
			onMilestoneTeam: this.milestoneTeamIds.has(milestone.id)
		}));
	}
	assertSampleMilestone(opportunityId, milestoneId) {
		if (!(this.milestonesByOpportunity[opportunityId] ?? this.discoverableMilestonesByOpportunity[opportunityId])?.find((candidate) => candidate.id === milestoneId)) throw new Error(`Unknown sample milestone: ${milestoneId}`);
	}
	async listMilestoneActivities(opportunityId, milestoneId) {
		this.assertSampleMilestone(opportunityId, milestoneId);
		return structuredClone(this.activitiesByMilestone[milestoneId] ?? []);
	}
	async createMilestoneActivity(opportunityId, milestoneId, input) {
		this.assertSampleMilestone(opportunityId, milestoneId);
		const request = createMilestoneActivityRequestSchema.parse(input);
		const activity = {
			id: `act-sample-${++this.activitySequence}`,
			milestoneId,
			opportunityId,
			subject: request.subject,
			activityType: "task",
			status: "Open",
			priority: request.priority,
			owner: "Account team",
			createdBy: "Account team",
			createdOn: (/* @__PURE__ */ new Date()).toISOString(),
			...request.taskCategory ? { taskCategory: request.taskCategory } : {},
			...request.due ? { due: request.due } : {},
			...request.durationMinutes !== void 0 ? { durationMinutes: request.durationMinutes } : {},
			...request.description ? { description: request.description } : {}
		};
		this.activitiesByMilestone[milestoneId] = [activity, ...this.activitiesByMilestone[milestoneId] ?? []];
		return structuredClone(activity);
	}
	assertOpportunityAccess(opportunityId) {
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity || !this.portfolioOpportunityIds().has(opportunityId) || this.hiddenAccountIds.has(opportunity.accountId)) throw new Error("The opportunity is not in the active sample portfolio.");
	}
	mapAccount(account, dealTeamAccountIds) {
		const manual = this.manualAccountIds.has(account.id);
		const dealTeam = dealTeamAccountIds.has(account.id);
		return {
			...account,
			provenance: manual && dealTeam ? "both" : manual ? "manual" : "deal-team",
			visibility: this.hiddenAccountIds.has(account.id) ? "hidden" : "visible"
		};
	}
};
//#endregion
//#region packages/connectors/local-store/schema.ts
/**
* SQLite DDL for the local test-data store. This mirrors the MSX / Dataverse
* Opportunity + Engagement Milestone shape (and the MCEM decision-team / risk
* tables) closely enough to exercise meeting-signal extraction and injection.
*
* Single source of truth for the schema; see docs/MeetingCapture.md §G9.
* Verified option-set codes come from a live Dataverse `describe`.
*/
var LOCAL_STORE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE account (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  segment     TEXT,
  tpid        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'visible'
);

CREATE TABLE systemuser (
  id        TEXT PRIMARY KEY,
  fullname  TEXT NOT NULL,
  initials  TEXT NOT NULL,
  email     TEXT,
  alias     TEXT
);

CREATE TABLE opportunity (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES account(id),
  name                     TEXT NOT NULL,
  owner_id                 TEXT REFERENCES systemuser(id),
  recorded_stage           INTEGER NOT NULL,
  estimated_value          REAL NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  estimated_close_date     TEXT NOT NULL,
  description              TEXT,
  -- Tier A (existing MSX columns)
  est_completion_date      TEXT,
  consumption_recurring    REAL,
  solution_area            TEXT,
  technical_capability     TEXT,
  -- Tier B (standard D365 — verified live)
  budget_amount            REAL,
  budget_status            INTEGER,     -- budgetstatus: Yes 1 / No 0
  purchase_timeframe       INTEGER,     -- purchasetimeframe: Q1 0..Next FY 4
  timeline                 INTEGER,     -- timeline: Immediate 0..Not known 4
  purchase_process         INTEGER,     -- purchaseprocess: Individual 0 / Committee 1 / Unknown 2
  decision_maker           INTEGER,     -- bit
  need                     INTEGER,     -- Must have 0..No need 3
  customer_need            TEXT,
  customer_pain_points     TEXT,
  current_situation        TEXT,
  proposed_solution        TEXT,
  final_decision_date      TEXT,
  identify_competitors     INTEGER,     -- bit
  identify_customer_contacts INTEGER,   -- bit
  close_probability        INTEGER,
  opportunity_rating       INTEGER,     -- Hot 1 / Warm 2 / Cold 3
  qualification_comments   TEXT,
  primary_competitor_id    TEXT REFERENCES competitor(id),
  other_competitor         TEXT,
  forecast_category        INTEGER
);

CREATE TABLE engagement_milestone (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL REFERENCES opportunity(id),
  name              TEXT NOT NULL,
  status            INTEGER NOT NULL,   -- On Track 861980000..Hygiene/Duplicate 861980006
  milestone_date    TEXT,
  owner_id          TEXT REFERENCES systemuser(id),
  commitment        INTEGER,            -- Uncommitted 861980000 / Committed 861980003
  monthly_use       REAL,
  risk_details      TEXT,
  forecast_comments TEXT,
  conversation      TEXT,
  customer_budget_approved INTEGER      -- Yes 606820000 / No 606820001
);

CREATE TABLE contact (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  job_title  TEXT,
  email      TEXT,
  account_id TEXT REFERENCES account(id)
);

CREATE TABLE competitor (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE stakeholder (
  id                 TEXT PRIMARY KEY,
  opportunity_id     TEXT REFERENCES opportunity(id),
  name               TEXT NOT NULL,
  contact_id         TEXT REFERENCES contact(id),
  job_role           TEXT,
  role_optionset     INTEGER,  -- Executive Sponsor 861980000..Local Exec Sponsor 861980004
  stakeholder_role   INTEGER,  -- Champion 606820000..Ratifier 606820004
  relationship_level INTEGER,  -- Strong 606820000..None 606820003
  linkedin_url       TEXT
);

CREATE TABLE opportunity_dealteam (
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  systemuser_id  TEXT NOT NULL REFERENCES systemuser(id),
  PRIMARY KEY (opportunity_id, systemuser_id)
);

CREATE TABLE milestone_team_member (        -- app-owned milestone-team membership (independent of deal team)
  milestone_id   TEXT NOT NULL REFERENCES engagement_milestone(id),
  systemuser_id  TEXT NOT NULL REFERENCES systemuser(id),
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  PRIMARY KEY (milestone_id, systemuser_id)
);

CREATE TABLE milestone_activity (           -- Activity (Task) regarding a milestone (MSX: task.regardingobjectid)
  id               TEXT PRIMARY KEY,
  milestone_id     TEXT NOT NULL REFERENCES engagement_milestone(id),
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  subject          TEXT NOT NULL,
  activity_type    TEXT NOT NULL DEFAULT 'task',
  status           TEXT NOT NULL DEFAULT 'Open',   -- Open / Completed / Canceled
  priority         TEXT,                           -- Low / Normal / High
  task_category    TEXT,
  due              TEXT,
  duration_minutes INTEGER,
  description      TEXT,
  owner_id         TEXT REFERENCES systemuser(id),
  created_by       TEXT REFERENCES systemuser(id),
  created_on       TEXT
);

CREATE TABLE discoverable_opportunity (     -- SE-domain discovery catalog ("Add me" candidates)
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES account(id),
  name                 TEXT NOT NULL,
  recorded_stage       INTEGER NOT NULL,
  value                REAL NOT NULL DEFAULT 0,
  currency             TEXT NOT NULL DEFAULT 'USD',
  close_date           TEXT NOT NULL,
  domain               TEXT NOT NULL,       -- infra|data|ai-apps|security|modern-work|biz-apps|devices|services
  solution_area        TEXT,
  technical_capability TEXT
);

CREATE TABLE activity (                       -- MSX: activitypointer / appointment (the meeting itself)
  id                     TEXT PRIMARY KEY,     -- MSX: activityid
  opportunity_id         TEXT REFERENCES opportunity(id),   -- MSX: regardingobjectid (opportunity)
  subject                TEXT NOT NULL,        -- MSX: subject
  owner_id               TEXT REFERENCES systemuser(id),    -- MSX: ownerid
  activity_type          TEXT,                 -- MSX: activitytypecode ('appointment','phonecall','task')
  scheduled_start        TEXT,                 -- MSX: scheduledstart (ISO)
  scheduled_end          TEXT,                 -- MSX: scheduledend  (ISO; the "due date" WF-007/WF-010 read)
  status                 INTEGER,              -- MSX: statecode (Open 0, Completed 1, Canceled 2, Scheduled 3)
  is_online_meeting      INTEGER,              -- MSX: isonlinemeeting (bit)
  online_meeting_join_url TEXT,                -- MSX: onlinemeetingjoinurl
  location               TEXT,                 -- MSX: location
  description            TEXT                  -- MSX: description
);

CREATE TABLE option_value (
  option_set TEXT NOT NULL,
  code       INTEGER NOT NULL,
  label      TEXT NOT NULL,
  PRIMARY KEY (option_set, code)
);

-- Test aids (not in MSX) ---------------------------------------------------
CREATE TABLE comment_entry (
  id         TEXT PRIMARY KEY,
  entity     TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  author_id  TEXT REFERENCES systemuser(id),
  initials   TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE transcript (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  activity_id    TEXT REFERENCES activity(id),   -- links the transcript to the meeting record
  meeting_type   TEXT NOT NULL,
  title          TEXT,
  source         TEXT,
  occurred_at    TEXT NOT NULL
);

CREATE TABLE transcript_segment (
  id            TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcript(id),
  start_ms      INTEGER,
  end_ms        INTEGER,
  speaker       TEXT,
  speaker_role  TEXT,
  text          TEXT NOT NULL
);

CREATE INDEX idx_opportunity_account ON opportunity(account_id);
CREATE INDEX idx_milestone_opportunity ON engagement_milestone(opportunity_id);
CREATE INDEX idx_stakeholder_opportunity ON stakeholder(opportunity_id);
CREATE INDEX idx_dealteam_user ON opportunity_dealteam(systemuser_id);
CREATE INDEX idx_milestoneteam_user ON milestone_team_member(systemuser_id);
CREATE INDEX idx_milestone_activity_milestone ON milestone_activity(milestone_id);
CREATE INDEX idx_activity_opportunity ON activity(opportunity_id);
CREATE INDEX idx_transcript_opportunity ON transcript(opportunity_id);
`;
//#endregion
//#region packages/connectors/local-store/seed.ts
/**
* Canonical seed data for the local test-data store (sanitized; no real customer data).
* Covers accounts incl. Zava + Adventure Works, opportunities across MCEM stages 1-5,
* milestones across every pipeline status + both commitments, and the MCEM
* decision-team / risk tables (stakeholder / contact / competitor) so meeting-signal
* extraction and injection can be tested end to end.
*/
/** Verified live Dataverse option-set codes (code ↔ label). */
var MILESTONE_STATUS = {
	86198e4: "On Track",
	861980001: "At Risk",
	861980002: "Blocked",
	861980003: "Completed",
	861980004: "Cancelled",
	861980005: "Lost to Competitor",
	861980006: "Hygiene/Duplicate"
};
var COMMITMENT = {
	86198e4: "Uncommitted",
	861980003: "Committed"
};
var BUDGET_STATUS = {
	1: "Yes",
	0: "No"
};
var TIMELINE = {
	0: "Immediate",
	1: "This Quarter",
	2: "Next Quarter",
	3: "This Year",
	4: "Not known"
};
var PURCHASE_PROCESS = {
	0: "Individual",
	1: "Committee",
	2: "Unknown"
};
var NEED = {
	0: "Must have",
	1: "Should have",
	2: "Good to have",
	3: "No need"
};
var OPPORTUNITY_RATING = {
	1: "Hot",
	2: "Warm",
	3: "Cold"
};
var STAKEHOLDER_ROLE_OPTIONSET = {
	86198e4: "Executive Sponsor",
	861980001: "SLT Sponsor",
	861980002: "Technical Sponsor",
	861980003: "Initiative / Deal Sponsor",
	861980004: "Local Exec Sponsor"
};
var STAKEHOLDER_ROLE = {
	60682e4: "Champion",
	606820001: "Influencer",
	606820002: "Decision Maker",
	606820003: "User",
	606820004: "Ratifier"
};
var RELATIONSHIP_LEVEL = {
	60682e4: "Strong",
	606820001: "Developing",
	606820002: "Weak",
	606820003: "None"
};
/** The signed-in sample user (owner + comment initials source). */
var SAMPLE_USER_ID = "user-girish";
var seedAccounts = [
	{
		id: "account-contoso",
		name: "Contoso Energy",
		segment: "Strategic",
		tpid: "1000001",
		visibility: "visible"
	},
	{
		id: "account-fabrikam",
		name: "Fabrikam Retail",
		segment: "Enterprise",
		tpid: "1000002",
		visibility: "visible"
	},
	{
		id: "account-northwind",
		name: "Northwind Health",
		segment: "Enterprise",
		tpid: "1000003",
		visibility: "visible"
	},
	{
		id: "account-zava",
		name: "Zava Inc.",
		segment: "Strategic",
		tpid: "1000004",
		visibility: "visible"
	},
	{
		id: "account-adventureworks",
		name: "Adventure Works Cycles",
		segment: "Enterprise",
		tpid: "1000005",
		visibility: "visible"
	}
];
var seedSystemUsers = [
	{
		id: SAMPLE_USER_ID,
		fullname: "Girish Pillai",
		initials: "GP",
		email: "girish.pillai@example.com",
		alias: "gpillai"
	},
	{
		id: "user-avery",
		fullname: "Avery Johnson",
		initials: "AJ",
		email: "avery.johnson@example.com",
		alias: "averyj"
	},
	{
		id: "user-jordan",
		fullname: "Jordan Lee",
		initials: "JL",
		email: "jordan.lee@example.com",
		alias: "jordanl"
	},
	{
		id: "user-morgan",
		fullname: "Morgan Diaz",
		initials: "MD",
		email: "morgan.diaz@example.com",
		alias: "morgand"
	}
];
var seedOpportunities = [
	{
		id: "opp-grid-modernization",
		account_id: "account-contoso",
		name: "Grid operations modernization",
		owner_id: "user-avery",
		recorded_stage: 3,
		estimated_value: 42e5,
		currency: "USD",
		estimated_close_date: "2026-10-30",
		description: "GP 9/1/2026 Kickoff held; technical validation underway.",
		est_completion_date: "2027-02-01",
		consumption_recurring: 48e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics",
		budget_amount: 4e6,
		budget_status: 1,
		purchase_timeframe: 1,
		timeline: 1,
		purchase_process: 1,
		decision_maker: 1,
		need: 0,
		customer_need: "Modernize grid operations telemetry.",
		customer_pain_points: "Legacy SCADA cannot scale.",
		current_situation: "On-prem historian at capacity.",
		proposed_solution: "Azure data platform + analytics.",
		final_decision_date: "2026-10-15",
		identify_competitors: 1,
		identify_customer_contacts: 1,
		close_probability: 70,
		opportunity_rating: 1,
		qualification_comments: "Strong exec sponsorship.",
		primary_competitor_id: "competitor-aws",
		other_competitor: null,
		forecast_category: 100000003
	},
	{
		id: "opp-cloud-security-readiness",
		account_id: "account-contoso",
		name: "Cloud security readiness",
		owner_id: null,
		recorded_stage: 1,
		estimated_value: 9e5,
		currency: "USD",
		estimated_close_date: "2027-02-26",
		description: null,
		est_completion_date: null,
		consumption_recurring: null,
		solution_area: "Security",
		technical_capability: "Threat Protection",
		budget_amount: null,
		budget_status: null,
		purchase_timeframe: null,
		timeline: null,
		purchase_process: null,
		decision_maker: null,
		need: null,
		customer_need: null,
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: null,
		identify_customer_contacts: null,
		close_probability: 20,
		opportunity_rating: 3,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000001
	},
	{
		id: "opp-data-estate-consolidation",
		account_id: "account-contoso",
		name: "Data estate consolidation",
		owner_id: "user-jordan",
		recorded_stage: 2,
		estimated_value: 265e4,
		currency: "USD",
		estimated_close_date: "2027-01-29",
		description: "JL 8/20/2026 Discovery in progress.",
		est_completion_date: null,
		consumption_recurring: 22e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics",
		budget_amount: 2e6,
		budget_status: 0,
		purchase_timeframe: 3,
		timeline: 3,
		purchase_process: 2,
		decision_maker: 0,
		need: 1,
		customer_need: "Consolidate 6 data warehouses.",
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: 0,
		identify_customer_contacts: 1,
		close_probability: 45,
		opportunity_rating: 2,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: "Snowflake",
		forecast_category: 100000002
	},
	{
		id: "opp-ai-service",
		account_id: "account-fabrikam",
		name: "AI-assisted customer service",
		owner_id: "user-morgan",
		recorded_stage: 2,
		estimated_value: 175e4,
		currency: "USD",
		estimated_close_date: "2026-12-18",
		description: null,
		est_completion_date: null,
		consumption_recurring: 18e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Azure AI and ML",
		budget_amount: 15e5,
		budget_status: 1,
		purchase_timeframe: 2,
		timeline: 2,
		purchase_process: 1,
		decision_maker: 1,
		need: 0,
		customer_need: "Deflect 40% of tier-1 tickets.",
		customer_pain_points: "High support cost.",
		current_situation: null,
		proposed_solution: "Azure OpenAI + Copilot Studio.",
		final_decision_date: null,
		identify_competitors: 1,
		identify_customer_contacts: 0,
		close_probability: 55,
		opportunity_rating: 1,
		qualification_comments: null,
		primary_competitor_id: "competitor-google",
		other_competitor: null,
		forecast_category: 100000002
	},
	{
		id: "opp-unified-commerce",
		account_id: "account-fabrikam",
		name: "Unified commerce platform",
		owner_id: "user-morgan",
		recorded_stage: 4,
		estimated_value: 38e5,
		currency: "USD",
		estimated_close_date: "2026-12-11",
		description: "MD 7/30/2026 Contract in legal review.",
		est_completion_date: "2027-03-15",
		consumption_recurring: 61e3,
		solution_area: "Digital and App Innovation",
		technical_capability: "Cloud Native Apps",
		budget_amount: 38e5,
		budget_status: 1,
		purchase_timeframe: 0,
		timeline: 0,
		purchase_process: 1,
		decision_maker: 1,
		need: 0,
		customer_need: "Single commerce backbone.",
		customer_pain_points: "Fragmented storefronts.",
		current_situation: "Three disparate platforms.",
		proposed_solution: "AKS + Cosmos DB commerce platform.",
		final_decision_date: "2026-12-01",
		identify_competitors: 1,
		identify_customer_contacts: 1,
		close_probability: 85,
		opportunity_rating: 1,
		qualification_comments: "Economic buyer engaged.",
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000003
	},
	{
		id: "opp-store-modernization",
		account_id: "account-fabrikam",
		name: "Connected store modernization",
		owner_id: null,
		recorded_stage: 1,
		estimated_value: 12e5,
		currency: "USD",
		estimated_close_date: "2027-03-19",
		description: null,
		est_completion_date: null,
		consumption_recurring: null,
		solution_area: "Digital and App Innovation",
		technical_capability: "IoT",
		budget_amount: null,
		budget_status: null,
		purchase_timeframe: null,
		timeline: null,
		purchase_process: null,
		decision_maker: null,
		need: 2,
		customer_need: null,
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: null,
		identify_customer_contacts: null,
		close_probability: 15,
		opportunity_rating: 3,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000001
	},
	{
		id: "opp-clinical-data-platform",
		account_id: "account-northwind",
		name: "Clinical data platform modernization",
		owner_id: "user-jordan",
		recorded_stage: 5,
		estimated_value: 21e5,
		currency: "USD",
		estimated_close_date: "2026-09-20",
		description: "JL 9/20/2026 Won; onboarding to value realization.",
		est_completion_date: "2026-11-30",
		consumption_recurring: 35e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics",
		budget_amount: 21e5,
		budget_status: 1,
		purchase_timeframe: 0,
		timeline: 0,
		purchase_process: 1,
		decision_maker: 1,
		need: 0,
		customer_need: "Unify clinical analytics.",
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: "Microsoft Fabric analytics.",
		final_decision_date: "2026-09-10",
		identify_competitors: 1,
		identify_customer_contacts: 1,
		close_probability: 100,
		opportunity_rating: 1,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000005
	},
	{
		id: "opp-zava-ai-platform",
		account_id: "account-zava",
		name: "Zava AI platform foundation",
		owner_id: "user-avery",
		recorded_stage: 2,
		estimated_value: 29e5,
		currency: "USD",
		estimated_close_date: "2027-04-02",
		description: null,
		est_completion_date: null,
		consumption_recurring: 27e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Azure AI and ML",
		budget_amount: 25e5,
		budget_status: 0,
		purchase_timeframe: 3,
		timeline: 3,
		purchase_process: 2,
		decision_maker: 0,
		need: 1,
		customer_need: "Stand up an enterprise AI platform.",
		customer_pain_points: "No governed AI foundation.",
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: 0,
		identify_customer_contacts: 0,
		close_probability: 40,
		opportunity_rating: 2,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000002
	},
	{
		id: "opp-zava-migration",
		account_id: "account-zava",
		name: "Zava datacenter exit",
		owner_id: null,
		recorded_stage: 1,
		estimated_value: 16e5,
		currency: "USD",
		estimated_close_date: "2027-05-28",
		description: null,
		est_completion_date: null,
		consumption_recurring: null,
		solution_area: "Infrastructure",
		technical_capability: "Migration",
		budget_amount: null,
		budget_status: null,
		purchase_timeframe: null,
		timeline: null,
		purchase_process: null,
		decision_maker: null,
		need: null,
		customer_need: null,
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: null,
		identify_customer_contacts: null,
		close_probability: 10,
		opportunity_rating: 3,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000001
	},
	{
		id: "opp-aw-commerce",
		account_id: "account-adventureworks",
		name: "Adventure Works commerce replatform",
		owner_id: "user-morgan",
		recorded_stage: 3,
		estimated_value: 31e5,
		currency: "USD",
		estimated_close_date: "2027-01-08",
		description: "MD 8/15/2026 POC approved.",
		est_completion_date: "2027-05-01",
		consumption_recurring: 4e4,
		solution_area: "Digital and App Innovation",
		technical_capability: "Cloud Native Apps",
		budget_amount: 3e6,
		budget_status: 1,
		purchase_timeframe: 1,
		timeline: 1,
		purchase_process: 1,
		decision_maker: 1,
		need: 0,
		customer_need: "Replatform e-commerce.",
		customer_pain_points: "Peak-season outages.",
		current_situation: "Monolith on VMs.",
		proposed_solution: "AKS microservices.",
		final_decision_date: "2026-12-20",
		identify_competitors: 1,
		identify_customer_contacts: 1,
		close_probability: 65,
		opportunity_rating: 1,
		qualification_comments: null,
		primary_competitor_id: "competitor-aws",
		other_competitor: null,
		forecast_category: 100000003
	},
	{
		id: "opp-ms-only-showcase",
		account_id: "account-contoso",
		name: "Milestone-only workstream (no Deal Team)",
		owner_id: "user-avery",
		recorded_stage: 2,
		estimated_value: 135e4,
		currency: "USD",
		estimated_close_date: "2027-03-30",
		description: null,
		est_completion_date: null,
		consumption_recurring: 12e3,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics",
		budget_amount: null,
		budget_status: null,
		purchase_timeframe: null,
		timeline: null,
		purchase_process: null,
		decision_maker: null,
		need: null,
		customer_need: null,
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: null,
		identify_customer_contacts: null,
		close_probability: 40,
		opportunity_rating: 2,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000002
	},
	{
		id: "disc-contoso-greenfield",
		account_id: "account-contoso",
		name: "Greenfield AI expansion (join a milestone in Discovery)",
		owner_id: null,
		recorded_stage: 2,
		estimated_value: 205e4,
		currency: "USD",
		estimated_close_date: "2027-04-18",
		description: null,
		est_completion_date: null,
		consumption_recurring: null,
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Azure AI and ML",
		budget_amount: null,
		budget_status: null,
		purchase_timeframe: null,
		timeline: null,
		purchase_process: null,
		decision_maker: null,
		need: null,
		customer_need: null,
		customer_pain_points: null,
		current_situation: null,
		proposed_solution: null,
		final_decision_date: null,
		identify_competitors: null,
		identify_customer_contacts: null,
		close_probability: 30,
		opportunity_rating: 2,
		qualification_comments: null,
		primary_competitor_id: null,
		other_competitor: null,
		forecast_category: 100000002
	}
];
var UNCOMMITTED$1 = 86198e4;
var COMMITTED = 861980003;
var seedMilestones = [
	{
		id: "ms-grid-outcome",
		opportunity_id: "opp-grid-modernization",
		name: "Customer outcome validation",
		status: 861980003,
		milestone_date: "2026-07-15",
		owner_id: "user-avery",
		commitment: COMMITTED,
		monthly_use: 4e3,
		risk_details: null,
		forecast_comments: "GP 7/15/2026 Outcome baseline agreed.",
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-grid-technical",
		opportunity_id: "opp-grid-modernization",
		name: "Technical validation workshop",
		status: 86198e4,
		milestone_date: "2026-09-20",
		owner_id: "user-avery",
		commitment: COMMITTED,
		monthly_use: 4e3,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-grid-security",
		opportunity_id: "opp-grid-modernization",
		name: "Security and compliance review",
		status: 861980001,
		milestone_date: "2026-10-05",
		owner_id: null,
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: "Awaiting customer security team availability.",
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-sec-discovery",
		opportunity_id: "opp-cloud-security-readiness",
		name: "Security posture discovery",
		status: 86198e4,
		milestone_date: null,
		owner_id: null,
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: null
	},
	{
		id: "ms-data-signoff",
		opportunity_id: "opp-data-estate-consolidation",
		name: "Business case sign-off",
		status: 861980002,
		milestone_date: "2026-09-30",
		owner_id: "user-jordan",
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: "Blocked on budget approval.",
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-data-dupe",
		opportunity_id: "opp-data-estate-consolidation",
		name: "Duplicate milestone",
		status: 861980006,
		milestone_date: "2026-08-01",
		owner_id: "user-jordan",
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: null
	},
	{
		id: "ms-ai-poc",
		opportunity_id: "opp-ai-service",
		name: "POC readiness",
		status: 861980003,
		milestone_date: "2026-08-10",
		owner_id: "user-morgan",
		commitment: COMMITTED,
		monthly_use: 1500,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-ai-deploy",
		opportunity_id: "opp-ai-service",
		name: "Deployment readiness gate",
		status: 861980001,
		milestone_date: "2026-11-20",
		owner_id: "user-morgan",
		commitment: UNCOMMITTED$1,
		monthly_use: 1500,
		risk_details: "Integration dependencies unconfirmed.",
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-uc-design",
		opportunity_id: "opp-unified-commerce",
		name: "Solution design complete",
		status: 861980003,
		milestone_date: "2026-09-01",
		owner_id: "user-morgan",
		commitment: COMMITTED,
		monthly_use: 5e3,
		risk_details: null,
		forecast_comments: "MD 9/1/2026 Design signed off.",
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-uc-golive",
		opportunity_id: "opp-unified-commerce",
		name: "Go-live readiness",
		status: 86198e4,
		milestone_date: "2027-02-28",
		owner_id: "user-morgan",
		commitment: COMMITTED,
		monthly_use: 5e3,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-store-scope",
		opportunity_id: "opp-store-modernization",
		name: "Scoping workshop",
		status: 861980004,
		milestone_date: "2026-08-05",
		owner_id: null,
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: "Customer paused initiative.",
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-clin-value",
		opportunity_id: "opp-clinical-data-platform",
		name: "Value realization baseline",
		status: 861980003,
		milestone_date: "2026-09-15",
		owner_id: "user-jordan",
		commitment: COMMITTED,
		monthly_use: 2900,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-zava-foundation",
		opportunity_id: "opp-zava-ai-platform",
		name: "AI foundation design",
		status: 86198e4,
		milestone_date: "2027-01-15",
		owner_id: "user-avery",
		commitment: UNCOMMITTED$1,
		monthly_use: 2200,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-zava-pilot",
		opportunity_id: "opp-zava-ai-platform",
		name: "Competitive pilot",
		status: 861980005,
		milestone_date: "2026-11-01",
		owner_id: "user-avery",
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: "Lost pilot to competitor; recovering.",
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 606820001
	},
	{
		id: "ms-zava-assess",
		opportunity_id: "opp-zava-migration",
		name: "Migration assessment",
		status: 86198e4,
		milestone_date: null,
		owner_id: null,
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: null
	},
	{
		id: "ms-aw-poc",
		opportunity_id: "opp-aw-commerce",
		name: "POC sign-off",
		status: 861980003,
		milestone_date: "2026-08-15",
		owner_id: "user-morgan",
		commitment: COMMITTED,
		monthly_use: 3300,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-aw-scale",
		opportunity_id: "opp-aw-commerce",
		name: "Scale readiness",
		status: 86198e4,
		milestone_date: "2026-12-15",
		owner_id: "user-morgan",
		commitment: COMMITTED,
		monthly_use: 3300,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-only-review",
		opportunity_id: "opp-ms-only-showcase",
		name: "Executive alignment review",
		status: 86198e4,
		milestone_date: "2027-01-20",
		owner_id: "user-avery",
		commitment: COMMITTED,
		monthly_use: 1200,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: 60682e4
	},
	{
		id: "ms-greenfield-outcome",
		opportunity_id: "disc-contoso-greenfield",
		name: "Customer outcome validation",
		status: 86198e4,
		milestone_date: "2027-02-10",
		owner_id: null,
		commitment: UNCOMMITTED$1,
		monthly_use: null,
		risk_details: null,
		forecast_comments: null,
		conversation: null,
		customer_budget_approved: null
	}
];
var seedContacts = [
	{
		id: "contact-grid-cfo",
		full_name: "Priya Nair",
		job_title: "CFO",
		email: "priya.nair@contoso.example",
		account_id: "account-contoso"
	},
	{
		id: "contact-grid-cto",
		full_name: "Daniel Reyes",
		job_title: "CTO",
		email: "daniel.reyes@contoso.example",
		account_id: "account-contoso"
	},
	{
		id: "contact-uc-vp",
		full_name: "Sofia Martinez",
		job_title: "VP Digital",
		email: "sofia.martinez@fabrikam.example",
		account_id: "account-fabrikam"
	},
	{
		id: "contact-aw-vp",
		full_name: "Liam OBrien",
		job_title: "VP Engineering",
		email: "liam.obrien@adventureworks.example",
		account_id: "account-adventureworks"
	}
];
var seedCompetitors = [
	{
		id: "competitor-aws",
		name: "AWS"
	},
	{
		id: "competitor-google",
		name: "Google Cloud"
	},
	{
		id: "competitor-snowflake",
		name: "Snowflake"
	}
];
var seedStakeholders = [
	{
		id: "stk-grid-cfo",
		opportunity_id: "opp-grid-modernization",
		name: "Priya Nair",
		contact_id: "contact-grid-cfo",
		job_role: "CFO",
		role_optionset: 86198e4,
		stakeholder_role: 606820002,
		relationship_level: 60682e4,
		linkedin_url: null
	},
	{
		id: "stk-grid-cto",
		opportunity_id: "opp-grid-modernization",
		name: "Daniel Reyes",
		contact_id: "contact-grid-cto",
		job_role: "CTO",
		role_optionset: 861980002,
		stakeholder_role: 60682e4,
		relationship_level: 606820001,
		linkedin_url: null
	},
	{
		id: "stk-uc-vp",
		opportunity_id: "opp-unified-commerce",
		name: "Sofia Martinez",
		contact_id: "contact-uc-vp",
		job_role: "VP Digital",
		role_optionset: 861980003,
		stakeholder_role: 60682e4,
		relationship_level: 60682e4,
		linkedin_url: null
	},
	{
		id: "stk-aw-vp",
		opportunity_id: "opp-aw-commerce",
		name: "Liam OBrien",
		contact_id: "contact-aw-vp",
		job_role: "VP Engineering",
		role_optionset: 861980002,
		stakeholder_role: 606820001,
		relationship_level: 606820001,
		linkedin_url: null
	}
];
/**
* The sample user is on the Deal Team for every seeded opportunity EXCEPT the showcase opportunities:
* `opp-ms-only-showcase` (milestone-team-only → portfolio union without Deal Team) and
* `disc-contoso-greenfield` (a Discovery candidate the user joins via a milestone, not the Deal Team).
*/
var DEAL_TEAM_EXCLUDED_OPPORTUNITY_IDS = /* @__PURE__ */ new Set(["opp-ms-only-showcase", "disc-contoso-greenfield"]);
var seedDealTeam = seedOpportunities.filter((opportunity) => !DEAL_TEAM_EXCLUDED_OPPORTUNITY_IDS.has(String(opportunity["id"]))).map((opportunity) => ({
	opportunity_id: String(opportunity["id"]),
	systemuser_id: SAMPLE_USER_ID
}));
/**
* The sample user is on the milestone team for a representative subset of milestones, so both
* the join ("+") and leave ("-") states are visible in the SQLite sample store. Independent of
* Deal Team membership. `ms-only-review` belongs to an opportunity the user is NOT on the Deal Team
* for, so that opportunity appears in the Portfolio solely through milestone-team membership.
*/
var seedMilestoneTeam = [
	"ms-grid-outcome",
	"ms-grid-technical",
	"ms-ai-poc",
	"ms-uc-design",
	"ms-only-review"
].map((milestoneId) => {
	const milestone = seedMilestones.find((candidate) => candidate["id"] === milestoneId);
	return {
		milestone_id: milestoneId,
		systemuser_id: SAMPLE_USER_ID,
		opportunity_id: String(milestone["opportunity_id"])
	};
});
/** A couple of Activities (Tasks) regarding milestones, so the Activities list is non-empty in the SQLite store. */
var seedMilestoneActivities = [{
	id: "act-grid-outcome-1",
	milestone_id: "ms-grid-outcome",
	opportunity_id: "opp-grid-modernization",
	subject: "Architecture design session",
	activity_type: "task",
	status: "Open",
	priority: "Normal",
	task_category: "Architecture Design Session",
	due: "2026-07-10",
	duration_minutes: 60,
	description: "Whiteboard the target data platform.",
	owner_id: SAMPLE_USER_ID,
	created_by: SAMPLE_USER_ID,
	created_on: "2026-06-20T17:00:00.000Z"
}, {
	id: "act-grid-technical-1",
	milestone_id: "ms-grid-technical",
	opportunity_id: "opp-grid-modernization",
	subject: "Technical validation workshop prep",
	activity_type: "task",
	status: "Completed",
	priority: "High",
	task_category: "Technical Workshop",
	due: "2026-09-15",
	duration_minutes: 30,
	description: null,
	owner_id: SAMPLE_USER_ID,
	created_by: SAMPLE_USER_ID,
	created_on: "2026-09-01T17:00:00.000Z"
}];
var seedOptionValues = [
	...Object.entries(MILESTONE_STATUS).map(([code, label]) => ({
		option_set: "msp_milestonestatus",
		code: Number(code),
		label
	})),
	...Object.entries(COMMITMENT).map(([code, label]) => ({
		option_set: "msp_commitmentrecommendation",
		code: Number(code),
		label
	})),
	...Object.entries(BUDGET_STATUS).map(([code, label]) => ({
		option_set: "budgetstatus",
		code: Number(code),
		label
	})),
	...Object.entries(TIMELINE).map(([code, label]) => ({
		option_set: "timeline",
		code: Number(code),
		label
	})),
	...Object.entries(PURCHASE_PROCESS).map(([code, label]) => ({
		option_set: "purchaseprocess",
		code: Number(code),
		label
	})),
	...Object.entries(NEED).map(([code, label]) => ({
		option_set: "need",
		code: Number(code),
		label
	})),
	...Object.entries(OPPORTUNITY_RATING).map(([code, label]) => ({
		option_set: "opportunityratingcode",
		code: Number(code),
		label
	})),
	...Object.entries(STAKEHOLDER_ROLE_OPTIONSET).map(([code, label]) => ({
		option_set: "msp_roleoptionset",
		code: Number(code),
		label
	})),
	...Object.entries(STAKEHOLDER_ROLE).map(([code, label]) => ({
		option_set: "msp_stakeholderrole",
		code: Number(code),
		label
	})),
	...Object.entries(RELATIONSHIP_LEVEL).map(([code, label]) => ({
		option_set: "msp_relationshiplevel",
		code: Number(code),
		label
	}))
];
/** SE-domain discovery catalog across all 8 domains ("Add me" candidates, not yet on the deal team). */
var seedDiscoverable = [
	{
		id: "disc-contoso-infra",
		account_id: "account-contoso",
		name: "Hybrid networking modernization",
		recorded_stage: 2,
		value: 185e4,
		currency: "USD",
		close_date: "2027-03-01",
		domain: "infra",
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Advanced Networking"
	},
	{
		id: "disc-contoso-data",
		account_id: "account-contoso",
		name: "Lakehouse analytics foundation",
		recorded_stage: 1,
		value: 125e4,
		currency: "USD",
		close_date: "2027-04-10",
		domain: "data",
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics"
	},
	{
		id: "disc-fabrikam-aiapps",
		account_id: "account-fabrikam",
		name: "Cloud-native apps modernization",
		recorded_stage: 2,
		value: 23e5,
		currency: "USD",
		close_date: "2027-02-20",
		domain: "ai-apps",
		solution_area: "Digital and App Innovation",
		technical_capability: "Cloud Native Apps with AKS"
	},
	{
		id: "disc-fabrikam-modernwork",
		account_id: "account-fabrikam",
		name: "Teams calling rollout",
		recorded_stage: 1,
		value: 54e4,
		currency: "USD",
		close_date: "2027-05-05",
		domain: "modern-work",
		solution_area: "Modern Work",
		technical_capability: "Calling"
	},
	{
		id: "disc-zava-security",
		account_id: "account-zava",
		name: "Zero trust threat protection",
		recorded_stage: 2,
		value: 14e5,
		currency: "USD",
		close_date: "2027-03-18",
		domain: "security",
		solution_area: "Security",
		technical_capability: "Threat Protection"
	},
	{
		id: "disc-zava-devices",
		account_id: "account-zava",
		name: "Surface fleet deployment",
		recorded_stage: 1,
		value: 48e4,
		currency: "USD",
		close_date: "2027-06-01",
		domain: "devices",
		solution_area: "Windows and Devices",
		technical_capability: "Surface & Partner Devices"
	},
	{
		id: "disc-aw-bizapps",
		account_id: "account-adventureworks",
		name: "D365 customer service",
		recorded_stage: 2,
		value: 165e4,
		currency: "USD",
		close_date: "2027-02-28",
		domain: "biz-apps",
		solution_area: "Business Applications",
		technical_capability: "Customer Service"
	},
	{
		id: "disc-aw-services",
		account_id: "account-adventureworks",
		name: "Cloud advisory services",
		recorded_stage: 1,
		value: 32e4,
		currency: "USD",
		close_date: "2027-04-22",
		domain: "services",
		solution_area: "Microsoft Services",
		technical_capability: "Advisory Services"
	},
	{
		id: "disc-northwind-data",
		account_id: "account-northwind",
		name: "Clinical analytics with Fabric",
		recorded_stage: 2,
		value: 21e5,
		currency: "USD",
		close_date: "2027-05-20",
		domain: "data",
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Analytics"
	},
	{
		id: "disc-northwind-infra",
		account_id: "account-northwind",
		name: "Datacenter exit to Azure",
		recorded_stage: 1,
		value: 19e5,
		currency: "USD",
		close_date: "2027-06-15",
		domain: "infra",
		solution_area: "Infrastructure",
		technical_capability: "Migration"
	},
	{
		id: "disc-contoso-greenfield",
		account_id: "account-contoso",
		name: "Greenfield AI expansion (join a milestone in Discovery)",
		recorded_stage: 2,
		value: 205e4,
		currency: "USD",
		close_date: "2027-04-18",
		domain: "ai-apps",
		solution_area: "Cloud and AI Platforms",
		technical_capability: "Azure AI and ML"
	}
];
/** activitypointer / appointment statecode (verified live). */
var ACTIVITY_STATUS = {
	0: "Open",
	1: "Completed",
	2: "Canceled",
	3: "Scheduled"
};
var defaultSeed = {
	accounts: seedAccounts,
	systemUsers: seedSystemUsers,
	opportunities: seedOpportunities,
	milestones: seedMilestones,
	contacts: seedContacts,
	competitors: seedCompetitors,
	stakeholders: seedStakeholders,
	dealTeam: seedDealTeam,
	milestoneTeam: seedMilestoneTeam,
	milestoneActivities: seedMilestoneActivities,
	optionValues: seedOptionValues,
	discoverable: seedDiscoverable,
	activities: [
		{
			id: "act-grid-review",
			opportunity_id: "opp-grid-modernization",
			subject: "Executive architecture review",
			owner_id: "user-avery",
			activity_type: "appointment",
			scheduled_start: "2026-10-12T15:00:00.000Z",
			scheduled_end: "2026-10-12T16:00:00.000Z",
			status: 3,
			is_online_meeting: 1,
			online_meeting_join_url: "https://teams.microsoft.com/l/meetup-join/grid-review",
			location: "Microsoft Teams",
			description: "Review solution architecture and decision timeline."
		},
		{
			id: "act-grid-followup",
			opportunity_id: "opp-grid-modernization",
			subject: "Customer follow-up on security review",
			owner_id: "user-avery",
			activity_type: "phonecall",
			scheduled_start: "2026-08-01T14:00:00.000Z",
			scheduled_end: "2026-08-01T14:30:00.000Z",
			status: 0,
			is_online_meeting: 0,
			online_meeting_join_url: null,
			location: null,
			description: "Overdue follow-up on the security and compliance review."
		},
		{
			id: "act-ai-kickoff",
			opportunity_id: "opp-ai-service",
			subject: "AI service kickoff",
			owner_id: "user-morgan",
			activity_type: "appointment",
			scheduled_start: "2026-08-10T16:00:00.000Z",
			scheduled_end: "2026-08-10T17:00:00.000Z",
			status: 1,
			is_online_meeting: 1,
			online_meeting_join_url: "https://teams.microsoft.com/l/meetup-join/ai-kickoff",
			location: "Microsoft Teams",
			description: "Kickoff and discovery session."
		},
		{
			id: "act-cs-discovery",
			opportunity_id: "opp-cloud-security-readiness",
			subject: "Cloud security discovery call",
			owner_id: "user-girish",
			activity_type: "appointment",
			scheduled_start: "2026-09-15T15:00:00.000Z",
			scheduled_end: "2026-09-15T15:45:00.000Z",
			status: 1,
			is_online_meeting: 1,
			online_meeting_join_url: "https://teams.microsoft.com/l/meetup-join/cs-discovery",
			location: "Microsoft Teams",
			description: "Qualify budget, timeline, and decision process for the security readiness initiative."
		}
	],
	transcripts: [{
		id: "tr-grid-customer",
		opportunity_id: "opp-grid-modernization",
		activity_id: "act-grid-review",
		meeting_type: "customer",
		title: "Executive architecture review",
		source: "teams",
		occurred_at: "2026-10-12T15:00:00.000Z"
	}, {
		id: "tr-cloud-security",
		opportunity_id: "opp-cloud-security-readiness",
		activity_id: "act-cs-discovery",
		meeting_type: "customer",
		title: "Cloud security discovery call",
		source: "teams",
		occurred_at: "2026-09-15T15:00:00.000Z"
	}],
	transcriptSegments: [
		{
			id: "seg-grid-1",
			transcript_id: "tr-grid-customer",
			start_ms: 12e3,
			end_ms: 24e3,
			speaker: "Priya Nair",
			speaker_role: "customer",
			text: "Our board approved the budget; we can commit around 4 million this fiscal year."
		},
		{
			id: "seg-grid-2",
			transcript_id: "tr-grid-customer",
			start_ms: 48e3,
			end_ms: 61e3,
			speaker: "Daniel Reyes",
			speaker_role: "customer",
			text: "The decision will go through our architecture committee, and we want to decide this quarter."
		},
		{
			id: "seg-grid-3",
			transcript_id: "tr-grid-customer",
			start_ms: 83e3,
			end_ms: 95e3,
			speaker: "Avery Johnson",
			speaker_role: "internal",
			text: "We are competing against AWS here, so the proof of value needs to land next week."
		},
		{
			id: "seg-cs-1",
			transcript_id: "tr-cloud-security",
			start_ms: 15e3,
			end_ms: 3e4,
			speaker: "Priya Nair",
			speaker_role: "customer",
			text: "We have sign-off to spend about 900 thousand this quarter to get our cloud security posture right."
		},
		{
			id: "seg-cs-2",
			transcript_id: "tr-cloud-security",
			start_ms: 54e3,
			end_ms: 7e4,
			speaker: "Daniel Reyes",
			speaker_role: "customer",
			text: "Our security steering committee makes the final call, and honestly this is a must-have for us this year."
		},
		{
			id: "seg-cs-3",
			transcript_id: "tr-cloud-security",
			start_ms: 95e3,
			end_ms: 112e3,
			speaker: "Girish Pillai",
			speaker_role: "internal",
			text: "Let us schedule a threat-protection proof of value; note that Palo Alto is also in the evaluation."
		}
	]
};
//#endregion
//#region packages/connectors/local-store/local-store.ts
var requireModule = createRequire(import.meta.url);
/**
* A persistent, relational local test-data store backed by `node:sqlite` (built in; no
* extra dependency). Applies the schema and seed, and exposes small typed query/mutation
* helpers used by the local-store MSX connector. Defaults to an in-memory database;
* pass a file path for a store whose injected values survive restarts.
*/
var LocalStore = class {
	db;
	constructor(options = {}) {
		const { DatabaseSync } = requireModule("node:sqlite");
		this.db = new DatabaseSync(options.path ?? ":memory:");
		this.db.exec(LOCAL_STORE_SCHEMA);
		this.load(options.seed ?? defaultSeed);
	}
	load(seed) {
		const tables = [
			["account", seed.accounts],
			["systemuser", seed.systemUsers],
			["competitor", seed.competitors],
			["opportunity", seed.opportunities],
			["engagement_milestone", seed.milestones],
			["contact", seed.contacts],
			["stakeholder", seed.stakeholders],
			["opportunity_dealteam", seed.dealTeam],
			["milestone_team_member", seed.milestoneTeam],
			["milestone_activity", seed.milestoneActivities],
			["discoverable_opportunity", seed.discoverable],
			["activity", seed.activities],
			["transcript", seed.transcripts],
			["transcript_segment", seed.transcriptSegments],
			["option_value", seed.optionValues]
		];
		for (const [table, rows] of tables) for (const row of rows) this.insert(table, row);
	}
	insert(table, row) {
		const columns = Object.keys(row);
		const placeholders = columns.map(() => "?").join(", ");
		this.db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
	}
	all(sql, ...params) {
		return this.db.prepare(sql).all(...params);
	}
	get(sql, ...params) {
		return this.db.prepare(sql).get(...params);
	}
	run(sql, ...params) {
		this.db.prepare(sql).run(...params);
	}
	/** Executes raw SQL (used for transaction control: BEGIN / COMMIT / ROLLBACK). */
	exec(sql) {
		this.db.exec(sql);
	}
	close() {
		this.db.close();
	}
};
//#endregion
//#region packages/connectors/local-store/index.ts
function str(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function num(value) {
	return typeof value === "number" ? value : void 0;
}
/** Formats a comment entry per the additive protocol: `<INITIALS> <M/D/YYYY> <text>`. */
function formatCommentEntry(initials, text, when = /* @__PURE__ */ new Date()) {
	return `${initials} ${`${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`} ${text}`;
}
/** Prepends a new entry to existing comments (newest-first), preserving history. */
function prependComment(existing, entry) {
	return existing && existing.trim().length > 0 ? `${entry}\n${existing}` : entry;
}
/** Reverse-maps an option label to its numeric code. */
function reverseOption(map, label) {
	const match = Object.entries(map).find(([, l]) => l === label);
	return match ? Number(match[0]) : void 0;
}
/**
* MSX connector backed by the relational {@link LocalStore}. Implements the same
* contract as the live and fixture connectors, so it can be selected for sample/test
* mode behind the existing data seam. Writes persist in the store (injected values
* survive when a file-backed store is used).
*/
var LocalStoreMsxConnector = class {
	store;
	currentUserId;
	manualAccountIds = /* @__PURE__ */ new Set();
	constructor(store = new LocalStore(), currentUserId = SAMPLE_USER_ID) {
		this.store = store;
		this.currentUserId = currentUserId;
	}
	ownerName(ownerId) {
		const id = str(ownerId);
		if (!id) return void 0;
		return str(this.store.get("SELECT fullname FROM systemuser WHERE id = ?", id)?.["fullname"]);
	}
	userInitials() {
		return str(this.store.get("SELECT initials FROM systemuser WHERE id = ?", this.currentUserId)?.["initials"]) ?? "??";
	}
	dealTeamAccountIds() {
		const rows = this.store.all(`SELECT o.account_id AS account_id FROM opportunity o
       JOIN opportunity_dealteam dt ON dt.opportunity_id = o.id
       WHERE dt.systemuser_id = ?
       UNION
       SELECT o.account_id AS account_id FROM opportunity o
       JOIN milestone_team_member mt ON mt.opportunity_id = o.id
       WHERE mt.systemuser_id = ?`, this.currentUserId, this.currentUserId);
		return new Set(rows.map((row) => String(row["account_id"])));
	}
	toAccount(row, dealTeam) {
		const id = String(row["id"]);
		const manual = this.manualAccountIds.has(id);
		const onDealTeam = dealTeam.has(id);
		return accountSchema.parse({
			id,
			name: String(row["name"]),
			...str(row["segment"]) ? { segment: str(row["segment"]) } : {},
			...str(row["tpid"]) ? { tpid: str(row["tpid"]) } : {},
			provenance: manual && onDealTeam ? "both" : manual ? "manual" : "deal-team",
			visibility: str(row["visibility"]) === "hidden" ? "hidden" : "visible"
		});
	}
	toOpportunity(row) {
		const owner = this.ownerName(row["owner_id"]);
		const comments = str(row["description"]);
		return opportunitySchema.parse({
			id: String(row["id"]),
			accountId: String(row["account_id"]),
			name: String(row["name"]),
			recordedStage: num(row["recorded_stage"]) ?? 1,
			value: num(row["estimated_value"]) ?? 0,
			currency: str(row["currency"]) ?? "USD",
			closeDate: String(row["estimated_close_date"]),
			...owner ? { owner } : {},
			...comments ? { comments } : {}
		});
	}
	toMilestone(row) {
		const owner = this.ownerName(row["owner_id"]);
		const status = MILESTONE_STATUS[num(row["status"]) ?? -1] ?? "On Track";
		const commitmentCode = num(row["commitment"]);
		const commitment = commitmentCode === void 0 ? void 0 : COMMITMENT[commitmentCode];
		const targetDate = str(row["milestone_date"]);
		const usage = num(row["monthly_use"]);
		const risk = str(row["risk_details"]);
		const comments = str(row["forecast_comments"]);
		return milestoneSchema.parse({
			id: String(row["id"]),
			opportunityId: String(row["opportunity_id"]),
			name: String(row["name"]),
			status,
			...targetDate ? { targetDate } : {},
			...usage !== void 0 ? { estimatedMonthlyUsage: usage } : {},
			...owner ? { owner } : {},
			...commitment ? { commitment } : {},
			...risk ? { riskDetails: risk } : {},
			...comments ? { comments } : {}
		});
	}
	assertOpportunityAccess(opportunityId) {
		const row = this.store.get("SELECT * FROM opportunity WHERE id = ?", opportunityId);
		if (!row) throw new Error(`Unknown local-store opportunity: ${opportunityId}`);
		const onTeam = this.store.get(`SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?
       UNION
       SELECT 1 AS present FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?`, opportunityId, this.currentUserId, opportunityId, this.currentUserId);
		const account = this.store.get("SELECT visibility FROM account WHERE id = ?", String(row["account_id"]));
		if (!onTeam || str(account?.["visibility"]) === "hidden") throw new Error("The opportunity is not in the active local-store portfolio.");
		return row;
	}
	async listAccounts(options = {}) {
		const dealTeam = this.dealTeamAccountIds();
		return this.store.all("SELECT * FROM account ORDER BY name").map((row) => this.toAccount(row, dealTeam)).filter((account) => dealTeam.has(account.id) || this.manualAccountIds.has(account.id) || account.visibility === "hidden").filter((account) => options.includeHidden || account.visibility !== "hidden");
	}
	async searchAccounts(request) {
		const query = request.query.toLocaleLowerCase();
		const dealTeam = this.dealTeamAccountIds();
		const visible = new Map((await this.listAccounts({ includeHidden: true })).map((account) => [account.id, account]));
		return this.store.all("SELECT * FROM account ORDER BY name").filter((row) => request.matchBy === "name" ? String(row["name"]).toLocaleLowerCase().includes(query) : str(row["tpid"]) === request.query).map((row) => {
			const base = this.toAccount(row, dealTeam);
			const existing = visible.get(base.id);
			return {
				...existing ?? base,
				state: existing?.visibility === "hidden" ? "hidden" : existing ? "visible" : "not-added"
			};
		});
	}
	async addAccount(accountId) {
		const row = this.store.get("SELECT * FROM account WHERE id = ?", accountId);
		if (!row) throw new Error(`Unknown local-store account: ${accountId}`);
		this.manualAccountIds.add(accountId);
		return this.toAccount(row, this.dealTeamAccountIds());
	}
	async setAccountVisibility(accountId, visibility) {
		if (!this.store.get("SELECT * FROM account WHERE id = ?", accountId)) throw new Error(`Unknown local-store account: ${accountId}`);
		this.store.run("UPDATE account SET visibility = ? WHERE id = ?", visibility, accountId);
		const updated = this.store.get("SELECT * FROM account WHERE id = ?", accountId);
		return this.toAccount(updated, this.dealTeamAccountIds());
	}
	async listOpportunities(accountId) {
		if (str(this.store.get("SELECT visibility FROM account WHERE id = ?", accountId)?.["visibility"]) === "hidden") return [];
		return this.store.all(`SELECT o.* FROM opportunity o
       WHERE o.account_id = ? AND (
         EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
         OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
       )
       ORDER BY o.estimated_close_date`, accountId, this.currentUserId, this.currentUserId).map((row) => this.toOpportunity(row));
	}
	async listMilestones(opportunityId) {
		this.assertOpportunityAccess(opportunityId);
		const memberMilestoneIds = new Set(this.store.all("SELECT milestone_id FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?", opportunityId, this.currentUserId).map((row) => String(row["milestone_id"])));
		return this.store.all("SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date", opportunityId).map((row) => ({
			...this.toMilestone(row),
			onMilestoneTeam: memberMilestoneIds.has(String(row["id"]))
		}));
	}
	async listDiscoverableMilestones(opportunityId) {
		const memberMilestoneIds = new Set(this.store.all("SELECT milestone_id FROM milestone_team_member WHERE opportunity_id = ? AND systemuser_id = ?", opportunityId, this.currentUserId).map((row) => String(row["milestone_id"])));
		return this.store.all("SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date", opportunityId).map((row) => ({
			...this.toMilestone(row),
			onMilestoneTeam: memberMilestoneIds.has(String(row["id"]))
		}));
	}
	toMilestoneActivity(row) {
		const owner = this.ownerName(row["owner_id"]);
		const createdBy = this.ownerName(row["created_by"]);
		const priority = str(row["priority"]);
		const taskCategory = str(row["task_category"]);
		const due = str(row["due"]);
		const duration = num(row["duration_minutes"]);
		const description = str(row["description"]);
		const createdOn = str(row["created_on"]);
		return {
			id: String(row["id"]),
			milestoneId: String(row["milestone_id"]),
			opportunityId: String(row["opportunity_id"]),
			subject: String(row["subject"]),
			activityType: str(row["activity_type"]) ?? "task",
			status: str(row["status"]) ?? "Open",
			...priority === "Low" || priority === "Normal" || priority === "High" ? { priority } : {},
			...taskCategory ? { taskCategory } : {},
			...due ? { due } : {},
			...duration !== void 0 ? { durationMinutes: duration } : {},
			...description ? { description } : {},
			...owner ? { owner } : {},
			...createdBy ? { createdBy } : {},
			...createdOn ? { createdOn } : {}
		};
	}
	assertMilestoneInOpportunity(opportunityId, milestoneId) {
		if (!this.store.get("SELECT 1 AS present FROM engagement_milestone WHERE id = ? AND opportunity_id = ?", milestoneId, opportunityId)) throw new Error(`Unknown local-store milestone: ${milestoneId}`);
	}
	async listMilestoneActivities(opportunityId, milestoneId) {
		this.assertMilestoneInOpportunity(opportunityId, milestoneId);
		return this.store.all("SELECT * FROM milestone_activity WHERE milestone_id = ? ORDER BY created_on DESC", milestoneId).map((row) => this.toMilestoneActivity(row));
	}
	async createMilestoneActivity(opportunityId, milestoneId, input) {
		this.assertMilestoneInOpportunity(opportunityId, milestoneId);
		const request = createMilestoneActivityRequestSchema.parse(input);
		const id = `act-${randomUUID()}`;
		this.store.run(`INSERT INTO milestone_activity (id, milestone_id, opportunity_id, subject, activity_type, status, priority, task_category, due, duration_minutes, description, owner_id, created_by, created_on)
       VALUES (?, ?, ?, ?, 'task', 'Open', ?, ?, ?, ?, ?, ?, ?, ?)`, id, milestoneId, opportunityId, request.subject, request.priority, request.taskCategory ?? null, request.due ?? null, request.durationMinutes ?? null, request.description ?? null, this.currentUserId, this.currentUserId, (/* @__PURE__ */ new Date()).toISOString());
		return this.toMilestoneActivity(this.store.get("SELECT * FROM milestone_activity WHERE id = ?", id));
	}
	async updateMilestone(opportunityId, milestoneId, update) {
		this.assertOpportunityAccess(opportunityId);
		if (!this.store.get("SELECT * FROM engagement_milestone WHERE id = ? AND opportunity_id = ?", milestoneId, opportunityId)) throw new Error(`Unknown local-store milestone: ${milestoneId}`);
		if (update.status !== void 0) {
			const code = Number(Object.entries(MILESTONE_STATUS).find(([, label]) => label === update.status)?.[0]);
			this.store.run("UPDATE engagement_milestone SET status = ? WHERE id = ?", code, milestoneId);
		}
		if (update.targetDate !== void 0) this.store.run("UPDATE engagement_milestone SET milestone_date = ? WHERE id = ?", update.targetDate, milestoneId);
		if (update.customerCommitment !== void 0) {
			const code = update.customerCommitment === "Committed" ? 861980003 : 86198e4;
			this.store.run("UPDATE engagement_milestone SET commitment = ? WHERE id = ?", code, milestoneId);
		}
		if (update.riskDetails !== void 0) this.store.run("UPDATE engagement_milestone SET risk_details = ? WHERE id = ?", update.riskDetails, milestoneId);
		if (update.comments !== void 0) this.store.run("UPDATE engagement_milestone SET forecast_comments = ? WHERE id = ?", update.comments, milestoneId);
		return this.toMilestone(this.store.get("SELECT * FROM engagement_milestone WHERE id = ?", milestoneId));
	}
	async updateOpportunity(opportunityId, update) {
		this.assertOpportunityAccess(opportunityId);
		this.store.run("UPDATE opportunity SET description = ? WHERE id = ?", update.comments, opportunityId);
		return this.toOpportunity(this.store.get("SELECT * FROM opportunity WHERE id = ?", opportunityId));
	}
	async updateOpportunityStage(opportunityId, targetStage, auditNote) {
		const comments = [str(this.assertOpportunityAccess(opportunityId)["description"]), auditNote].filter(Boolean).join("\n\n");
		this.store.run("UPDATE opportunity SET recorded_stage = ?, description = ? WHERE id = ?", targetStage, comments, opportunityId);
		return this.toOpportunity(this.store.get("SELECT * FROM opportunity WHERE id = ?", opportunityId));
	}
	/**
	* Appends a comment to an opportunity using the additive protocol (newest-first prepend
	* with an `<INITIALS> <M/D/YYYY>` prefix), preserving prior history. Intended for the
	* meeting-inject flow and the Portfolio "type a new comment" UX.
	*/
	async appendOpportunityComment(opportunityId, text) {
		const row = this.assertOpportunityAccess(opportunityId);
		const entry = formatCommentEntry(this.userInitials(), text);
		this.store.run("UPDATE opportunity SET description = ? WHERE id = ?", prependComment(str(row["description"]), entry), opportunityId);
		return this.toOpportunity(this.store.get("SELECT * FROM opportunity WHERE id = ?", opportunityId));
	}
	async getOpportunityContext(opportunityId) {
		const row = this.assertOpportunityAccess(opportunityId);
		const accountRow = this.store.get("SELECT * FROM account WHERE id = ?", String(row["account_id"]));
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			account: this.toAccount(accountRow, this.dealTeamAccountIds()),
			opportunity: this.toOpportunity(row),
			observations: this.buildObservations(row),
			retrievedAt: now,
			sourceHealth: {
				source: "msx",
				state: "sample",
				detail: "Local SQLite test store; no live MSX call was made.",
				checkedAt: now
			}
		};
	}
	buildObservations(row) {
		const observations = [];
		if (num(row["budget_amount"]) !== void 0) observations.push({
			criterionId: "budget",
			status: num(row["budget_status"]) === 1 ? "met" : "partial",
			detail: "Budget amount is recorded on the opportunity."
		});
		if (str(row["final_decision_date"])) observations.push({
			criterionId: "next-step",
			status: "partial",
			detail: "A final decision date is recorded."
		});
		if (str(row["proposed_solution"])) observations.push({
			criterionId: "technical-validation",
			status: "partial",
			detail: "A proposed solution is recorded."
		});
		if (str(row["customer_need"])) observations.push({
			criterionId: "customer-outcome",
			status: "partial",
			detail: "A customer need is recorded."
		});
		return observations;
	}
	async discoverOpportunities(domain) {
		return this.store.all(`SELECT d.*, a.name AS account_name, a.visibility AS visibility
       FROM discoverable_opportunity d JOIN account a ON a.id = d.account_id
       WHERE d.domain = ? ORDER BY d.close_date`, domain).filter((row) => str(row["visibility"]) !== "hidden").map((row) => {
			const id = String(row["id"]);
			const onDealTeam = Boolean(this.store.get("SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?", id, this.currentUserId));
			const solutionArea = str(row["solution_area"]);
			const technicalCapability = str(row["technical_capability"]);
			const accountName = str(row["account_name"]);
			return discoverableOpportunitySchema.parse({
				id,
				accountId: String(row["account_id"]),
				name: String(row["name"]),
				recordedStage: num(row["recorded_stage"]) ?? 1,
				value: num(row["value"]) ?? 0,
				currency: str(row["currency"]) ?? "USD",
				closeDate: String(row["close_date"]),
				domain,
				onDealTeam,
				...accountName ? { accountName } : {},
				...solutionArea ? { solutionArea } : {},
				...technicalCapability ? { technicalCapability } : {}
			});
		});
	}
	async joinDealTeam(opportunityId) {
		if (!this.store.get("SELECT 1 AS present FROM opportunity WHERE id = ?", opportunityId)) {
			const discovered = this.store.get("SELECT * FROM discoverable_opportunity WHERE id = ?", opportunityId);
			if (!discovered) throw new Error(`Unknown local-store opportunity: ${opportunityId}`);
			this.store.run(`INSERT INTO opportunity (id, account_id, name, recorded_stage, estimated_value, currency, estimated_close_date, solution_area, technical_capability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, opportunityId, String(discovered["account_id"]), String(discovered["name"]), num(discovered["recorded_stage"]) ?? 1, num(discovered["value"]) ?? 0, str(discovered["currency"]) ?? "USD", String(discovered["close_date"]), str(discovered["solution_area"]) ?? null, str(discovered["technical_capability"]) ?? null);
		}
		const alreadyMember = Boolean(this.store.get("SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?", opportunityId, this.currentUserId));
		if (!alreadyMember) this.store.run("INSERT INTO opportunity_dealteam (opportunity_id, systemuser_id) VALUES (?, ?)", opportunityId, this.currentUserId);
		return {
			opportunityId,
			onDealTeam: true,
			alreadyMember
		};
	}
	async leaveDealTeam(opportunityId) {
		const alreadyAbsent = !this.store.get("SELECT 1 AS present FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?", opportunityId, this.currentUserId);
		this.store.run("DELETE FROM opportunity_dealteam WHERE opportunity_id = ? AND systemuser_id = ?", opportunityId, this.currentUserId);
		return {
			opportunityId,
			onDealTeam: false,
			alreadyAbsent
		};
	}
	async joinMilestoneTeam(opportunityId, milestoneId) {
		if (!this.store.get("SELECT 1 AS present FROM engagement_milestone WHERE id = ? AND opportunity_id = ?", milestoneId, opportunityId)) throw new Error(`Unknown local-store milestone: ${milestoneId}`);
		const alreadyMember = Boolean(this.store.get("SELECT 1 AS present FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?", milestoneId, this.currentUserId));
		if (!alreadyMember) this.store.run("INSERT INTO milestone_team_member (milestone_id, systemuser_id, opportunity_id) VALUES (?, ?, ?)", milestoneId, this.currentUserId, opportunityId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: true,
			alreadyMember
		};
	}
	async leaveMilestoneTeam(opportunityId, milestoneId) {
		const alreadyAbsent = !this.store.get("SELECT 1 AS present FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?", milestoneId, this.currentUserId);
		this.store.run("DELETE FROM milestone_team_member WHERE milestone_id = ? AND systemuser_id = ?", milestoneId, this.currentUserId);
		return {
			opportunityId,
			milestoneId,
			onMilestoneTeam: false,
			alreadyAbsent
		};
	}
	/** Meetings / activities linked to an opportunity (the meetings a transcript can come from). */
	async listActivities(opportunityId) {
		this.assertOpportunityAccess(opportunityId);
		return this.store.all("SELECT * FROM activity WHERE opportunity_id = ? ORDER BY scheduled_end", opportunityId).map((row) => {
			const owner = this.ownerName(row["owner_id"]);
			const activityType = str(row["activity_type"]);
			const scheduledStart = str(row["scheduled_start"]);
			const scheduledEnd = str(row["scheduled_end"]);
			const joinUrl = str(row["online_meeting_join_url"]);
			const location = str(row["location"]);
			const description = str(row["description"]);
			return {
				id: String(row["id"]),
				opportunityId: String(row["opportunity_id"]),
				subject: String(row["subject"]),
				status: ACTIVITY_STATUS[num(row["status"]) ?? -1] ?? "Open",
				isOnlineMeeting: num(row["is_online_meeting"]) === 1,
				...owner ? { owner } : {},
				...activityType ? { activityType } : {},
				...scheduledStart ? { scheduledStart } : {},
				...scheduledEnd ? { scheduledEnd } : {},
				...joinUrl ? { onlineMeetingJoinUrl: joinUrl } : {},
				...location ? { location } : {},
				...description ? { description } : {}
			};
		});
	}
	/** Transcripts (with diarized segments) linked to an opportunity's meetings. */
	async listTranscripts(opportunityId) {
		this.assertOpportunityAccess(opportunityId);
		return this.store.all("SELECT * FROM transcript WHERE opportunity_id = ? ORDER BY occurred_at", opportunityId).map((row) => {
			const id = String(row["id"]);
			const segments = this.store.all("SELECT * FROM transcript_segment WHERE transcript_id = ? ORDER BY start_ms", id).map((segment) => {
				const startMs = num(segment["start_ms"]);
				const endMs = num(segment["end_ms"]);
				const speaker = str(segment["speaker"]);
				const speakerRole = str(segment["speaker_role"]);
				return {
					id: String(segment["id"]),
					text: String(segment["text"]),
					...startMs !== void 0 ? { startMs } : {},
					...endMs !== void 0 ? { endMs } : {},
					...speaker ? { speaker } : {},
					...speakerRole ? { speakerRole } : {}
				};
			});
			const activityId = str(row["activity_id"]);
			const title = str(row["title"]);
			const source = str(row["source"]);
			return {
				id,
				opportunityId: String(row["opportunity_id"]),
				meetingType: String(row["meeting_type"]),
				occurredAt: String(row["occurred_at"]),
				segments,
				...activityId ? { activityId } : {},
				...title ? { title } : {},
				...source ? { source } : {}
			};
		});
	}
	/** Meeting transcript candidates for the launcher picker (sample path reads seeded rows). */
	async listMeetingTranscripts(opportunityId) {
		if (opportunityId) this.assertOpportunityAccess(opportunityId);
		return (opportunityId ? this.store.all(`SELECT t.*, o.name AS opp_name FROM transcript t JOIN opportunity o ON o.id = t.opportunity_id
           WHERE t.opportunity_id = ? ORDER BY t.occurred_at DESC`, opportunityId) : this.store.all(`SELECT t.*, o.name AS opp_name FROM transcript t JOIN opportunity o ON o.id = t.opportunity_id
           ORDER BY t.occurred_at DESC`)).map((row) => {
			const id = String(row["id"]);
			const count = num(this.store.get("SELECT COUNT(*) AS c FROM transcript_segment WHERE transcript_id = ?", id)?.["c"]) ?? 0;
			const oppId = str(row["opportunity_id"]);
			const oppName = str(row["opp_name"]);
			return meetingTranscriptSummarySchema.parse({
				id,
				subject: str(row["title"]) ?? "Meeting transcript",
				occurredAt: String(row["occurred_at"]),
				meetingType: String(row["meeting_type"]) === "internal" ? "internal" : "customer",
				source: str(row["source"]) === "upload" || str(row["source"]) === "paste" ? str(row["source"]) : "teams",
				segmentCount: count,
				...oppId ? { opportunityId: oppId } : {},
				...oppName ? { opportunityName: oppName } : {}
			});
		});
	}
	/** Loads a seeded transcript (with diarized segments) as the canonical contract shape. */
	async getMeetingTranscript(transcriptId) {
		const row = this.store.get("SELECT * FROM transcript WHERE id = ?", transcriptId);
		if (!row) return void 0;
		const segments = this.store.all("SELECT * FROM transcript_segment WHERE transcript_id = ? ORDER BY start_ms", transcriptId).map((segment) => {
			const startMs = num(segment["start_ms"]);
			const endMs = num(segment["end_ms"]);
			const speaker = str(segment["speaker"]);
			const role = str(segment["speaker_role"]);
			return {
				segmentId: String(segment["id"]),
				text: String(segment["text"]),
				...startMs !== void 0 ? { startMs } : {},
				...endMs !== void 0 ? { endMs } : {},
				...speaker ? { speaker } : {},
				...role === "internal" || role === "customer" ? { speakerRole: role } : {}
			};
		});
		const oppId = str(row["opportunity_id"]);
		const title = str(row["title"]);
		return meetingTranscriptSchema.parse({
			id: String(row["id"]),
			meetingType: String(row["meeting_type"]) === "internal" ? "internal" : "customer",
			source: str(row["source"]) === "upload" || str(row["source"]) === "paste" ? str(row["source"]) : "teams",
			segments,
			...oppId ? { opportunityId: oppId } : {},
			...title ? { title } : {}
		});
	}
	labelFor(canonical, code) {
		if (code === void 0) return null;
		switch (canonical) {
			case "budgetStatus": return BUDGET_STATUS[code] ?? null;
			case "timeline": return TIMELINE[code] ?? null;
			case "purchaseProcess": return PURCHASE_PROCESS[code] ?? null;
			case "need": return NEED[code] ?? null;
			case "opportunityRating": return OPPORTUNITY_RATING[code] ?? null;
			case "milestoneCommitment": return COMMITMENT[code] ?? null;
			default: return null;
		}
	}
	buildOpportunitySnapshot(row) {
		return {
			id: String(row["id"]),
			name: String(row["name"]),
			fields: {
				budgetAmount: num(row["budget_amount"]) ?? null,
				budgetStatus: this.labelFor("budgetStatus", num(row["budget_status"])),
				estimatedValue: num(row["estimated_value"]) ?? null,
				timeline: this.labelFor("timeline", num(row["timeline"])),
				purchaseProcess: this.labelFor("purchaseProcess", num(row["purchase_process"])),
				decisionMaker: num(row["decision_maker"]) === 1,
				need: this.labelFor("need", num(row["need"])),
				customerNeed: str(row["customer_need"]) ?? null,
				proposedSolution: str(row["proposed_solution"]) ?? null,
				finalDecisionDate: str(row["final_decision_date"]) ?? null,
				identifyCompetitors: num(row["identify_competitors"]) === 1,
				opportunityRating: this.labelFor("opportunityRating", num(row["opportunity_rating"])),
				qualificationComments: str(row["qualification_comments"]) ?? null
			}
		};
	}
	buildMilestoneSnapshot(row) {
		return {
			id: String(row["id"]),
			name: String(row["name"]),
			fields: {
				milestoneCommitment: this.labelFor("milestoneCommitment", num(row["commitment"])),
				milestoneRisk: str(row["risk_details"]) ?? null
			}
		};
	}
	/** Produces a reviewable change-set proposal from a transcript against the live opp snapshot. */
	async proposeMeetingChangeSet(request, extractor) {
		const oppRow = this.assertOpportunityAccess(request.opportunityId);
		let transcript;
		if (request.transcript) transcript = meetingTranscriptSchema.parse(request.transcript);
		else if (request.transcriptId) {
			const loaded = await this.getMeetingTranscript(request.transcriptId);
			if (!loaded) throw new Error(`Unknown local-store transcript: ${request.transcriptId}`);
			transcript = loaded;
		} else throw new Error("proposeMeetingChangeSet requires a transcript or transcriptId.");
		const anchored = {
			...transcript,
			opportunityId: request.opportunityId
		};
		const opportunity = this.buildOpportunitySnapshot(oppRow);
		const milestones = this.store.all("SELECT * FROM engagement_milestone WHERE opportunity_id = ? ORDER BY milestone_date", request.opportunityId).map((milestoneRow) => this.buildMilestoneSnapshot(milestoneRow));
		const changeSetId = request.changeSetId ?? `cs-${request.opportunityId}-${Date.now().toString(36)}`;
		return (extractor ?? ((ctx, options) => extractMeetingSignals(ctx, options)))({
			transcript: anchored,
			opportunity,
			milestones
		}, { changeSetId });
	}
	optionCodeFor(canonical, label) {
		switch (canonical) {
			case "budgetStatus": return reverseOption(BUDGET_STATUS, label);
			case "timeline": return reverseOption(TIMELINE, label);
			case "purchaseProcess": return reverseOption(PURCHASE_PROCESS, label);
			case "need": return reverseOption(NEED, label);
			case "opportunityRating": return reverseOption(OPPORTUNITY_RATING, label);
			case "milestoneCommitment": return reverseOption(COMMITMENT, label);
			default: return;
		}
	}
	applyOpportunityField(opportunityId, entry, after) {
		const column = entry.msxField;
		if (entry.valueType === "money") this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, Number(after), opportunityId);
		else if (entry.valueType === "boolean") this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, after ? 1 : 0, opportunityId);
		else if (entry.valueType === "date") this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, String(after), opportunityId);
		else if (entry.valueType === "optionset") this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, this.optionCodeFor(entry.canonical, String(after)) ?? null, opportunityId);
		else if (entry.append) {
			const current = str(this.store.get(`SELECT ${column} AS v FROM opportunity WHERE id = ?`, opportunityId)?.["v"]);
			this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, prependComment(current, String(after)), opportunityId);
		} else this.store.run(`UPDATE opportunity SET ${column} = ? WHERE id = ?`, String(after), opportunityId);
	}
	applyMilestoneField(milestoneId, entry, after) {
		const column = entry.msxField;
		if (entry.valueType === "optionset") this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, this.optionCodeFor(entry.canonical, String(after)) ?? null, milestoneId);
		else if (entry.append) {
			const current = str(this.store.get(`SELECT ${column} AS v FROM engagement_milestone WHERE id = ?`, milestoneId)?.["v"]);
			this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, prependComment(current, String(after)), milestoneId);
		} else this.store.run(`UPDATE engagement_milestone SET ${column} = ? WHERE id = ?`, String(after), milestoneId);
	}
	concurrencyMatches(entry, before, current) {
		if (entry.valueType === "money") return (before === null || before === void 0 ? null : Number(before)) === (current === null || current === void 0 ? null : Number(current));
		if (entry.valueType === "boolean") return Boolean(before) === Boolean(current);
		return (before === null || before === void 0 ? "" : String(before).trim()) === (current === null || current === void 0 ? "" : String(current).trim());
	}
	insertNewMilestone(opportunityId, name, milestoneDate, commitment) {
		const id = `ms-new-${opportunityId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
		const commitmentCode = commitment ? reverseOption(COMMITMENT, commitment) ?? null : null;
		this.store.run(`INSERT INTO engagement_milestone (id, opportunity_id, name, status, milestone_date, owner_id, commitment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, id, opportunityId, name, 86198e4, milestoneDate ?? null, this.currentUserId, commitmentCode);
		return id;
	}
	buildResultItems(proposal, approval, outcome) {
		const items = [];
		for (const slot of proposal.slots) {
			if (!approval.approvedSlotIds.includes(slot.slotId)) continue;
			let state;
			let detail;
			if (outcome.conflicts.has(slot.slotId)) {
				state = "conflict";
				detail = `"${slot.label}" changed since review; no update applied.`;
			} else if (outcome.applied.has(slot.slotId)) {
				state = "applied";
				detail = `${slot.label}: ${slot.displayAfter}`;
			} else if (slot.targetKind === "milestone" && slot.targetRecordId && !approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
				state = "skipped";
				detail = `${slot.label}: milestone not selected.`;
			} else {
				state = "skipped";
				detail = `${slot.label}: not applied (change set rolled back).`;
			}
			items.push({
				id: slot.slotId,
				kind: "field",
				state,
				detail
			});
		}
		for (const milestone of proposal.newMilestones) {
			if (!approval.approvedNewMilestoneTempIds.includes(milestone.tempId)) continue;
			const applied = outcome.appliedMilestones?.has(milestone.tempId) ?? false;
			items.push({
				id: milestone.tempId,
				kind: "new-milestone",
				state: applied ? "applied" : "skipped",
				detail: applied ? `Created milestone "${milestone.name}".` : `Milestone "${milestone.name}" not created (rolled back).`
			});
		}
		return items;
	}
	/** Applies an approved change set atomically (all-or-none), with optimistic concurrency. */
	async applyMeetingChangeSet(input) {
		const proposal = meetingChangeSetProposalSchema.parse(input.proposal);
		const approval = meetingChangeSetApprovalSchema.parse(input.approval);
		if (approval.changeSetId !== proposal.changeSetId) throw new Error("Approval does not match the proposal.");
		if (approval.opportunityId !== proposal.opportunityId) throw new Error("Approval targets a different opportunity.");
		this.assertOpportunityAccess(proposal.opportunityId);
		const approvedSlots = proposal.slots.filter((slot) => approval.approvedSlotIds.includes(slot.slotId));
		const oppSnapshot = this.buildOpportunitySnapshot(this.store.get("SELECT * FROM opportunity WHERE id = ?", proposal.opportunityId));
		const conflicts = /* @__PURE__ */ new Set();
		for (const slot of approvedSlots) {
			const entry = MEETING_FIELD_DICTIONARY[slot.targetField];
			if (!entry || entry.append) continue;
			let current;
			if (slot.targetKind === "opportunity") current = oppSnapshot.fields[slot.targetField];
			else if (slot.targetKind === "milestone" && slot.targetRecordId) {
				if (!approval.selectedMilestoneIds.includes(slot.targetRecordId)) continue;
				const milestoneRow = this.store.get("SELECT * FROM engagement_milestone WHERE id = ?", slot.targetRecordId);
				current = milestoneRow ? this.buildMilestoneSnapshot(milestoneRow).fields[slot.targetField] : void 0;
			} else continue;
			if (!this.concurrencyMatches(entry, slot.before, current)) conflicts.add(slot.slotId);
		}
		if (conflicts.size > 0) return meetingChangeSetResultSchema.parse({
			changeSetId: proposal.changeSetId,
			state: "rolled-back",
			items: this.buildResultItems(proposal, approval, {
				conflicts,
				applied: /* @__PURE__ */ new Set()
			}),
			auditNote: `Rolled back: ${conflicts.size} field(s) changed since review; no updates applied.`
		});
		const applied = /* @__PURE__ */ new Set();
		const appliedMilestones = /* @__PURE__ */ new Set();
		this.store.exec("BEGIN");
		try {
			for (const slot of approvedSlots) {
				const entry = MEETING_FIELD_DICTIONARY[slot.targetField];
				if (!entry) continue;
				if (slot.targetKind === "opportunity") {
					this.applyOpportunityField(proposal.opportunityId, entry, slot.after);
					applied.add(slot.slotId);
				} else if (slot.targetKind === "milestone" && slot.targetRecordId && approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
					this.applyMilestoneField(slot.targetRecordId, entry, slot.after);
					applied.add(slot.slotId);
				}
			}
			for (const milestone of proposal.newMilestones) {
				if (!approval.approvedNewMilestoneTempIds.includes(milestone.tempId)) continue;
				this.insertNewMilestone(proposal.opportunityId, milestone.name, milestone.milestoneDate, milestone.commitment);
				appliedMilestones.add(milestone.tempId);
			}
			const auditNote = `Meeting inject (${proposal.meetingType}): applied ${applied.size} field update(s) and ${appliedMilestones.size} new milestone(s). Reason: ${approval.reason}`;
			const descRow = this.store.get("SELECT description FROM opportunity WHERE id = ?", proposal.opportunityId);
			const commentEntry = formatCommentEntry(this.userInitials(), auditNote);
			this.store.run("UPDATE opportunity SET description = ? WHERE id = ?", prependComment(str(descRow?.["description"]), commentEntry), proposal.opportunityId);
			this.store.exec("COMMIT");
		} catch (error) {
			this.store.exec("ROLLBACK");
			throw error;
		}
		return meetingChangeSetResultSchema.parse({
			changeSetId: proposal.changeSetId,
			state: "applied",
			items: this.buildResultItems(proposal, approval, {
				conflicts: /* @__PURE__ */ new Set(),
				applied,
				appliedMilestones
			}),
			auditNote: `Meeting inject (${proposal.meetingType}): applied ${applied.size} field update(s) and ${appliedMilestones.size} new milestone(s). Reason: ${approval.reason}`
		});
	}
};
/**
* Factory for sample/test mode: returns a local-store-backed connector when
* `TLC_DATA_STORE=sqlite`, else `undefined` so the caller keeps its existing fixture.
*/
function createLocalStoreMsxConnector(environment = process.env) {
	if ((environment["TLC_DATA_STORE"] ?? "").toLowerCase() !== "sqlite") return void 0;
	const path = environment["TLC_DATA_STORE_PATH"]?.trim();
	return new LocalStoreMsxConnector(new LocalStore(path ? { path } : {}));
}
//#endregion
//#region packages/connectors/sharepoint/local-pdf.ts
var stageCriteria = {
	1: [
		{
			id: "budget",
			label: "Budget availability",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Validate available funding or the process and timing required to request it.",
			rationale: "The MCEM Overview requires budget, outcomes, approval, and timing before an opportunity is qualified."
		},
		{
			id: "customer-outcome",
			label: "Customer outcomes",
			ownerRole: "ATS",
			actionWhenMissing: "Identify the expected outcomes, returns, KPIs, or capabilities and their priority for the customer.",
			rationale: "Customer outcomes connect the opportunity to measurable business priorities."
		},
		{
			id: "approval",
			label: "Approval process",
			ownerRole: "Account Executive",
			actionWhenMissing: "Identify the stakeholders, decision makers, sponsor, and approval path.",
			rationale: "Qualification requires a known approval process and sponsorship."
		},
		{
			id: "timing",
			label: "Decision and implementation timing",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Confirm funding, decision, purchase, and implementation timing plus any compelling event.",
			rationale: "Qualification requires a credible timeline and reason to act."
		}
	],
	2: [
		{
			id: "customer-outcome",
			label: "Customer value is quantified",
			ownerRole: "ATS",
			actionWhenMissing: "Quantify the customer outcomes, value hypothesis, and measures of success.",
			rationale: "Stage 2 must establish a credible customer value case before execution begins."
		},
		{
			id: "decision-team",
			label: "Customer and Microsoft teams are aligned",
			ownerRole: "Account Executive",
			actionWhenMissing: "Confirm sponsors, decision makers, technical stakeholders, and Microsoft owners.",
			rationale: "The design must have an aligned decision team and accountable v-team."
		},
		{
			id: "technical-validation",
			label: "Solution and technical fit are credible",
			ownerRole: "Solution Engineer (SE)",
			actionWhenMissing: "Validate solution fit, technical feasibility, risks, and the evidence plan.",
			rationale: "Technical fit and a credible validation route are required to progress."
		},
		{
			id: "business-case",
			label: "Business case and execution plans are credible",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Document the business case, commercial path, success plan, and required resources.",
			rationale: "The customer and account team need a credible plan to achieve the stated value."
		},
		{
			id: "next-step",
			label: "Delivery route is agreed",
			ownerRole: "CSA / CSAM",
			actionWhenMissing: "Name the delivery route, owners, next commitment, and target date.",
			rationale: "Progression requires a practical delivery path, not only a solution concept."
		}
	],
	3: [
		{
			id: "customer-outcome",
			label: "Customer agreement is documented",
			ownerRole: "ATS",
			actionWhenMissing: "Capture customer agreement on scope, outcomes, measures, and implementation intent.",
			rationale: "Stage 3 closes only when customer agreement is explicit."
		},
		{
			id: "decision-team",
			label: "Committed pipeline is confirmed",
			ownerRole: "Account Executive",
			actionWhenMissing: "Confirm commercial commitment, pipeline state, accountable owners, and dates.",
			rationale: "The opportunity must be commercially committed before handoff."
		},
		{
			id: "technical-validation",
			label: "Technical close is complete",
			ownerRole: "Solution Engineer (SE)",
			actionWhenMissing: "Close technical validation, risks, architecture decisions, and acceptance criteria.",
			rationale: "All material technical questions must be closed or explicitly accepted."
		},
		{
			id: "business-case",
			label: "Value and delivery commitments are approved",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Confirm the approved value case, funding, delivery scope, and commitments.",
			rationale: "Execution must be backed by an approved customer and commercial commitment."
		},
		{
			id: "next-step",
			label: "CSU handoff is accepted",
			ownerRole: "CSA / CSAM",
			actionWhenMissing: "Complete and obtain acceptance of the delivery handoff, owners, dependencies, and first milestones.",
			rationale: "The receiving delivery team must accept an actionable handoff."
		}
	],
	4: [
		{
			id: "customer-outcome",
			label: "Measurable business value is demonstrated",
			ownerRole: "CSAM",
			actionWhenMissing: "Measure realized outcomes against the customer-approved baseline and targets.",
			rationale: "Stage 4 must demonstrate customer value, not merely deployment completion."
		},
		{
			id: "decision-team",
			label: "Adoption owners and governance are active",
			ownerRole: "CSAM",
			actionWhenMissing: "Activate customer adoption owners and a recurring value governance rhythm.",
			rationale: "Scaling requires active customer ownership and governance."
		},
		{
			id: "technical-validation",
			label: "Production solution is healthy and scalable",
			ownerRole: "Cloud Solution Architect",
			actionWhenMissing: "Validate production health, capacity, reliability, security, and scale readiness.",
			rationale: "The implemented solution must be able to sustain and expand realized value."
		},
		{
			id: "business-case",
			label: "Scale case is validated",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Validate the economic case and customer commitment for broader adoption or consumption.",
			rationale: "Scale must be justified by measurable outcomes and a credible economic case."
		},
		{
			id: "next-step",
			label: "Optimization plan is agreed",
			ownerRole: "CSAM",
			actionWhenMissing: "Agree the next adoption, optimization, and value-realization milestones.",
			rationale: "Stage 5 begins with an owned plan to manage and optimize value."
		}
	],
	5: [
		{
			id: "customer-outcome",
			label: "Value realization remains measurable",
			ownerRole: "CSAM",
			actionWhenMissing: "Refresh outcome measures, baselines, and the customer value review.",
			rationale: "Manage and Optimize continuously measures realized business value."
		},
		{
			id: "decision-team",
			label: "Customer governance remains engaged",
			ownerRole: "CSAM",
			actionWhenMissing: "Re-engage accountable customer stakeholders and Microsoft owners.",
			rationale: "Sustained value depends on active customer governance."
		},
		{
			id: "technical-validation",
			label: "Service health and optimization are managed",
			ownerRole: "Cloud Solution Architect",
			actionWhenMissing: "Review operational health, optimization opportunities, and technical risks.",
			rationale: "The deployed capability must remain healthy, efficient, and fit for evolving needs."
		},
		{
			id: "business-case",
			label: "Expansion signals are value-backed",
			ownerRole: "Specialist / SSP",
			actionWhenMissing: "Tie any expansion signal to a new customer question, workload, and measurable value.",
			rationale: "Expansion should create a new qualified opportunity rather than silently extending Stage 5."
		},
		{
			id: "next-step",
			label: "Next lifecycle action is explicit",
			ownerRole: "Account Executive",
			actionWhenMissing: "Remain in Stage 5, recycle to Stage 4 for a value-health gap, or qualify a new opportunity at Stage 1 or 2.",
			rationale: "Stage 5 has no automatic Stage 6; the next lifecycle action must be explicit."
		}
	]
};
var stageTitles = [
	"Listen & Consult",
	"Inspire & Design",
	"Empower & Achieve",
	"Realize Value",
	"Manage & Optimize"
];
var LocalPdfMcemGuidanceConnector = class {
	pdfPath;
	sourcePromise;
	constructor(pdfPath) {
		this.pdfPath = pdfPath;
	}
	async getStageGuidance(stage) {
		const source = await (this.sourcePromise ??= this.loadSource());
		return {
			stage,
			title: `MCEM Stage ${stage}: ${stageTitles[stage - 1] ?? "Guidance"}`,
			version: source.version,
			effectiveDate: source.effectiveDate,
			criteria: structuredClone(stageCriteria[stage] ?? []),
			sourceHealth: {
				source: "mcem",
				state: "partial",
				detail: "Stage gates use the supplied MCEM Stage Gates and Role Matrix; docs/knowledge/MCEM Overview.pdf validates the local guidance source. No live SharePoint request was made.",
				checkedAt: source.checkedAt
			}
		};
	}
	async loadSource() {
		const file = await stat(this.pdfPath);
		const parser = new PDFParse({ url: new URL(`file://${this.pdfPath.replaceAll("\\", "/")}`).toString() });
		try {
			const { text } = await parser.getText();
			if (!text.includes("MCEM Overview") || !text.includes("Budget, Outcomes, Approval, and Timing")) throw new Error("The configured PDF does not contain the expected MCEM Overview content.");
		} finally {
			await parser.destroy();
		}
		const checkedAt = file.mtime.toISOString();
		const effectiveDate = checkedAt.slice(0, 10);
		return {
			checkedAt,
			effectiveDate,
			version: `local-snapshot-${effectiveDate}`
		};
	}
};
//#endregion
//#region packages/connectors/foundry/index.ts
function createFoundryOpenAIClient(projectEndpoint, credential) {
	return new AIProjectClient(projectEndpoint, credential).getOpenAIClient();
}
var FoundryPromptAgent = class {
	options;
	openAIClient;
	constructor(options) {
		this.options = options;
		this.openAIClient = options.openAIClient ?? createFoundryOpenAIClient(options.projectEndpoint, options.credential);
	}
	async invoke(context) {
		const abortController = new AbortController();
		const timeout = setTimeout(() => abortController.abort(), this.options.requestTimeoutMs);
		try {
			const response = await this.openAIClient.responses.create({ input: JSON.stringify(context) }, {
				body: { agent_reference: {
					name: this.options.agentName,
					type: "agent_reference"
				} },
				signal: abortController.signal
			});
			if (!response.output_text?.trim()) throw new Error(`Foundry agent ${this.options.agentName} returned no text output.`);
			return response.output_text.trim();
		} finally {
			clearTimeout(timeout);
		}
	}
};
//#endregion
//#region packages/agents/mcem-coach/src/milestone-signals.ts
var RISK_STATUSES = /* @__PURE__ */ new Set(["at risk", "blocked"]);
var UNCOMMITTED = "uncommitted";
var MAX_ATTENTION = 3;
function slug(value) {
	const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned.length > 0 ? cleaned : "item";
}
function evaluateMilestone(milestone) {
	const status = milestone.status?.trim() || "In Progress";
	const normalizedStatus = status.toLowerCase();
	const normalizedCommitment = milestone.commitment?.trim().toLowerCase();
	const reasons = [];
	let severity = 0;
	if (normalizedStatus === "blocked") {
		reasons.push("status is Blocked");
		severity += 3;
	} else if (RISK_STATUSES.has(normalizedStatus)) {
		reasons.push(`status is ${status}`);
		severity += 2;
	}
	if (normalizedCommitment === UNCOMMITTED) {
		reasons.push("customer commitment is Uncommitted");
		severity += 2;
	}
	if (reasons.length === 0) return void 0;
	const ownerRole = RISK_STATUSES.has(normalizedStatus) ? "Solution Engineer" : "Account Executive";
	const confidence = normalizedStatus === "blocked" ? "high" : "medium";
	return {
		name: milestone.name,
		status,
		commitment: milestone.commitment,
		targetDate: milestone.targetDate,
		reasons,
		ownerRole,
		confidence,
		severity
	};
}
/** Derives the milestones that threaten stage progression, ordered by severity. */
function summarizeMilestones(milestones) {
	const attention = milestones.map((milestone) => evaluateMilestone(milestone)).filter((item) => item !== void 0).sort((left, right) => right.severity - left.severity).slice(0, MAX_ATTENTION);
	const headline = attention.length === 0 ? "" : `${attention.length} of ${milestones.length} milestone${milestones.length === 1 ? "" : "s"} need attention: ${attention.map((item) => `${item.name} (${item.reasons.join("; ")})`).join(", ")}.`;
	return {
		total: milestones.length,
		attention,
		headline
	};
}
/** Builds role-owned, milestone-grounded recommendations from a milestone summary. */
function milestoneRecommendations(summary, evidenceIds) {
	return summary.attention.map((item, index) => {
		const targetClause = item.targetDate ? `, target ${item.targetDate}` : "";
		const commitmentClause = item.commitment ? `, commitment ${item.commitment}` : "";
		return {
			id: `recommendation-milestone-${slug(item.name)}-${index + 1}`,
			action: `Resolve milestone "${item.name}" (${item.reasons.join("; ")}): confirm the owner, mitigation, and customer commitment, then update MSX.`,
			ownerRole: item.ownerRole,
			rationale: `Milestone "${item.name}" is ${item.status}${commitmentClause}${targetClause}, which puts the current MCEM stage at risk until it is resolved.`,
			evidenceIds: [...evidenceIds],
			assumption: false,
			confidence: item.confidence
		};
	});
}
//#endregion
//#region packages/agents/mcem-coach/src/index.ts
var mcemCoachVersion = "0.1.0";
function evaluateMcemProgress(context, guidance, correlationId = randomUUID()) {
	const msxEvidenceId = `msx-${context.opportunity.id}`;
	const guidanceEvidenceId = `mcem-stage-${guidance.stage}`;
	const observationExcerpt = context.observations.map((observation) => `${observation.criterionId}: ${observation.detail}`).join(" ") || "No criterion-level observations were available from MSX for this opportunity.";
	const observations = new Map(context.observations.map((observation) => [observation.criterionId, observation]));
	const criteria = guidance.criteria.map((criterion) => {
		const observation = observations.get(criterion.id);
		return {
			id: criterion.id,
			label: criterion.label,
			status: observation?.status ?? "missing",
			rationale: observation?.detail ?? "No supporting record was found.",
			evidenceIds: [msxEvidenceId, guidanceEvidenceId]
		};
	});
	const gaps = criteria.filter((criterion) => criterion.status !== "met");
	const gapRecommendations = gaps.map((gap) => {
		const criterion = guidance.criteria.find((candidate) => candidate.id === gap.id);
		if (!criterion) throw new Error(`Guidance missing for criterion: ${gap.id}`);
		return {
			id: `recommendation-${gap.id}`,
			action: criterion.actionWhenMissing,
			ownerRole: criterion.ownerRole,
			rationale: `${criterion.rationale} Current evidence: ${gap.rationale}`,
			evidenceIds: [msxEvidenceId, guidanceEvidenceId],
			assumption: false,
			confidence: gap.status === "missing" ? "high" : "medium"
		};
	});
	const evidenceBasedStage = gaps.length === 0 ? Math.min(5, context.opportunity.recordedStage + 1) : Math.max(1, context.opportunity.recordedStage - 1);
	const baseRecommendations = gaps.length === 0 ? [{
		id: "recommendation-advance-stage",
		action: evidenceBasedStage > context.opportunity.recordedStage ? `Review the completed exit criteria and advance the opportunity to Stage ${evidenceBasedStage} in MSX after customer confirmation.` : "Continue validating value realization and maintain current evidence in MSX.",
		ownerRole: "Account Executive",
		rationale: evidenceBasedStage > context.opportunity.recordedStage ? `All supplied Stage ${context.opportunity.recordedStage} exit criteria are met, supporting progression to Stage ${evidenceBasedStage}.` : "The opportunity is already at the highest supported MCEM stage.",
		evidenceIds: [msxEvidenceId, guidanceEvidenceId],
		assumption: false,
		confidence: "high"
	}] : gapRecommendations;
	const milestoneSummary = summarizeMilestones(context.milestones ?? []);
	const milestoneRecs = milestoneRecommendations(milestoneSummary, [msxEvidenceId, guidanceEvidenceId]);
	const recommendations = [...baseRecommendations, ...milestoneRecs];
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const baseSummary = evidenceBasedStage > context.opportunity.recordedStage ? `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the completed exit criteria support progression to Stage ${evidenceBasedStage}.` : evidenceBasedStage === context.opportunity.recordedStage ? `The available evidence supports recorded Stage ${context.opportunity.recordedStage}.` : `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the available evidence supports Stage ${evidenceBasedStage}.`;
	const summary = milestoneSummary.headline ? `${baseSummary} ${milestoneSummary.headline}` : baseSummary;
	return mcemResponseSchema.parse({
		contractVersion: "1.0",
		correlationId,
		capability: "mcem-coach",
		agentVersion: mcemCoachVersion,
		generatedAt,
		mode: context.sourceHealth.state === "live" ? "live" : "sample",
		state: "complete",
		summary,
		recordedStage: context.opportunity.recordedStage,
		evidenceBasedStage,
		criteria,
		recommendations,
		missingData: criteria.filter((criterion) => criterion.status === "missing").map((criterion) => criterion.label),
		evidence: [{
			id: msxEvidenceId,
			source: "msx",
			recordId: context.opportunity.id,
			title: context.opportunity.name,
			url: `https://msx.microsoft.com/opportunity/${context.opportunity.id}`,
			retrievedAt: context.retrievedAt,
			accessContext: context.sourceHealth.state === "live" ? "delegated-user" : "sample",
			quality: "observed",
			excerpt: observationExcerpt
		}, {
			id: guidanceEvidenceId,
			source: "mcem",
			recordId: `stage-${guidance.stage}-${guidance.version}`,
			title: guidance.title,
			...guidance.sourceUrl ? { url: guidance.sourceUrl } : {},
			retrievedAt: generatedAt,
			modifiedAt: `${guidance.effectiveDate}T00:00:00.000Z`,
			accessContext: "sample",
			quality: "authoritative",
			excerpt: `Version ${guidance.version}; ${guidance.criteria.map((criterion) => criterion.label).join(", ")}.`
		}],
		sourceHealth: [context.sourceHealth, guidance.sourceHealth]
	});
}
//#endregion
//#region packages/orchestrator/policies/mcp-tool-authorization.ts
var McpToolAuthorizationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "McpToolAuthorizationError";
	}
};
var destructiveToolName = /^(delete|drop|truncate)(_|$)/i;
function authorizeMcpTool(policy, request) {
	if (destructiveToolName.test(request.tool)) throw new McpToolAuthorizationError("tool_denied", "Destructive MCP tools are forbidden.");
	const entry = policy.entries.find((candidate) => candidate.serverId === request.serverId && candidate.tool === request.tool);
	if (!entry || !entry.enabled || entry.riskClass === "forbidden") throw new McpToolAuthorizationError("tool_denied", "MCP tool invocation is not allowed.");
	if (!entry.allowedCapabilities.includes(request.capability)) throw new McpToolAuthorizationError("capability_denied", "Agent capability is not allowed to invoke this MCP tool.");
	if (!entry.allowedScopes.includes(request.scope)) throw new McpToolAuthorizationError("scope_denied", "Request scope is not allowed for this MCP tool.");
	if (entry.riskClass === "write" || entry.approval !== "none") {
		if (!request.approval?.confirmed) throw new McpToolAuthorizationError("approval_required", "MCP tool invocation requires user approval.");
		if (entry.approval === "confirm-with-reason" && !request.approval.reason?.trim()) throw new McpToolAuthorizationError("approval_required", "MCP tool invocation requires an approval reason.");
	}
	return entry;
}
//#endregion
//#region packages/orchestrator/progress/run-history.ts
var WorkflowRunHistory = class {
	runs = /* @__PURE__ */ new Map();
	capacity;
	onEvicted;
	constructor(options = {}) {
		this.capacity = options.capacity ?? 100;
		if (!Number.isInteger(this.capacity) || this.capacity < 1) throw new Error("Workflow run history capacity must be a positive integer.");
		this.onEvicted = options.onEvicted;
	}
	set(run) {
		const validated = workflowRunSchema.parse(run);
		if (!this.runs.has(validated.runId) && this.runs.size >= this.capacity) {
			const oldestRunId = this.runs.keys().next().value;
			if (oldestRunId) {
				const evicted = this.runs.get(oldestRunId);
				this.runs.delete(oldestRunId);
				if (evicted) this.onEvicted?.(structuredClone(evicted));
			}
		}
		this.runs.set(validated.runId, structuredClone(validated));
	}
	get(runId) {
		const run = this.runs.get(runId);
		return run ? structuredClone(run) : void 0;
	}
	list(scope, limit = this.capacity) {
		if (!Number.isInteger(limit) || limit < 1) throw new Error("Workflow run history limit must be a positive integer.");
		return [...this.runs.values()].filter((run) => scope === void 0 || sameScope(run.scope, scope)).reverse().slice(0, limit).map((run) => structuredClone(run));
	}
};
function sameScope(left, right) {
	if (left.kind !== right.kind) return false;
	if (left.kind === "portfolio" && right.kind === "portfolio") return true;
	if (left.kind === "account" && right.kind === "account") return left.accountId === right.accountId;
	return left.kind === "opportunity" && right.kind === "opportunity" && left.accountId === right.accountId && left.opportunityId === right.opportunityId;
}
//#endregion
//#region packages/orchestrator/routing/mcp-tool-broker.ts
var recordArrayKeys = /* @__PURE__ */ new Set([
	"items",
	"records",
	"rows",
	"value"
]);
var McpToolBroker = class {
	registry;
	policy;
	invokeTool;
	now;
	maxJournalEntries;
	journal = [];
	rateWindows = /* @__PURE__ */ new Map();
	requestCallCounts = /* @__PURE__ */ new Map();
	constructor(options) {
		this.registry = mcpServerRegistrySchema.parse(options.registry);
		this.policy = mcpToolPolicySchema.parse(options.policy);
		this.invokeTool = options.invokeTool;
		this.now = options.now ?? Date.now;
		this.maxJournalEntries = options.maxJournalEntries ?? 1e3;
		if (!Number.isInteger(this.maxJournalEntries) || this.maxJournalEntries < 1) throw new Error("MCP invocation journal capacity must be a positive integer.");
	}
	async execute(request) {
		const startedAt = this.now();
		let recordCount = 0;
		let truncated = false;
		let outcome = "failed";
		let failureCode;
		try {
			const server = this.registry.servers.find((candidate) => candidate.id === request.serverId);
			if (!server?.enabled) throw new McpToolAuthorizationError("tool_denied", "MCP server invocation is not allowed.");
			const entry = authorizeMcpTool(this.policy, request);
			this.consumeRequestBudget(request.correlationId, server.limits.maxToolCallsPerRequest);
			this.consumeRateBudget(request.serverId, request.tool, entry.rateLimitPerMinute);
			const rawResult = await this.invokeTool(request.serverId, request.tool, request.arguments, request.signal);
			const stats = {
				recordCount: 0,
				truncated: false
			};
			const maxRows = Math.min(entry.maxRows ?? server.limits.maxRowsPerCall, server.limits.maxRowsPerCall);
			const data = sanitizeValue(rawResult, new Set(entry.redactFields.map((field) => field.toLowerCase())), maxRows, stats);
			recordCount = stats.recordCount;
			truncated = stats.truncated;
			outcome = "success";
			return {
				kind: "untrusted-mcp-data",
				data,
				recordCount,
				truncated
			};
		} catch (error) {
			outcome = error instanceof McpToolAuthorizationError ? "denied" : "failed";
			failureCode = getFailureCode(error);
			throw error;
		} finally {
			this.appendJournal({
				correlationId: request.correlationId,
				serverId: request.serverId,
				tool: request.tool,
				capability: request.capability,
				scope: request.scope,
				outcome,
				durationMs: Math.max(0, this.now() - startedAt),
				recordCount,
				truncated,
				occurredAt: new Date(this.now()).toISOString(),
				...failureCode ? { failureCode } : {}
			});
		}
	}
	completeRequest(correlationId) {
		this.requestCallCounts.delete(correlationId);
	}
	getJournal() {
		return this.journal.map((entry) => ({ ...entry }));
	}
	consumeRequestBudget(correlationId, maximum) {
		const nextCount = (this.requestCallCounts.get(correlationId) ?? 0) + 1;
		if (nextCount > maximum) throw new McpToolAuthorizationError("tool_denied", "MCP tool-call limit exceeded for this request.");
		this.requestCallCounts.set(correlationId, nextCount);
	}
	consumeRateBudget(serverId, tool, maximum) {
		if (maximum === void 0) return;
		const key = `${serverId}:${tool}`;
		const cutoff = this.now() - 6e4;
		const timestamps = (this.rateWindows.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
		if (timestamps.length >= maximum) throw new McpToolAuthorizationError("tool_denied", "MCP tool rate limit exceeded.");
		timestamps.push(this.now());
		this.rateWindows.set(key, timestamps);
	}
	appendJournal(entry) {
		this.journal.push(entry);
		if (this.journal.length > this.maxJournalEntries) this.journal.splice(0, this.journal.length - this.maxJournalEntries);
	}
};
function sanitizeValue(value, redactedFields, maxRows, stats, key) {
	if (typeof value === "string") {
		const parsed = tryParseJson(value);
		return parsed === void 0 ? value : JSON.stringify(sanitizeValue(parsed, redactedFields, maxRows, stats));
	}
	if (Array.isArray(value)) {
		const isRecordArray = key === void 0 || recordArrayKeys.has(key.toLowerCase());
		if (isRecordArray) {
			stats.recordCount = Math.max(stats.recordCount, value.length);
			stats.truncated ||= value.length > maxRows;
		}
		return (isRecordArray ? value.slice(0, maxRows) : value).map((item) => sanitizeValue(item, redactedFields, maxRows, stats));
	}
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [field, redactedFields.has(field.toLowerCase()) ? "[REDACTED]" : sanitizeValue(fieldValue, redactedFields, maxRows, stats, field)]));
}
function tryParseJson(value) {
	const trimmed = value.trim();
	if ((!trimmed.startsWith("{") || !trimmed.endsWith("}")) && (!trimmed.startsWith("[") || !trimmed.endsWith("]"))) return void 0;
	try {
		return JSON.parse(trimmed);
	} catch {
		return;
	}
}
function getFailureCode(error) {
	if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
	return "unknown";
}
//#endregion
//#region packages/orchestrator/workflows/cohort.ts
var initialWorkflowIds = [
	"WF-001",
	"WF-002",
	"WF-003",
	"WF-004",
	"WF-005",
	"WF-006",
	"WF-007",
	"WF-008",
	"WF-009",
	"WF-010",
	"WF-011",
	"WF-012"
];
var asOfSchema = z.string().date();
var initialWorkflowInputSchemas = {
	"WF-001": z.object({
		asOf: asOfSchema,
		staleAfterDays: z.number().int().min(1).max(365).default(30)
	}).strict(),
	"WF-002": z.object({ asOf: asOfSchema }).strict(),
	"WF-003": z.object({ asOf: asOfSchema }).strict(),
	"WF-004": z.object({ asOf: asOfSchema }).strict(),
	"WF-005": z.object({
		asOf: asOfSchema,
		lookbackDays: z.number().int().min(1).max(90).default(7)
	}).strict(),
	"WF-006": z.object({ asOf: asOfSchema }).strict(),
	"WF-007": z.object({
		asOf: asOfSchema,
		meetingWindowDays: z.number().int().min(1).max(90).default(14)
	}).strict(),
	"WF-008": z.object({ asOf: asOfSchema }).strict(),
	"WF-009": z.object({
		asOf: asOfSchema,
		maximumActiveItems: z.number().int().min(1).max(100).default(20)
	}).strict(),
	"WF-010": z.object({
		asOf: asOfSchema,
		followUpAfterDays: z.number().int().min(1).max(90).default(14)
	}).strict(),
	"WF-011": z.object({ asOf: asOfSchema }).strict(),
	"WF-012": z.object({ asOf: asOfSchema }).strict()
};
var workflowQueueItemSchema = z.object({
	id: z.string().min(1),
	workflowId: z.enum(initialWorkflowIds),
	priority: z.enum([
		"P0",
		"P1",
		"P2"
	]),
	title: z.string().min(1),
	owner: z.string().min(1).optional(),
	accountId: z.string().min(1).optional(),
	accountName: z.string().min(1).optional(),
	opportunityId: z.string().min(1).optional(),
	opportunityName: z.string().min(1).optional(),
	dueDate: z.string().date().optional(),
	evidenceIds: z.array(z.string().min(1)),
	status: z.literal("new")
}).strict();
var initialWorkflowOutputSchema = z.object({
	contractVersion: z.literal("1.0"),
	workflowId: z.enum(initialWorkflowIds),
	generatedAt: z.string().datetime(),
	scope: scopeRefSchema,
	card: workflowResultCardSchema,
	queueItems: z.array(workflowQueueItemSchema),
	lineage: z.array(mcpEvidenceLineageSchema).min(1),
	sourceHealth: z.array(sourceHealthSchema).min(1)
}).strict();
function parseInitialWorkflowInput(workflowId, input) {
	return initialWorkflowInputSchemas[workflowId].parse(input);
}
var initialWorkflowDefinitions = Object.freeze([
	createDefinition("WF-001", "Stale opportunity sweep", ["AE", "Manager"], "portfolio-hygiene", "record-table", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-002", "Overdue milestone triage", ["Specialist", "SE"], "portfolio-hygiene", "action-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-003", "Stage-evidence mismatch queue", ["Specialist", "ATS"], "stage-governance", "exception-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-004", "Missing stakeholder map", ["AE", "ATS"], "account-planning", "action-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}]),
	createDefinition("WF-005", "Weekly governance exceptions", ["Manager"], "governance", "exception-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-006", "Commit-risk conflict list", ["Manager", "CSAM"], "forecast-readiness", "record-table", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "get_forecast_snapshot",
		required: false
	}]),
	createDefinition("WF-007", "Next-meeting prep pack", ["AE", "ATS"], "meeting-preparation", "record-table", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-008", "Pipeline concentration risk", ["Manager"], "forecast-readiness", "metric-strip", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}]),
	createDefinition("WF-009", "Owner workload imbalance", ["Manager"], "ownership", "metric-strip", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-010", "Activity follow-up debt", ["Seller", "SE"], "activity-compliance", "action-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}]),
	createDefinition("WF-011", "Opportunity dependency graph", ["Manager"], "portfolio-hygiene", "record-table", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}]),
	createDefinition("WF-012", "Stage exit evidence packet", ["Specialist", "SE"], "stage-governance", "action-list", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}, {
		connector: "msx-mcp",
		operation: "list_pipeline",
		required: false
	}])
].map((definition) => workflowDefinitionSchema.parse(definition)));
function createDefinition(id, name, personaTargets, category, cardStyle, connectorPlan, executionMode = connectorPlan.length > 1 ? "composite" : "deterministic") {
	return {
		contractVersion: "1.0",
		id,
		name,
		version: "1.0.0",
		scope: "portfolio",
		personaTargets,
		category,
		executionMode,
		connectorPlan,
		inputSchemaRef: `workflow-input-${id.toLowerCase()}.v1`,
		outputSchemaRef: `workflow-output-${id.toLowerCase()}.v1`,
		sla: {
			targetMs: 4e3,
			timeoutMs: 12e3
		},
		auth: {
			requiresDelegatedUser: true,
			allowedWrite: false
		},
		ui: {
			cardStyle,
			resultPriority: "high",
			showInQuickLaunch: true
		}
	};
}
//#endregion
//#region packages/orchestrator/workflows/cohort-executor.ts
var InitialWorkflowConnectorExecutor = class {
	dataverse;
	msx;
	resolveDelegatedScope;
	constructor(dataverse, msx, resolveDelegatedScope) {
		this.dataverse = dataverse;
		this.msx = msx;
		this.resolveDelegatedScope = resolveDelegatedScope;
	}
	async execute(step, context) {
		const workflowId = requireInitialWorkflowId(context.workflowId);
		const input = parseInitialWorkflowInput(workflowId, context.input);
		if (step.connector === "dataverse-mcp") {
			const result = await this.dataverse.query(buildInitialWorkflowQuery(workflowId, input), {
				correlationId: context.correlationId,
				capability: "account-pulse",
				scope: context.scope,
				delegatedScope: await this.resolveDelegatedScope(context.scope),
				signal: context.signal
			});
			return {
				state: result.state,
				data: result.records,
				rowCount: result.recordCount,
				truncated: result.truncated,
				lineage: result.lineage,
				sourceHealth: result.sourceHealth
			};
		}
		const msxContext = {
			correlationId: context.correlationId,
			capability: "account-pulse",
			signal: context.signal
		};
		return fromMsxResult(step.operation === "get_forecast_snapshot" ? await this.msx.getForecastSnapshot({}, msxContext) : await this.msx.listPipeline({}, msxContext));
	}
};
var InitialWorkflowResultAssembler = class {
	assemble(context) {
		const workflowId = requireInitialWorkflowId(context.definition.id);
		const input = parseInitialWorkflowInput(workflowId, context.input);
		const ordered = [...reconcileRecords(rows(context.steps.find(({ connector }) => connector === "dataverse-mcp")?.data), rows(context.steps.find(({ connector }) => connector === "msx-mcp")?.data))].sort(compareRecords);
		const lineage = context.steps.flatMap((step) => step.lineage ? [step.lineage] : []);
		const sourceHealth = context.steps.flatMap((step) => step.sourceHealth ? [step.sourceHealth] : []);
		const evidenceIds = lineage.map(({ toolCallId }) => toolCallId);
		const queueItems = buildQueueItems(workflowId, ordered, input, evidenceIds);
		return initialWorkflowOutputSchema.parse({
			contractVersion: "1.0",
			workflowId,
			generatedAt: context.generatedAt,
			scope: context.scope,
			card: buildCard(workflowId, context.definition.name, ordered, queueItems, evidenceIds),
			queueItems,
			lineage,
			sourceHealth
		});
	}
};
function buildInitialWorkflowQuery(workflowId, input) {
	switch (workflowId) {
		case "WF-001": return {
			entity: "opportunity",
			select: [
				"id",
				"accountId",
				"name",
				"closeDate"
			],
			filter: [{
				field: "closeDate",
				operator: "on-or-before",
				value: subtractDays(input.asOf, input.staleAfterDays ?? 30)
			}],
			orderBy: [{
				field: "closeDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-002": return milestoneQuery(input.asOf, [{
			field: "status",
			operator: "ne",
			value: "Completed"
		}]);
		case "WF-003": return milestoneQuery(input.asOf, [{
			field: "status",
			operator: "ne",
			value: "Completed"
		}]);
		case "WF-005": return milestoneQuery(input.asOf, [{
			field: "status",
			operator: "in",
			value: ["At Risk", "Blocked"]
		}]);
		case "WF-006": return {
			entity: "opportunity",
			select: [
				"id",
				"accountId",
				"name",
				"closeDate"
			],
			filter: [],
			orderBy: [{
				field: "closeDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-007": return {
			entity: "activity",
			select: [
				"id",
				"opportunityId",
				"subject",
				"ownerId",
				"dueDate",
				"status"
			],
			filter: [{
				field: "dueDate",
				operator: "on-or-after",
				value: input.asOf
			}, {
				field: "dueDate",
				operator: "on-or-before",
				value: addDays(input.asOf, input.meetingWindowDays ?? 14)
			}],
			orderBy: [{
				field: "dueDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-009": return {
			entity: "opportunity",
			select: [
				"id",
				"accountId",
				"name",
				"ownerId",
				"closeDate"
			],
			filter: [],
			orderBy: [{
				field: "ownerId",
				direction: "asc"
			}, {
				field: "closeDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-010": return {
			entity: "activity",
			select: [
				"id",
				"opportunityId",
				"subject",
				"ownerId",
				"dueDate",
				"status"
			],
			filter: [{
				field: "dueDate",
				operator: "on-or-before",
				value: subtractDays(input.asOf, input.followUpAfterDays ?? 14)
			}, {
				field: "status",
				operator: "ne",
				value: "Completed"
			}],
			orderBy: [{
				field: "dueDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-012": return milestoneQuery(input.asOf, []);
		case "WF-004":
		case "WF-008": return {
			entity: "opportunity",
			select: [
				"id",
				"accountId",
				"name",
				"closeDate"
			],
			filter: [],
			orderBy: [{
				field: "closeDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
		case "WF-011": return {
			entity: "opportunity",
			select: [
				"id",
				"accountId",
				"name",
				"closeDate"
			],
			filter: [],
			orderBy: [{
				field: "accountId",
				direction: "asc"
			}, {
				field: "closeDate",
				direction: "asc"
			}],
			top: 500,
			expand: []
		};
	}
}
function milestoneQuery(asOf, extraFilters) {
	return {
		entity: "engagementMilestone",
		select: [
			"id",
			"opportunityId",
			"name",
			"status",
			"targetDate"
		],
		filter: [{
			field: "targetDate",
			operator: "on-or-before",
			value: asOf
		}, ...extraFilters],
		orderBy: [{
			field: "targetDate",
			direction: "asc"
		}],
		top: 500,
		expand: []
	};
}
function buildCard(workflowId, title, records, queueItems, evidenceIds) {
	if (workflowId === "WF-003" || workflowId === "WF-005") return {
		kind: "exception-list",
		title,
		evidenceIds,
		exceptions: queueItems.map((item) => ({
			id: item.id,
			title: item.title,
			priority: item.priority,
			detail: `${workflowId === "WF-003" ? "Recorded stage and available evidence require review" : "Status requires governance review"}${item.dueDate ? `; due ${item.dueDate}` : ""}.`,
			evidenceIds: item.evidenceIds
		}))
	};
	if (workflowId === "WF-002" || workflowId === "WF-004" || workflowId === "WF-010" || workflowId === "WF-012") return {
		kind: "action-list",
		title,
		evidenceIds,
		actions: queueItems.map((item) => ({
			id: item.id,
			label: item.title,
			priority: item.priority
		}))
	};
	if (workflowId === "WF-009") return {
		kind: "metric-strip",
		title,
		evidenceIds,
		metrics: [{
			label: "Overloaded owners",
			value: queueItems.length
		}, {
			label: "Active opportunities",
			value: records.length
		}]
	};
	if (workflowId === "WF-008") {
		const perAccount = /* @__PURE__ */ new Map();
		for (const record of records) perAccount.set(text(record.accountId) ?? "Unassigned", (perAccount.get(text(record.accountId) ?? "Unassigned") ?? 0) + 1);
		const topCount = perAccount.size > 0 ? Math.max(...perAccount.values()) : 0;
		return {
			kind: "metric-strip",
			title,
			evidenceIds,
			metrics: [
				{
					label: "Pipeline opportunities",
					value: records.length
				},
				{
					label: "Accounts",
					value: perAccount.size
				},
				{
					label: "Top account share %",
					value: records.length > 0 ? Math.round(topCount / records.length * 100) : 0
				}
			]
		};
	}
	const columns = workflowId === "WF-007" ? [
		"id",
		"opportunityId",
		"subject",
		"ownerId",
		"dueDate",
		"status"
	] : workflowId === "WF-001" ? [
		"id",
		"accountId",
		"name",
		"closeDate"
	] : [
		"id",
		"accountId",
		"name",
		"closeDate"
	];
	return {
		kind: "record-table",
		title,
		evidenceIds,
		columns,
		rows: records.map((record) => primitiveRow(record, columns))
	};
}
function buildQueueItems(workflowId, records, input, evidenceIds) {
	if (workflowId === "WF-009") {
		const threshold = input.maximumActiveItems ?? 20;
		const owners = /* @__PURE__ */ new Map();
		for (const record of records) {
			const ownerId = text(record.ownerId) ?? "unassigned";
			const ownerName = text(record.opportunityOwnerName) ?? (ownerId === "unassigned" ? "Unassigned owner" : "Owner name unavailable");
			const current = owners.get(ownerId);
			owners.set(ownerId, {
				count: (current?.count ?? 0) + 1,
				name: current?.name !== "Owner name unavailable" ? current?.name ?? ownerName : ownerName
			});
		}
		return [...owners.entries()].filter(([, owner]) => owner.count > threshold).sort(([, left], [, right]) => left.name.localeCompare(right.name)).map(([ownerId, owner]) => ({
			id: `${workflowId}:${ownerId}`,
			workflowId,
			priority: owner.count > threshold * 2 ? "P0" : "P1",
			title: `${owner.name} owns ${owner.count} active opportunities`,
			owner: owner.name,
			evidenceIds,
			status: "new"
		}));
	}
	return records.map((record, index) => {
		const recordId = text(record.id) ?? `${index + 1}`;
		const dueDate = date(record.targetDate) ?? date(record.dueDate) ?? date(record.closeDate);
		const opportunityId = text(record.opportunityId) ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.id) : void 0);
		const opportunityName = text(record.opportunityName) ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.name) : void 0);
		const owner = queueOwnerName(workflowId, record);
		return {
			id: `${workflowId}:${recordId}`,
			workflowId,
			priority: workflowId === "WF-003" && Number(record.recordedStage ?? 0) >= 4 || workflowId === "WF-005" && record.status === "Blocked" ? "P0" : "P1",
			title: queueTitle(workflowId, record),
			...owner ? { owner } : {},
			...text(record.accountId) ? { accountId: text(record.accountId) } : {},
			...text(record.accountName) ? { accountName: text(record.accountName) } : {},
			...opportunityId ? { opportunityId } : {},
			...opportunityName ? { opportunityName } : {},
			...dueDate ? { dueDate } : {},
			evidenceIds,
			status: "new"
		};
	});
}
var opportunityScopedWorkflows = /* @__PURE__ */ new Set([
	"WF-001",
	"WF-004",
	"WF-006",
	"WF-008",
	"WF-011"
]);
function queueOwnerName(workflowId, record) {
	return text(record.owner) ?? (opportunityScopedWorkflows.has(workflowId) ? text(record.opportunityOwnerName) : void 0) ?? (text(record.ownerId) ? "Owner name unavailable" : void 0);
}
function queueTitle(workflowId, record) {
	const label = text(record.name) ?? text(record.subject) ?? "Untitled record";
	return `${{
		"WF-001": "Review stale opportunity",
		"WF-002": "Triage overdue milestone",
		"WF-003": "Review stage evidence",
		"WF-004": "Map stakeholders for",
		"WF-005": "Review governance exception",
		"WF-006": "Review commit risk",
		"WF-007": "Prepare for next meeting",
		"WF-008": "Review concentration exposure",
		"WF-010": "Complete overdue follow-up",
		"WF-011": "Review opportunity dependencies",
		"WF-012": "Assemble stage exit evidence"
	}[workflowId]}: ${label}`;
}
function fromMsxResult(result) {
	return {
		state: result.state,
		data: result.data,
		rowCount: result.rowCount,
		truncated: result.truncated,
		...result.lineage ? { lineage: result.lineage } : {},
		sourceHealth: result.sourceHealth
	};
}
function requireInitialWorkflowId(value) {
	if (!initialWorkflowIds.some((id) => id === value)) throw new Error(`Unsupported initial workflow: ${value}`);
	return value;
}
function rows(value) {
	return Array.isArray(value) ? value.filter((record) => typeof record === "object" && record !== null && !Array.isArray(record)) : [];
}
var curatedOpportunityFields = [
	"recordedStage",
	"value",
	"currency",
	"closeDate",
	"comments",
	"forecastCategory",
	"probability"
];
function reconcileRecords(dataverseRecords, msxRecords) {
	const base = deduplicate(dataverseRecords, (record) => text(record.id));
	const enrichment = new Map(deduplicate(msxRecords, (record) => text(record.id)).map((record) => [text(record.id), record]));
	return base.map((record) => {
		const matchId = text(record.opportunityId) ?? text(record.id);
		const curated = matchId ? enrichment.get(matchId) : void 0;
		if (!curated) return record;
		const merged = { ...record };
		for (const field of curatedOpportunityFields) {
			const value = curated[field];
			if (value !== void 0 && value !== null && value !== "") merged[field] = value;
		}
		if (text(curated.name)) merged.opportunityName = curated.name;
		if (text(curated.owner)) merged.opportunityOwnerName = curated.owner;
		if (!text(merged.accountId) && text(curated.accountId)) merged.accountId = curated.accountId;
		if (!text(merged.accountName) && text(curated.accountName)) merged.accountName = curated.accountName;
		return merged;
	});
}
function deduplicate(records, keyOf) {
	const unique = /* @__PURE__ */ new Map();
	for (const record of [...records].sort((left, right) => stableRecord(left).localeCompare(stableRecord(right)))) {
		const key = keyOf(record);
		if (key && !unique.has(key)) unique.set(key, record);
	}
	return [...unique.values()];
}
function stableRecord(record) {
	return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))));
}
function compareRecords(left, right) {
	for (const field of [
		"targetDate",
		"dueDate",
		"closeDate",
		"id"
	]) {
		const comparison = String(left[field] ?? "").localeCompare(String(right[field] ?? ""));
		if (comparison !== 0) return comparison;
	}
	return 0;
}
function primitiveRow(record, columns) {
	return Object.fromEntries(columns.map((column) => {
		const value = record[column];
		return [column, typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null];
	}));
}
function text(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function date(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : void 0;
}
function subtractDays(value, days) {
	const result = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
	result.setUTCDate(result.getUTCDate() - days);
	return result.toISOString().slice(0, 10);
}
function addDays(value, days) {
	const result = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
	result.setUTCDate(result.getUTCDate() + days);
	return result.toISOString().slice(0, 10);
}
//#endregion
//#region packages/connectors/dataverse-mcp/query-guard.ts
var dealTeamOpportunityColumn = {
	opportunity: "opportunityid",
	msp_engagementmilestone: "msp_opportunityid",
	activitypointer: "regardingobjectid"
};
var DataverseQueryGuardError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "DataverseQueryGuardError";
	}
};
/** Strips the OData lookup decoration (`_x_value`) so a logical name is valid in a TDS SQL column list. */
function toSqlColumn(logicalName) {
	return /^_(.+)_value$/.exec(logicalName)?.[1] ?? logicalName;
}
function sqlScalar(value) {
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	return `'${value.replace(/'/g, "''")}'`;
}
function sqlOperator(operator) {
	switch (operator) {
		case "ne": return "<>";
		case "gt": return ">";
		case "ge":
		case "on-or-after": return ">=";
		case "lt": return "<";
		case "le":
		case "on-or-before": return "<=";
		case "in": return "IN";
		case "contains":
		case "startswith": return "LIKE";
		default: return "=";
	}
}
function sqlValue(operator, value) {
	if (Array.isArray(value)) return `(${value.map(sqlScalar).join(", ")})`;
	if (operator === "contains") return sqlScalar(`%${value}%`);
	if (operator === "startswith") return sqlScalar(`${value}%`);
	return sqlScalar(value);
}
function renderSqlScopePredicate(template, scope) {
	const replacements = {
		delegatedUserAccountIds: scope.delegatedUserAccountIds,
		delegatedUserOpportunityIds: scope.delegatedUserOpportunityIds
	};
	const placeholders = [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)];
	if (placeholders.length === 0) throw new DataverseQueryGuardError("scope_required", "Dataverse scope predicate has no delegated-user placeholder.");
	let rendered = template;
	for (const match of placeholders) {
		const name = match[1];
		const values = name === void 0 ? void 0 : replacements[name];
		if (!values || values.length === 0 || values.some((value) => !isSafeIdentifier(value))) throw new DataverseQueryGuardError("scope_required", "Delegated Dataverse scope is missing or invalid.");
		rendered = rendered.replaceAll(`{${name}}`, `(${values.map((value) => `'${value}'`).join(", ")})`);
	}
	if (/[{}]/.test(rendered)) throw new DataverseQueryGuardError("scope_required", "Dataverse scope predicate contains an unknown placeholder.");
	return rendered;
}
/**
* Renders a guarded, delegated-scoped TDS `SELECT` string for the Dataverse MCP `read_query`
* tool (which takes a `querytext` SQL string, not a structured payload). Applies the same
* entity/field allowlist and delegated-scope requirements as {@link translateDataverseQuery}.
*/
function renderDataverseSql(entityMapInput, queryInput, delegatedScope, maximumRows, options = {}) {
	const entityMap = dataverseEntityMapSchema.parse(entityMapInput);
	const query = guardedQueryRequestSchema.parse(queryInput);
	if (!Number.isInteger(maximumRows) || maximumRows < 1) throw new Error("Dataverse maximum row count must be a positive integer.");
	const entity = entityMap.entities.find((candidate) => candidate.canonical === query.entity);
	if (!entity) throw new DataverseQueryGuardError("entity_denied", "Dataverse entity is not allowlisted.");
	if (query.expand.length > 0) throw new DataverseQueryGuardError("relationship_denied", "Dataverse relationship expansion is not allowlisted by the semantic map.");
	const attributes = new Map(entity.attributes.map((attribute) => [attribute.canonical, attribute]));
	const column = (canonical) => {
		const attribute = attributes.get(canonical);
		if (!attribute) throw new DataverseQueryGuardError("field_denied", "Dataverse field is not allowlisted.");
		return toSqlColumn(attribute.logicalName);
	};
	const top = Math.min(query.top, maximumRows);
	const dealTeamColumn = dealTeamOpportunityColumn[toSqlColumn(entity.logicalName)];
	const useJoinScope = options.enforceScope !== false && Boolean(delegatedScope.currentUserId) && Boolean(dealTeamColumn);
	const qualify = (sqlColumn) => useJoinScope ? `m.${sqlColumn}` : sqlColumn;
	const selectColumns = query.select.map((canonical) => qualify(column(canonical)));
	const whereClauses = query.filter.map((filter) => `${qualify(column(filter.field))} ${sqlOperator(filter.operator)} ${sqlValue(filter.operator, filter.value)}`);
	if (useJoinScope) {
		const userId = delegatedScope.currentUserId;
		if (!isSafeIdentifier(userId)) throw new DataverseQueryGuardError("scope_required", "The delegated user id is missing or invalid.");
		whereClauses.unshift(`dt.msp_dealteamuserid = '${userId}'`, "dt.statecode = 0");
		const excludedAccountIds = [...new Set(delegatedScope.excludedAccountIds ?? [])];
		if (excludedAccountIds.some((accountId) => !isSafeIdentifier(accountId))) throw new DataverseQueryGuardError("scope_required", "An excluded TLC account id is invalid.");
		if (excludedAccountIds.length > 0) {
			const ids = excludedAccountIds.map((accountId) => `'${accountId}'`).join(", ");
			whereClauses.push(`${toSqlColumn(entity.logicalName) === "opportunity" ? "m" : "scopeop"}.parentaccountid NOT IN (${ids})`);
		}
	} else if (options.enforceScope !== false && entity.userScopePredicate !== void 0) whereClauses.push(renderSqlScopePredicate(entity.userScopePredicate, delegatedScope));
	const orderBy = query.orderBy.map((order) => `${qualify(column(order.field))} ${order.direction.toUpperCase()}`);
	let sql = `SELECT TOP ${top} ${selectColumns.join(", ")} FROM ${toSqlColumn(entity.logicalName)}`;
	if (useJoinScope) sql += ` m JOIN msp_dealteam dt ON m.${dealTeamColumn} = dt.msp_parentopportunityid`;
	if (useJoinScope && (delegatedScope.excludedAccountIds?.length ?? 0) > 0 && toSqlColumn(entity.logicalName) !== "opportunity") sql += ` JOIN opportunity scopeop ON m.${dealTeamColumn} = scopeop.opportunityid`;
	if (whereClauses.length > 0) sql += ` WHERE ${whereClauses.join(" AND ")}`;
	if (orderBy.length > 0) sql += ` ORDER BY ${orderBy.join(", ")}`;
	return sql;
}
function isSafeIdentifier(value) {
	return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value);
}
//#endregion
//#region packages/connectors/dataverse-mcp/adapter.ts
var DataverseMcpReadAdapter = class {
	options;
	maximumRows;
	now;
	createToolCallId;
	constructor(options) {
		this.options = options;
		this.maximumRows = options.maximumRows ?? 500;
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.createToolCallId = options.createToolCallId ?? randomUUID;
	}
	async query(query, context) {
		const checkedAt = this.now().toISOString();
		const lineage = {
			connector: "dataverse-mcp",
			operation: "read_query",
			toolCallId: this.createToolCallId()
		};
		const target = Math.max(1, Math.min(query.top, this.maximumRows));
		try {
			if (target <= READ_QUERY_PER_CALL_LIMIT) {
				const page = await this.fetchPage(query, context, target);
				const truncated = page.recordCount > page.records.length;
				return this.assembleResult(page.records, page.recordCount, truncated, checkedAt, lineage);
			}
			const collected = [];
			let lastId;
			let exhausted = false;
			while (collected.length < target && !exhausted) {
				const pageSize = Math.min(READ_QUERY_PER_CALL_LIMIT, target - collected.length);
				const pageQuery = {
					...query,
					orderBy: [{
						field: "id",
						direction: "asc"
					}],
					filter: lastId === void 0 ? query.filter : [...query.filter, {
						field: "id",
						operator: "gt",
						value: lastId
					}],
					top: pageSize
				};
				const page = await this.fetchPage(pageQuery, context, pageSize);
				collected.push(...page.records);
				const lastRecordId = page.records.at(-1)?.["id"];
				if (page.records.length < pageSize || typeof lastRecordId !== "string") exhausted = true;
				else lastId = lastRecordId;
			}
			const ordered = sortRecords(collected, query.orderBy).slice(0, target);
			return this.assembleResult(ordered, collected.length, !exhausted, checkedAt, lineage);
		} catch (error) {
			const code = errorCode(error);
			if (code === "aborted" || error instanceof Error && error.name === "AbortError") throw error;
			if (isUnauthorizedCode(code)) return failureResult("unauthorized", "unauthorized", `Dataverse MCP delegated authorization is unavailable (${code}).`, checkedAt, lineage);
			if (error instanceof DataverseMcpAdapterError) throw error;
			return failureResult("partial", "unavailable", "Dataverse MCP data is temporarily unavailable.", checkedAt, lineage);
		}
	}
	async fetchPage(query, context, maxRows) {
		const querytext = renderDataverseSql(this.options.entityMap, query, context.delegatedScope, maxRows, { enforceScope: this.options.enforceDelegatedScope !== false });
		const result = await this.options.broker.execute({
			correlationId: context.correlationId,
			serverId: "dataverse",
			tool: "read_query",
			capability: context.capability,
			scope: context.scope.kind,
			arguments: { querytext },
			...context.signal ? { signal: context.signal } : {}
		});
		if (result.kind !== "untrusted-mcp-data") throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP result was not marked as untrusted data.");
		assertNotMcpError(result.data);
		return {
			records: mapRowsToCanonical(this.options.entityMap, query, extractRows(result.data)),
			recordCount: result.recordCount
		};
	}
	assembleResult(records, recordCount, truncated, checkedAt, lineage) {
		return {
			state: truncated ? "partial" : "complete",
			records,
			recordCount: Math.max(recordCount, records.length),
			truncated,
			sourceHealth: {
				source: "dataverse-mcp",
				state: truncated ? "partial" : "live",
				detail: truncated ? "Dataverse MCP returned a row-limited delegated result." : "Dataverse MCP returned delegated user-scoped data.",
				checkedAt
			},
			lineage
		};
	}
};
var READ_QUERY_PER_CALL_LIMIT = 20;
function sortRecords(records, orderBy) {
	if (orderBy.length === 0) return records;
	return [...records].sort((left, right) => {
		for (const order of orderBy) {
			const comparison = compareOrderValues(left[order.field], right[order.field]);
			if (comparison !== 0) return order.direction === "asc" ? comparison : -comparison;
		}
		return 0;
	});
}
function compareOrderValues(left, right) {
	if (left === right) return 0;
	if (left === null || left === void 0) return 1;
	if (right === null || right === void 0) return -1;
	if ((typeof left === "string" || typeof left === "number") && (typeof right === "string" || typeof right === "number")) return left < right ? -1 : left > right ? 1 : 0;
	return 0;
}
var DataverseMcpAdapterError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "DataverseMcpAdapterError";
	}
};
function assertNotMcpError(value) {
	if (isRecord$1(value) && value.isError === true) throw new DataverseMcpAdapterError("malformed_response", (Array.isArray(value.content) ? value.content.map((block) => isRecord$1(block) && typeof block.text === "string" ? block.text : "").join(" ").trim() : "") || "Dataverse MCP read_query returned an error.");
}
function extractRows(value) {
	if (typeof value === "string") return extractRows(parseJson(value));
	if (Array.isArray(value)) return requireRows(value);
	if (!isRecord$1(value)) throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP result has no record collection.");
	for (const key of [
		"rows",
		"records",
		"items",
		"value"
	]) if (key in value) return requireRows(value[key]);
	if (Array.isArray(value.content)) {
		const textBlock = value.content.find((block) => isRecord$1(block) && block.type === "text" && typeof block.text === "string");
		if (isRecord$1(textBlock) && typeof textBlock.text === "string") return extractRows(textBlock.text);
	}
	throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP result has no record collection.");
}
function requireRows(value) {
	if (!Array.isArray(value) || value.some((row) => !isRecord$1(row))) throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP records are malformed.");
	return value;
}
function mapRowsToCanonical(entityMap, query, rows) {
	const entity = entityMap.entities.find((candidate) => candidate.canonical === query.entity);
	if (!entity) throw new DataverseMcpAdapterError("malformed_response", "Dataverse entity mapping disappeared after translation.");
	const selected = query.select.map((canonical) => {
		const attribute = entity.attributes.find((candidate) => candidate.canonical === canonical);
		if (!attribute) throw new DataverseMcpAdapterError("malformed_response", "Dataverse field mapping disappeared after translation.");
		return attribute;
	});
	return rows.map((row) => Object.fromEntries(selected.map((attribute) => [attribute.canonical, row[toSqlColumn(attribute.logicalName)] ?? row[attribute.logicalName] ?? null])));
}
function failureResult(state, sourceState, detail, checkedAt, lineage) {
	return {
		state,
		records: [],
		recordCount: 0,
		truncated: false,
		sourceHealth: {
			source: "dataverse-mcp",
			state: sourceState,
			detail,
			checkedAt
		},
		lineage
	};
}
function parseJson(value) {
	try {
		return JSON.parse(value);
	} catch {
		throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP text content is not valid JSON.");
	}
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode(error) {
	return isRecord$1(error) && typeof error.code === "string" ? error.code : void 0;
}
function isUnauthorizedCode(code) {
	return code === "unauthorized" || code === "tool_denied" || code === "capability_denied" || code === "scope_denied" || code === "approval_required";
}
//#endregion
//#region packages/connectors/mcp/index.ts
var McpTransportError = class extends Error {
	code;
	status;
	retryAfterMs;
	constructor(code, message, status, retryAfterMs) {
		super(message);
		this.code = code;
		this.status = status;
		this.retryAfterMs = retryAfterMs;
		this.name = "McpTransportError";
	}
};
var defaultTimeoutMs = 3e4;
var defaultMaxResponseBytes = 2097152;
var defaultMaxRetryAfterMs = 5e3;
function requirePositiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
	return value;
}
function parseRetryAfter(value, now = Date.now()) {
	if (!value) return 0;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1e3);
	const retryAt = Date.parse(value);
	return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
}
async function waitForRetry(delayMs, signal) {
	if (delayMs === 0) return;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		const abort = () => {
			clearTimeout(timer);
			reject(new DOMException("The operation was aborted.", "AbortError"));
		};
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}
function capResponse(response, maxResponseBytes) {
	const declaredLength = response.headers.get("content-length");
	if (declaredLength && Number(declaredLength) > maxResponseBytes) {
		response.body?.cancel();
		throw new McpTransportError("response_too_large", "MCP response exceeded the configured byte limit.");
	}
	if (!response.body) return response;
	const reader = response.body.getReader();
	let receivedBytes = 0;
	const body = new ReadableStream({
		async pull(controller) {
			const chunk = await reader.read();
			if (chunk.done) {
				controller.close();
				return;
			}
			receivedBytes += chunk.value.byteLength;
			if (receivedBytes > maxResponseBytes) {
				await reader.cancel();
				controller.error(new McpTransportError("response_too_large", "MCP response exceeded the configured byte limit."));
				return;
			}
			controller.enqueue(chunk.value);
		},
		async cancel(reason) {
			await reader.cancel(reason);
		}
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
function normalizeError(error, signal) {
	if (error instanceof McpTransportError) return error;
	if (signal?.aborted || error instanceof Error && error.name === "AbortError") return new McpTransportError("aborted", "MCP request was cancelled.");
	if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) return new McpTransportError("timeout", "MCP request timed out.");
	if (error instanceof StreamableHTTPError) {
		if (error.code === 401 || error.code === 403) return new McpTransportError("unauthorized", "MCP server rejected delegated authorization.");
		if (error.code === 429) return new McpTransportError("rate_limited", "MCP server rate limit was exceeded.");
	}
	if (error instanceof SyntaxError || error instanceof McpError) return new McpTransportError("malformed_response", "MCP server returned an invalid protocol response.");
	return new McpTransportError("transport", "MCP transport request failed.");
}
var McpHttpClient = class {
	client = new Client({
		name: "tlc-multi-agent-assist",
		version: "0.1.0"
	});
	transport;
	timeoutMs;
	initialized = false;
	disposed = false;
	constructor(options) {
		const serverUrl = new URL(options.serverUrl);
		if (serverUrl.protocol !== "https:" && serverUrl.protocol !== "http:") throw new TypeError("MCP server URL must use HTTP or HTTPS.");
		this.timeoutMs = requirePositiveInteger(options.timeoutMs ?? defaultTimeoutMs, "timeoutMs");
		const maxResponseBytes = requirePositiveInteger(options.maxResponseBytes ?? defaultMaxResponseBytes, "maxResponseBytes");
		const maxRetryAfterMs = requirePositiveInteger(options.maxRetryAfterMs ?? defaultMaxRetryAfterMs, "maxRetryAfterMs");
		const fetchImplementation = options.fetch ?? globalThis.fetch;
		const authenticatedFetch = async (input, init) => {
			const token = await options.accessTokenProvider();
			if (!token.trim()) throw new McpTransportError("unauthorized", "Delegated authorization is unavailable.");
			const headers = new Headers(init?.headers);
			headers.set("authorization", `Bearer ${token}`);
			const requestInit = {
				...init,
				headers
			};
			let response = await fetchImplementation(input, requestInit);
			if (response.status === 429) {
				const retryDelay = Math.min(parseRetryAfter(response.headers.get("retry-after")), maxRetryAfterMs);
				await response.body?.cancel();
				await waitForRetry(retryDelay, init?.signal);
				response = await fetchImplementation(input, requestInit);
				if (response.status === 429) {
					await response.body?.cancel();
					throw new McpTransportError("rate_limited", "MCP server rate limit was exceeded.", 429, Math.min(parseRetryAfter(response.headers.get("retry-after")), maxRetryAfterMs));
				}
			}
			return capResponse(response, maxResponseBytes);
		};
		this.transport = new StreamableHTTPClientTransport(serverUrl, { fetch: authenticatedFetch });
	}
	async initialize(signal) {
		this.assertUsable();
		if (this.initialized) return;
		try {
			await this.client.connect(this.transport, this.requestOptions(signal));
			this.initialized = true;
		} catch (error) {
			throw normalizeError(error, signal);
		}
	}
	async listTools(signal) {
		this.assertInitialized();
		try {
			return await this.client.listTools(void 0, this.requestOptions(signal));
		} catch (error) {
			throw normalizeError(error, signal);
		}
	}
	async callTool(name, args, signal) {
		this.assertInitialized();
		try {
			return await this.client.callTool({
				name,
				arguments: args
			}, void 0, this.requestOptions(signal));
		} catch (error) {
			throw normalizeError(error, signal);
		}
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.initialized = false;
		try {
			await this.client.close();
		} catch {
			throw new McpTransportError("transport", "MCP transport disposal failed.");
		}
	}
	requestOptions(signal) {
		return {
			timeout: this.timeoutMs,
			maxTotalTimeout: this.timeoutMs,
			...signal ? { signal } : {}
		};
	}
	assertUsable() {
		if (this.disposed) throw new McpTransportError("disposed", "MCP client has been disposed.");
	}
	assertInitialized() {
		this.assertUsable();
		if (!this.initialized) throw new McpTransportError("transport", "MCP client is not initialized.");
	}
};
//#endregion
//#region packages/connectors/mcp/pool.ts
var McpPoolError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "McpPoolError";
	}
};
var retryableCodes = /* @__PURE__ */ new Set([
	"rate_limited",
	"timeout",
	"transport"
]);
var McpClientPool = class {
	entries = /* @__PURE__ */ new Map();
	createClient;
	now;
	disposed = false;
	constructor(options) {
		this.now = options.now ?? Date.now;
		this.createClient = options.clientFactory ?? ((server) => new McpHttpClient({
			serverUrl: server.serverUrl,
			accessTokenProvider: () => options.accessTokenProvider(server),
			timeoutMs: server.limits.callTimeoutMs,
			maxResponseBytes: server.limits.maxResultBytes
		}));
		const connections = /* @__PURE__ */ new Map();
		for (const server of options.registry.servers) {
			if (!server.enabled) continue;
			const connectionId = server.connectionId ?? server.id;
			const existing = connections.get(connectionId);
			if (existing) {
				this.entries.set(server.id, existing);
				continue;
			}
			const entry = {
				config: server,
				client: void 0,
				initialization: void 0,
				activeCalls: 0,
				waiters: [],
				health: "cold",
				circuit: "closed",
				consecutiveFailures: 0,
				openedAt: void 0,
				halfOpenInFlight: false
			};
			connections.set(connectionId, entry);
			this.entries.set(server.id, entry);
		}
	}
	async listTools(serverId, signal) {
		return this.execute(serverId, (client) => client.listTools(signal), signal);
	}
	async callTool(serverId, name, args, signal) {
		return this.execute(serverId, (client) => client.callTool(name, args, signal), signal);
	}
	getHealth(serverId) {
		const entry = this.getEntry(serverId);
		return {
			serverId,
			health: entry.health,
			circuit: entry.circuit,
			activeCalls: entry.activeCalls,
			consecutiveFailures: entry.consecutiveFailures
		};
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const error = new McpPoolError("disposed", "MCP client pool has been disposed.");
		const disposals = [];
		for (const entry of new Set(this.entries.values())) {
			entry.health = "disposed";
			for (const waiter of entry.waiters.splice(0)) {
				waiter.signal?.removeEventListener("abort", waiter.abort ?? (() => void 0));
				waiter.reject(error);
			}
			if (entry.client) disposals.push(entry.client.dispose());
		}
		await Promise.allSettled(disposals);
	}
	async execute(serverId, operation, signal) {
		const entry = this.getEntry(serverId);
		await this.acquire(entry, signal);
		try {
			this.assertCircuitAvailable(entry);
			for (let attempt = 1; attempt <= entry.config.retry.maxAttempts; attempt += 1) try {
				const result = await operation(await this.getClient(entry, signal));
				this.recordSuccess(entry);
				return result;
			} catch (error) {
				const retryable = this.isRetryable(error, entry);
				if (!retryable || attempt === entry.config.retry.maxAttempts) {
					this.recordFailure(entry, retryable);
					throw error;
				}
				entry.health = "degraded";
				await this.resetClient(entry);
				await this.delay(this.retryDelay(entry, attempt, error), signal);
			}
			throw new McpPoolError("circuit_open", "MCP retry attempts were exhausted.");
		} finally {
			if (entry.circuit === "half-open") entry.halfOpenInFlight = false;
			this.release(entry);
		}
	}
	getEntry(serverId) {
		if (this.disposed) throw new McpPoolError("disposed", "MCP client pool has been disposed.");
		const entry = this.entries.get(serverId);
		if (!entry) throw new McpPoolError("server_disabled", "MCP server is not enabled.");
		return entry;
	}
	assertCircuitAvailable(entry) {
		if (entry.circuit === "open") {
			if (this.now() - (entry.openedAt ?? this.now()) < entry.config.circuitBreaker.openDurationMs) throw new McpPoolError("circuit_open", "MCP server circuit is open.");
			entry.circuit = "half-open";
			entry.halfOpenInFlight = false;
		}
		if (entry.circuit === "half-open") {
			if (entry.halfOpenInFlight) throw new McpPoolError("circuit_open", "MCP server circuit probe is in progress.");
			entry.halfOpenInFlight = true;
		}
	}
	async getClient(entry, signal) {
		if (entry.client) return entry.client;
		if (!entry.initialization) {
			const client = this.createClient(entry.config);
			entry.initialization = client.initialize(signal).then(() => {
				if (this.disposed) throw new McpPoolError("disposed", "MCP client pool has been disposed.");
				entry.client = client;
				entry.health = "healthy";
				return client;
			}).catch(async (error) => {
				await client.dispose().catch(() => void 0);
				throw error;
			}).finally(() => {
				entry.initialization = void 0;
			});
		}
		return entry.initialization;
	}
	async resetClient(entry) {
		const client = entry.client;
		entry.client = void 0;
		entry.initialization = void 0;
		if (client) await client.dispose().catch(() => void 0);
	}
	isRetryable(error, entry) {
		if (!(error instanceof McpTransportError)) return false;
		if (!retryableCodes.has(error.code)) return false;
		return error.status === void 0 || entry.config.retry.retryOnStatus.includes(error.status);
	}
	retryDelay(entry, attempt, error) {
		const configuredDelay = entry.config.retry.initialDelayMs * entry.config.retry.backoffMultiplier ** (attempt - 1);
		const retryAfterMs = error instanceof McpTransportError ? error.retryAfterMs ?? 0 : 0;
		return Math.min(Math.max(configuredDelay, retryAfterMs), entry.config.circuitBreaker.openDurationMs);
	}
	recordSuccess(entry) {
		entry.health = "healthy";
		entry.circuit = "closed";
		entry.consecutiveFailures = 0;
		entry.openedAt = void 0;
		entry.halfOpenInFlight = false;
	}
	recordFailure(entry, transient) {
		entry.health = transient ? "degraded" : "unavailable";
		if (!transient) return;
		entry.consecutiveFailures += 1;
		if (entry.circuit === "half-open" || entry.consecutiveFailures >= entry.config.circuitBreaker.failureThreshold) {
			entry.circuit = "open";
			entry.health = "unavailable";
			entry.openedAt = this.now();
		}
	}
	async acquire(entry, signal) {
		if (entry.activeCalls < entry.config.limits.maxConcurrentCalls) {
			entry.activeCalls += 1;
			return;
		}
		await new Promise((resolve, reject) => {
			const waiter = {
				resolve,
				reject,
				...signal ? { signal } : {}
			};
			if (signal) {
				waiter.abort = () => {
					const index = entry.waiters.indexOf(waiter);
					if (index >= 0) entry.waiters.splice(index, 1);
					reject(new McpTransportError("aborted", "MCP request was cancelled."));
				};
				if (signal.aborted) {
					waiter.abort();
					return;
				}
				signal.addEventListener("abort", waiter.abort, { once: true });
			}
			entry.waiters.push(waiter);
		});
		entry.activeCalls += 1;
	}
	release(entry) {
		entry.activeCalls -= 1;
		const waiter = entry.waiters.shift();
		if (!waiter) return;
		waiter.signal?.removeEventListener("abort", waiter.abort ?? (() => void 0));
		waiter.resolve();
	}
	async delay(delayMs, signal) {
		await new Promise((resolve, reject) => {
			const finish = () => {
				signal?.removeEventListener("abort", abort);
				resolve();
			};
			const timer = setTimeout(finish, delayMs);
			const abort = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				reject(new McpTransportError("aborted", "MCP request was cancelled."));
			};
			if (signal?.aborted) {
				abort();
				return;
			}
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
};
//#endregion
//#region packages/connectors/msx-mcp/adapter.ts
var stakeholderSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	role: z.string().min(1),
	influence: z.enum([
		"high",
		"medium",
		"low"
	]),
	lastTouchAt: z.string().datetime().optional()
}).strict();
var activitySchema = z.object({
	id: z.string().min(1),
	kind: z.enum([
		"appointment",
		"phone-call",
		"email",
		"task"
	]),
	subject: z.string().min(1),
	occurredAt: z.string().datetime(),
	owner: z.string().min(1).optional()
}).strict();
var pipelineRowSchema = opportunitySchema.extend({
	forecastCategory: z.string().min(1).optional(),
	probability: z.number().min(0).max(100).optional()
}).strict();
var opportunity360Schema = z.object({
	opportunity: opportunitySchema,
	milestones: z.array(milestoneSchema),
	stakeholders: z.array(stakeholderSchema),
	activities: z.array(activitySchema),
	competitors: z.array(z.string().min(1)),
	products: z.array(z.string().min(1))
}).strict();
var account360Schema = z.object({
	account: accountSchema,
	opportunities: z.array(opportunitySchema),
	team: z.array(z.string().min(1)),
	consumption: z.number().nonnegative().optional(),
	supportPosture: z.string().min(1).optional()
}).strict();
var stakeholderMapSchema = z.object({
	scope: scopeRefSchema,
	stakeholders: z.array(stakeholderSchema)
}).strict();
var forecastSnapshotSchema = z.object({
	currency: z.string().length(3),
	committed: z.number().nonnegative(),
	bestCase: z.number().nonnegative(),
	target: z.number().nonnegative(),
	gap: z.number()
}).strict();
var MsxMcpReadAdapter = class {
	broker;
	now;
	createToolCallId;
	constructor(broker, now = () => /* @__PURE__ */ new Date(), createToolCallId = randomUUID) {
		this.broker = broker;
		this.now = now;
		this.createToolCallId = createToolCallId;
	}
	getOpportunity360(opportunityId, context) {
		return this.read("get_opportunity_360", "opportunity", { opportunityId }, opportunity360Schema.nullable(), null, context);
	}
	getAccount360(accountId, context) {
		return this.read("get_account_360", "account", { accountId }, account360Schema.nullable(), null, context);
	}
	listPipeline(filter, context) {
		const scope = filter.accountId ? "account" : "portfolio";
		return this.read("list_pipeline", scope, { filter }, z.array(pipelineRowSchema), [], context);
	}
	getStakeholderMap(scope, context) {
		return this.read("get_stakeholder_map", scope.kind, { scope }, stakeholderMapSchema.nullable(), null, context);
	}
	listActivities(scope, window, context) {
		return this.read("list_activities", scope.kind, {
			scope,
			window
		}, z.array(activitySchema), [], context);
	}
	getForecastSnapshot(filter, context) {
		const scope = filter.accountId ? "account" : "portfolio";
		return this.read("get_forecast_snapshot", scope, { filter }, forecastSnapshotSchema.nullable(), null, context);
	}
	async read(tool, scope, arguments_, schema, empty, context) {
		const checkedAt = this.now().toISOString();
		const lineage = {
			connector: "msx-mcp",
			operation: tool,
			queryTemplateId: `msx.${tool}.v1`,
			toolCallId: this.createToolCallId()
		};
		try {
			const result = await this.broker.execute({
				correlationId: context.correlationId,
				serverId: "msx",
				tool,
				capability: context.capability,
				scope,
				arguments: arguments_,
				...context.signal ? { signal: context.signal } : {}
			});
			return this.success(result, schema, checkedAt, lineage);
		} catch (error) {
			const code = getErrorCode$1(error);
			if (code === "aborted" || error instanceof Error && error.name === "AbortError") throw error;
			if (code === "unauthorized" || code?.endsWith("_denied") || code === "approval_required") return this.failure("unauthorized", "unauthorized", empty, checkedAt, lineage);
			if (error instanceof MsxMcpAdapterError) throw error;
			return this.failure("partial", "unavailable", empty, checkedAt, lineage);
		}
	}
	success(result, schema, checkedAt, lineage) {
		if (result.kind !== "untrusted-mcp-data") throw new MsxMcpAdapterError("MSX MCP result envelope is invalid.");
		const parsed = schema.safeParse(unwrapMcpData(result.data));
		if (!parsed.success) throw new MsxMcpAdapterError("MSX MCP result does not match the local contract.");
		return {
			state: result.truncated ? "partial" : "complete",
			data: parsed.data,
			rowCount: result.recordCount,
			truncated: result.truncated,
			sourceHealth: {
				source: "msx-mcp",
				state: result.truncated ? "partial" : "live",
				detail: result.truncated ? "MSX MCP returned a row-limited result." : "MSX MCP returned delegated user-scoped data.",
				checkedAt
			},
			lineage
		};
	}
	failure(state, sourceState, data, checkedAt, lineage) {
		return {
			state,
			data,
			rowCount: 0,
			truncated: false,
			sourceHealth: {
				source: "msx-mcp",
				state: sourceState,
				detail: sourceState === "unauthorized" ? "MSX MCP delegated authorization is unavailable." : "MSX MCP data is temporarily unavailable.",
				checkedAt
			},
			lineage
		};
	}
};
var MsxMcpAdapterError = class extends Error {
	code = "malformed_response";
	constructor(message) {
		super(message);
		this.name = "MsxMcpAdapterError";
	}
};
function unwrapMcpData(value) {
	if (typeof value === "string") try {
		return JSON.parse(value);
	} catch {
		throw new MsxMcpAdapterError("MSX MCP text content is not valid JSON.");
	}
	if (isRecord(value) && Array.isArray(value.content)) {
		const text = value.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
		if (isRecord(text) && typeof text.text === "string") return unwrapMcpData(text.text);
	}
	return value;
}
function getErrorCode$1(error) {
	return isRecord(error) && typeof error.code === "string" ? error.code : void 0;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region packages/orchestrator/workflows/runtime.ts
var WorkflowRuntime = class {
	registry;
	executor;
	history;
	results = /* @__PURE__ */ new Map();
	controllers = /* @__PURE__ */ new Map();
	completions = /* @__PURE__ */ new Map();
	now;
	createId;
	resultAssembler;
	onStepError;
	constructor(registry, executor, options = {}) {
		this.registry = registry;
		this.executor = executor;
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? randomUUID;
		this.resultAssembler = options.resultAssembler;
		this.onStepError = options.onStepError;
		this.history = new WorkflowRunHistory({
			...options.historyCapacity === void 0 ? {} : { capacity: options.historyCapacity },
			onEvicted: (run) => {
				this.results.delete(run.resultRef ?? "");
				this.controllers.delete(run.runId);
				this.completions.delete(run.runId);
			}
		});
	}
	start(request) {
		const definition = this.registry.get(request.workflowId);
		const scope = scopeRefSchema.parse(request.scope);
		if (definition.scope !== scope.kind) throw new WorkflowRuntimeError("scope_mismatch", `Workflow ${definition.id} requires ${definition.scope} scope.`);
		if (definition.executionMode === "agentic") throw new WorkflowRuntimeError("unsupported_execution_mode", "This runtime does not execute agentic workflows.");
		const runId = this.createId();
		const correlationId = request.correlationId ?? this.createId();
		const run = workflowRunSchema.parse({
			contractVersion: "1.0",
			runId,
			workflowId: definition.id,
			status: "queued",
			scope,
			connectorCalls: [],
			telemetry: {
				correlationId,
				cacheHit: false
			}
		});
		this.history.set(run);
		this.controllers.set(runId, new AbortController());
		this.completions.set(runId, deferredCompletion());
		queueMicrotask(() => {
			this.execute(runId, definition, request.input);
		});
		return run;
	}
	get(runId) {
		return this.history.get(runId);
	}
	list(scope, limit) {
		return this.history.list(scope, limit);
	}
	getResult(resultRef) {
		const result = this.results.get(resultRef);
		return result ? structuredClone(result) : void 0;
	}
	wait(runId) {
		const run = this.requireRun(runId);
		if (isTerminal(run.status)) return Promise.resolve(run);
		const completion = this.completions.get(runId);
		if (!completion) throw new WorkflowRuntimeError("run_not_found", `Workflow run ${runId} is not available.`);
		return completion.promise.then((completed) => structuredClone(completed));
	}
	cancel(runId) {
		const run = this.requireRun(runId);
		if (isTerminal(run.status)) return run;
		this.controllers.get(runId)?.abort(new WorkflowCancellationError());
		const timestamp = iso(this.now());
		const cancelled = this.transition(run, "cancelled", {
			startedAt: run.startedAt ?? timestamp,
			completedAt: timestamp
		});
		this.finish(cancelled);
		return cancelled;
	}
	async execute(runId, definition, input) {
		const queued = this.history.get(runId);
		const controller = this.controllers.get(runId);
		if (!queued || !controller || queued.status !== "queued") return;
		const startedMs = this.now();
		let run = this.transition(queued, "running", { startedAt: iso(startedMs) });
		const result = {
			workflowId: definition.id,
			scope: run.scope,
			steps: []
		};
		const resultRef = `memory://workflow-runs/${runId}/result`;
		let outcome = "complete";
		try {
			for (const step of definition.connectorPlan) {
				const callStarted = this.now();
				const stepAbort = linkedAbortController(controller.signal);
				try {
					const connectorResult = await withTimeout(this.executor.execute(step, {
						runId,
						workflowId: definition.id,
						correlationId: run.telemetry.correlationId,
						scope: run.scope,
						input,
						signal: stepAbort.controller.signal
					}), Math.max(0, definition.sla.timeoutMs - (this.now() - startedMs)), stepAbort.controller);
					const current = this.history.get(runId);
					if (!current || current.status !== "running" || controller.signal.aborted) return;
					run = current;
					const status = connectorResult.state === "complete" ? "success" : connectorResult.state;
					run.connectorCalls.push({
						connector: step.connector,
						operation: step.operation,
						status,
						durationMs: Math.max(0, this.now() - callStarted),
						recordCount: connectorResult.rowCount,
						truncated: connectorResult.truncated
					});
					if (run.telemetry.firstResultMs === void 0 && connectorResult.state !== "unauthorized") run.telemetry.firstResultMs = Math.max(0, this.now() - startedMs);
					result.steps.push({
						connector: step.connector,
						operation: step.operation,
						data: connectorResult.data,
						...connectorResult.lineage ? { lineage: connectorResult.lineage } : {},
						...connectorResult.sourceHealth ? { sourceHealth: connectorResult.sourceHealth } : {}
					});
					if (connectorResult.state === "unauthorized") {
						outcome = step.required ? "unauthorized" : "partial";
						this.onStepError?.({
							workflowId: run.workflowId,
							connector: step.connector,
							operation: step.operation,
							required: step.required ?? false,
							message: connectorResult.sourceHealth?.detail ?? `${step.connector} delegated authorization is unavailable.`
						});
					} else if (connectorResult.state === "partial") outcome = "partial";
					if (this.resultAssembler && connectorResult.state !== "unauthorized") {
						result.output = this.resultAssembler.assemble({
							definition,
							scope: run.scope,
							input,
							steps: result.steps,
							generatedAt: iso(this.now())
						});
						this.results.set(resultRef, structuredClone(result));
						run = workflowRunSchema.parse({
							...run,
							resultRef
						});
					}
					this.history.set(run);
					if (step.required && connectorResult.state === "unauthorized") break;
				} catch (error) {
					const current = this.history.get(runId);
					if (!current || current.status !== "running") return;
					run = current;
					if (error instanceof WorkflowCancellationError || controller.signal.reason instanceof WorkflowCancellationError) return;
					const errorCode = getErrorCode(error);
					const unauthorized = errorCode?.endsWith("_denied") || errorCode === "unauthorized" || errorCode === "scope_required";
					this.onStepError?.({
						workflowId: run.workflowId,
						connector: step.connector,
						operation: step.operation,
						required: step.required ?? false,
						message: error instanceof Error ? error.message : String(error)
					});
					run.connectorCalls.push({
						connector: step.connector,
						operation: step.operation,
						status: unauthorized ? "unauthorized" : "failed",
						durationMs: Math.max(0, this.now() - callStarted),
						recordCount: 0,
						truncated: false
					});
					this.history.set(run);
					if (step.required) {
						if (unauthorized) {
							outcome = "unauthorized";
							break;
						}
						const failed = this.transition(run, "failed", { completedAt: iso(this.now()) });
						this.finish(failed);
						return;
					}
					result.steps.push({
						connector: step.connector,
						operation: step.operation,
						data: void 0,
						sourceHealth: {
							source: step.connector,
							state: unauthorized ? "unauthorized" : "unavailable",
							detail: unauthorized ? `${step.connector} delegated authorization is unavailable.` : `${step.connector} enrichment is temporarily unavailable.`,
							checkedAt: iso(this.now())
						}
					});
					outcome = "partial";
				} finally {
					stepAbort.dispose();
				}
			}
			const current = this.history.get(runId);
			if (!current || current.status !== "running" || controller.signal.aborted) return;
			if (this.resultAssembler) result.output = this.resultAssembler.assemble({
				definition,
				scope: current.scope,
				input,
				steps: result.steps,
				generatedAt: iso(this.now())
			});
			this.results.set(resultRef, structuredClone(result));
			const completed = this.transition(current, "completed", {
				completedAt: iso(this.now()),
				state: outcome,
				resultRef
			});
			this.finish(completed);
		} catch {
			const current = this.history.get(runId);
			if (!current || current.status !== "running") return;
			const failed = this.transition(current, "failed", { completedAt: iso(this.now()) });
			this.finish(failed);
		}
	}
	transition(run, status, patch) {
		if (!isWorkflowRunTransitionAllowed(run.status, status)) throw new WorkflowRuntimeError("invalid_transition", `Workflow run cannot transition from ${run.status} to ${status}.`);
		const next = workflowRunSchema.parse({
			...run,
			...patch,
			status
		});
		this.history.set(next);
		return next;
	}
	requireRun(runId) {
		const run = this.history.get(runId);
		if (!run) throw new WorkflowRuntimeError("run_not_found", `Workflow run ${runId} is not available.`);
		return run;
	}
	finish(run) {
		this.controllers.delete(run.runId);
		this.completions.get(run.runId)?.resolve(run);
	}
};
var WorkflowRuntimeError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "WorkflowRuntimeError";
	}
};
var WorkflowCancellationError = class extends Error {
	constructor() {
		super("Workflow execution was cancelled.");
		this.name = "AbortError";
	}
};
var WorkflowTimeoutError = class extends Error {
	code = "timeout";
	constructor() {
		super("Workflow execution timed out.");
		this.name = "TimeoutError";
	}
};
function withTimeout(operation, timeoutMs, controller) {
	if (timeoutMs <= 0) {
		controller.abort(new WorkflowTimeoutError());
		return Promise.reject(new WorkflowTimeoutError());
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			const error = new WorkflowTimeoutError();
			controller.abort(error);
			reject(error);
		}, timeoutMs);
		operation.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
function deferredCompletion() {
	let resolve;
	return {
		promise: new Promise((resolvePromise) => {
			resolve = resolvePromise;
		}),
		resolve
	};
}
function getErrorCode(error) {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : void 0;
}
function isTerminal(status) {
	return status === "completed" || status === "failed" || status === "cancelled";
}
function iso(milliseconds) {
	return new Date(milliseconds).toISOString();
}
function linkedAbortController(parent) {
	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	if (parent.aborted) abort();
	else parent.addEventListener("abort", abort, { once: true });
	return {
		controller,
		dispose: () => parent.removeEventListener("abort", abort)
	};
}
//#endregion
//#region packages/orchestrator/workflows/view-contracts.ts
var workflowRunViewSchema = z.object({
	run: workflowRunSchema,
	output: initialWorkflowOutputSchema.optional()
}).strict();
//#endregion
//#region packages/orchestrator/workflows/host.ts
var workflowIdSchema = z.string().regex(/^WF-[0-9]{3}$/);
var runIdSchema = z.string().uuid();
var listWorkflowDefinitionsRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	scope: z.enum([
		"portfolio",
		"account",
		"opportunity"
	]).optional()
}).strict();
var startWorkflowHostRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	workflowId: workflowIdSchema,
	scope: scopeRefSchema,
	input: z.unknown().optional(),
	correlationId: z.string().uuid().optional()
}).strict();
var workflowRunRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	runId: runIdSchema
}).strict();
var workflowGuidanceRequestSchema = workflowRunRequestSchema.extend({
	queueItemId: z.string().min(1).max(200),
	capability: workflowGuidanceHandoffSchema.shape.capability
}).strict();
var listWorkflowRunsRequestSchema = z.object({
	contractVersion: z.literal("1.0"),
	scope: scopeRefSchema.optional(),
	limit: z.number().int().min(1).max(100).default(25)
}).strict();
var workflowHostOperationSchema = z.enum([
	"list",
	"start",
	"get",
	"cancel",
	"history",
	"guidance"
]);
var SharedWorkflowHost = class {
	registry;
	runtime;
	constructor(registry, runtime) {
		this.registry = registry;
		this.runtime = runtime;
	}
	listDefinitions(rawRequest) {
		const request = listWorkflowDefinitionsRequestSchema.parse(rawRequest);
		return z.array(workflowDefinitionSchema).parse(this.registry.list(request.scope));
	}
	start(rawRequest) {
		const request = startWorkflowHostRequestSchema.parse(rawRequest);
		return workflowRunSchema.parse(this.runtime.start({
			workflowId: request.workflowId,
			scope: request.scope,
			...request.input === void 0 ? {} : { input: request.input },
			...request.correlationId === void 0 ? {} : { correlationId: request.correlationId }
		}));
	}
	get(rawRequest) {
		const request = workflowRunRequestSchema.parse(rawRequest);
		const run = this.runtime.get(request.runId);
		if (!run) throw new WorkflowRuntimeError("run_not_found", `Workflow run ${request.runId} is not available.`);
		const result = run.resultRef ? this.runtime.getResult(run.resultRef) : void 0;
		return workflowRunViewSchema.parse({
			run,
			...result?.output === void 0 ? {} : { output: initialWorkflowOutputSchema.parse(result.output) }
		});
	}
	cancel(rawRequest) {
		const request = workflowRunRequestSchema.parse(rawRequest);
		return workflowRunSchema.parse(this.runtime.cancel(request.runId));
	}
	listRuns(rawRequest) {
		const request = listWorkflowRunsRequestSchema.parse(rawRequest);
		return z.array(workflowRunSchema).parse(this.runtime.list(request.scope, request.limit));
	}
	prepareGuidance(rawRequest) {
		const request = workflowGuidanceRequestSchema.parse(rawRequest);
		const view = this.get({
			contractVersion: "1.0",
			runId: request.runId
		});
		if (view.run.status !== "completed" || !view.run.resultRef || !view.output) throw new WorkflowRuntimeError("result_not_available", "Guidance requires a completed workflow result.");
		const item = view.output.queueItems.find(({ id }) => id === request.queueItemId);
		if (!item) throw new WorkflowRuntimeError("queue_item_not_found", `Queue item ${request.queueItemId} is not available.`);
		if (!item.accountId || !item.opportunityId) throw new WorkflowRuntimeError("opportunity_scope_required", "Guidance requires an opportunity-scoped queue item.");
		const lineageIds = new Set(view.output.lineage.map(({ toolCallId }) => toolCallId));
		if (item.evidenceIds.some((evidenceId) => !lineageIds.has(evidenceId))) throw new WorkflowRuntimeError("invalid_evidence", "Queue-item evidence does not belong to the workflow result.");
		const facts = [
			{
				label: "Priority",
				value: item.priority
			},
			...item.owner ? [{
				label: "Owner",
				value: item.owner
			}] : [],
			...item.dueDate ? [{
				label: "Due date",
				value: item.dueDate
			}] : []
		];
		const prompt = [
			`Review ${view.output.workflowId} result "${item.title}" and recommend the next evidence-backed action.`,
			...facts.map(({ label, value }) => `${label}: ${value}`),
			`Evidence IDs: ${item.evidenceIds.join(", ")}. Cite only these IDs.`
		].join("\n");
		return workflowGuidanceHandoffSchema.parse({
			contractVersion: "1.0",
			workflowId: view.output.workflowId,
			resultRef: view.run.resultRef,
			capability: request.capability,
			scope: {
				kind: "opportunity",
				accountId: item.accountId,
				opportunityId: item.opportunityId
			},
			prompt,
			context: {
				cardTitle: view.output.card.title,
				queueItemId: item.id,
				queueItemTitle: item.title,
				facts,
				evidenceIds: item.evidenceIds
			}
		});
	}
};
function invokeWorkflowHost(host, rawOperation, request) {
	switch (workflowHostOperationSchema.parse(rawOperation)) {
		case "list": return z.array(workflowDefinitionSchema).parse(host.listDefinitions(request));
		case "start": return workflowRunSchema.parse(host.start(request));
		case "get": return workflowRunViewSchema.parse(host.get(request));
		case "cancel": return workflowRunSchema.parse(host.cancel(request));
		case "history": return z.array(workflowRunSchema).parse(host.listRuns(request));
		case "guidance": return workflowGuidanceHandoffSchema.parse(host.prepareGuidance(request));
	}
}
//#endregion
//#region packages/orchestrator/workflows/registry.ts
var workflowDefinitionsSchema = z.array(workflowDefinitionSchema).min(1);
var WorkflowRegistry = class {
	definitions = /* @__PURE__ */ new Map();
	constructor(definitions) {
		this.replace(definitions);
	}
	replace(definitions) {
		const parsed = workflowDefinitionsSchema.parse(definitions);
		const replacement = /* @__PURE__ */ new Map();
		for (const definition of parsed) {
			if (replacement.has(definition.id)) throw new WorkflowRegistryError("duplicate_workflow", `Workflow ${definition.id} is defined more than once.`);
			replacement.set(definition.id, definition);
		}
		this.definitions = replacement;
	}
	get(workflowId) {
		const definition = this.definitions.get(workflowId);
		if (!definition) throw new WorkflowRegistryError("workflow_not_found", `Workflow ${workflowId} is not registered.`);
		return structuredClone(definition);
	}
	list(scope) {
		return [...this.definitions.values()].filter((definition) => scope === void 0 || definition.scope === scope).sort((left, right) => left.id.localeCompare(right.id)).map((definition) => structuredClone(definition));
	}
};
var WorkflowRegistryError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "WorkflowRegistryError";
	}
};
//#endregion
//#region packages/orchestrator/workflows/configured-host.ts
function createConfiguredWorkflowHost(options) {
	const pool = new McpClientPool({
		registry: options.registry,
		accessTokenProvider: (server) => options.getAccessToken(server)
	});
	const broker = new McpToolBroker({
		registry: options.registry,
		policy: options.policy,
		invokeTool: (serverId, tool, args, signal) => pool.callTool(serverId, tool, args, signal)
	});
	const executor = new InitialWorkflowConnectorExecutor(new DataverseMcpReadAdapter({
		entityMap: options.entityMap,
		broker,
		...options.enforceDelegatedScope === void 0 ? {} : { enforceDelegatedScope: options.enforceDelegatedScope },
		...options.maximumRows === void 0 ? {} : { maximumRows: options.maximumRows }
	}), new MsxMcpReadAdapter(broker), options.resolveDelegatedScope);
	const workflowRegistry = new WorkflowRegistry(initialWorkflowDefinitions);
	return {
		host: new SharedWorkflowHost(workflowRegistry, new WorkflowRuntime(workflowRegistry, executor, {
			resultAssembler: new InitialWorkflowResultAssembler(),
			...options.onStepError ? { onStepError: options.onStepError } : {}
		})),
		dispose: () => pool.dispose()
	};
}
/**
* Builds a delegated-scope resolver that scopes Dataverse reads to the signed-in user's deal-team
* portfolio through a `msp_dealteam` JOIN on their user id, which is far cheaper than enumerating
* the portfolio and injecting a large `IN (...)` predicate. The user id is resolved once and cached.
*/
function createDealTeamScopeResolver(resolveCurrentUserId, resolveExcludedAccountIds = async () => []) {
	let currentUserId;
	return async () => {
		currentUserId ??= resolveCurrentUserId().catch((error) => {
			currentUserId = void 0;
			throw error;
		});
		return {
			currentUserId: await currentUserId,
			delegatedUserAccountIds: [],
			delegatedUserOpportunityIds: [],
			excludedAccountIds: await resolveExcludedAccountIds()
		};
	};
}
/** Shared live Play host for Desktop, Web, and the VS Code extension. */
function createLivePlayWorkflowHost(options) {
	const { resolveCurrentUserId, resolveExcludedAccountIds, maximumRows, ...configured } = options;
	return createConfiguredWorkflowHost({
		...configured,
		maximumRows: maximumRows ?? 100,
		resolveDelegatedScope: createDealTeamScopeResolver(resolveCurrentUserId, resolveExcludedAccountIds)
	});
}
//#endregion
//#region packages/orchestrator/workflows/sample-host.ts
var sampleRows = {
	"WF-001": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Grid operations modernization",
		closeDate: "2026-08-15"
	}, {
		id: "opp-ai-service",
		accountId: "account-fabrikam",
		opportunityId: "opp-ai-service",
		name: "AI-assisted customer service",
		closeDate: "2026-08-29"
	}],
	"WF-002": [{
		id: "milestone-grid",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Architecture sign-off",
		status: "At Risk",
		targetDate: "2026-09-01"
	}],
	"WF-003": [{
		id: "milestone-stage-gap",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Customer outcome evidence",
		status: "At Risk",
		targetDate: "2026-09-05"
	}],
	"WF-004": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		name: "Grid operations modernization",
		closeDate: "2026-08-15"
	}, {
		id: "opp-ai-service",
		accountId: "account-fabrikam",
		name: "AI-assisted customer service",
		closeDate: "2026-08-29"
	}],
	"WF-005": [{
		id: "milestone-governance",
		accountId: "account-fabrikam",
		opportunityId: "opp-ai-service",
		name: "Proof review",
		status: "Blocked",
		targetDate: "2026-09-10"
	}],
	"WF-006": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Grid operations modernization",
		closeDate: "2026-10-30"
	}],
	"WF-007": [{
		id: "meeting-grid",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		subject: "Executive architecture review",
		ownerId: "owner-1",
		dueDate: "2026-09-18",
		status: "Open"
	}],
	"WF-008": [
		{
			id: "opp-grid-modernization",
			accountId: "account-contoso",
			name: "Grid operations modernization",
			closeDate: "2026-10-30"
		},
		{
			id: "opp-cloud-security-readiness",
			accountId: "account-contoso",
			name: "Cloud security readiness",
			closeDate: "2027-02-26"
		},
		{
			id: "opp-ai-service",
			accountId: "account-fabrikam",
			name: "AI-assisted customer service",
			closeDate: "2026-12-18"
		}
	],
	"WF-009": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Grid operations modernization",
		ownerId: "owner-1",
		closeDate: "2026-10-30"
	}, {
		id: "opp-cloud-security-readiness",
		accountId: "account-contoso",
		opportunityId: "opp-cloud-security-readiness",
		name: "Cloud security readiness",
		ownerId: "owner-1",
		closeDate: "2027-02-26"
	}],
	"WF-010": [{
		id: "activity-grid",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		subject: "Customer follow-up",
		ownerId: "owner-1",
		dueDate: "2026-08-01",
		status: "Open"
	}],
	"WF-011": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		name: "Grid operations modernization",
		closeDate: "2026-10-30"
	}, {
		id: "opp-cloud-security-readiness",
		accountId: "account-contoso",
		name: "Cloud security readiness",
		closeDate: "2027-02-26"
	}],
	"WF-012": [{
		id: "milestone-exit-1",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Decision criteria confirmed",
		status: "Completed",
		targetDate: "2026-09-08"
	}, {
		id: "milestone-exit-2",
		accountId: "account-contoso",
		opportunityId: "opp-grid-modernization",
		name: "Execution owner assigned",
		status: "At Risk",
		targetDate: "2026-09-12"
	}]
};
var sampleMsxRows = [{
	id: "opp-grid-modernization",
	accountId: "account-contoso",
	name: "Grid operations modernization",
	owner: "Avery Johnson",
	recordedStage: 3,
	value: 42e5,
	currency: "USD",
	closeDate: "2026-10-30",
	forecastCategory: "Committed",
	probability: 80
}, {
	id: "opp-ai-service",
	accountId: "account-fabrikam",
	name: "AI-assisted customer service",
	recordedStage: 2,
	value: 175e4,
	currency: "USD",
	closeDate: "2026-12-18",
	forecastCategory: "Best Case",
	probability: 65
}];
function createSampleWorkflowHost(resolveWorkingSet) {
	const registry = new WorkflowRegistry(initialWorkflowDefinitions);
	return new SharedWorkflowHost(registry, new WorkflowRuntime(registry, { execute: async (step, context) => {
		const workflowId = context.workflowId;
		const unscopedData = step.connector === "dataverse-mcp" ? sampleRows[workflowId] : step.operation === "get_forecast_snapshot" ? {
			currency: "USD",
			committed: 42e5,
			bestCase: 175e4,
			target: 7e6,
			gap: -28e5
		} : sampleMsxRows;
		const data = Array.isArray(unscopedData) && resolveWorkingSet ? filterToWorkingSet(unscopedData, await resolveWorkingSet()) : unscopedData;
		const lineage = {
			connector: step.connector,
			operation: step.operation,
			toolCallId: `sample-${workflowId}-${step.connector}`
		};
		const sourceHealth = {
			source: step.connector,
			state: "sample",
			detail: "Sanitized workflow fixture data.",
			checkedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		return {
			state: "complete",
			data,
			rowCount: Array.isArray(data) ? data.length : 1,
			truncated: false,
			lineage,
			sourceHealth
		};
	} }, { resultAssembler: new InitialWorkflowResultAssembler() }));
}
function filterToWorkingSet(rows, scope) {
	const accountIds = new Set(scope.accountIds);
	const opportunityIds = new Set(scope.opportunityIds);
	return rows.filter((row) => {
		const opportunityId = typeof row["opportunityId"] === "string" ? row["opportunityId"] : typeof row["id"] === "string" && row["id"].startsWith("opp-") ? row["id"] : void 0;
		if (opportunityId) return opportunityIds.has(opportunityId);
		const accountId = typeof row["accountId"] === "string" ? row["accountId"] : void 0;
		return accountId ? accountIds.has(accountId) : true;
	});
}
//#endregion
//#region packages/orchestrator/index.ts
var ThinSliceOrchestrator = class {
	msx;
	mcem;
	taskAgents;
	performanceReporter;
	constructor(msx, mcem, taskAgents = {}, performanceReporter) {
		this.msx = msx;
		this.mcem = mcem;
		this.taskAgents = taskAgents;
		this.performanceReporter = performanceReporter;
	}
	listAccounts(options) {
		return this.msx.listAccounts(accountListOptionsSchema.parse(options ?? {}));
	}
	searchAccounts(request) {
		return this.msx.searchAccounts(accountSearchRequestSchema.parse(request));
	}
	async addAccount(accountId) {
		if (typeof accountId !== "string" || accountId.trim().length === 0) throw new Error("An account id is required.");
		return this.msx.addAccount(accountId);
	}
	async setAccountVisibility(accountId, visibility) {
		if (typeof accountId !== "string" || accountId.trim().length === 0) throw new Error("An account id is required.");
		return this.msx.setAccountVisibility(accountId, accountVisibilitySchema.parse(visibility));
	}
	listOpportunities(accountId) {
		return this.msx.listOpportunities(accountId);
	}
	async discoverOpportunities(domain) {
		return this.msx.discoverOpportunities(seDomainSchema.parse(domain));
	}
	async joinDealTeam(opportunityId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to join a deal team.");
		return this.msx.joinDealTeam(opportunityId);
	}
	async leaveDealTeam(opportunityId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to leave a deal team.");
		return this.msx.leaveDealTeam(opportunityId);
	}
	async joinMilestoneTeam(opportunityId, milestoneId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to join a milestone team.");
		if (typeof milestoneId !== "string" || milestoneId.trim().length === 0) throw new Error("A milestone id is required to join a milestone team.");
		return this.msx.joinMilestoneTeam(opportunityId, milestoneId);
	}
	async leaveMilestoneTeam(opportunityId, milestoneId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to leave a milestone team.");
		if (typeof milestoneId !== "string" || milestoneId.trim().length === 0) throw new Error("A milestone id is required to leave a milestone team.");
		return this.msx.leaveMilestoneTeam(opportunityId, milestoneId);
	}
	listMilestones(opportunityId) {
		return this.msx.listMilestones(opportunityId);
	}
	listDiscoverableMilestones(opportunityId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to list discoverable milestones.");
		return this.msx.listDiscoverableMilestones(opportunityId);
	}
	listMilestoneActivities(opportunityId, milestoneId) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to list milestone activities.");
		if (typeof milestoneId !== "string" || milestoneId.trim().length === 0) throw new Error("A milestone id is required to list milestone activities.");
		return this.msx.listMilestoneActivities(opportunityId, milestoneId);
	}
	createMilestoneActivity(opportunityId, milestoneId, request) {
		if (typeof opportunityId !== "string" || opportunityId.trim().length === 0) throw new Error("An opportunity id is required to create a milestone activity.");
		if (typeof milestoneId !== "string" || milestoneId.trim().length === 0) throw new Error("A milestone id is required to create a milestone activity.");
		return this.msx.createMilestoneActivity(opportunityId, milestoneId, createMilestoneActivityRequestSchema.parse(request));
	}
	updateMilestone(opportunityId, milestoneId, update) {
		return this.msx.updateMilestone(opportunityId, milestoneId, update);
	}
	updateOpportunity(opportunityId, update) {
		return this.msx.updateOpportunity(opportunityId, update);
	}
	async transitionOpportunityStage(input) {
		const request = mcemStageTransitionRequestSchema.parse(input);
		const context = await this.msx.getOpportunityContext(request.opportunityId);
		if (context.account.id !== request.accountId) throw new Error("The selected opportunity does not belong to the selected account.");
		const previousStage = context.opportunity.recordedStage;
		if (Math.abs(request.targetStage - previousStage) !== 1) throw new Error("MCEM stage changes must move to an adjacent stage.");
		const unmetCriteria = evaluateMcemProgress(context, await this.mcem.getStageGuidance(previousStage)).criteria.filter((criterion) => criterion.status !== "met");
		const advancing = request.targetStage > previousStage;
		if ((!advancing || unmetCriteria.length > 0) && !request.reason) throw new Error(advancing ? "An exception reason is required because the current-stage exit criteria are incomplete." : "A recycle reason is required when moving an opportunity to a previous stage.");
		const disposition = advancing ? unmetCriteria.length === 0 ? "advanced" : "override" : "recycled";
		const timestamp = (/* @__PURE__ */ new Date()).toISOString();
		const detail = unmetCriteria.length > 0 ? ` Unmet criteria: ${unmetCriteria.map((criterion) => `${criterion.label} (${criterion.status})`).join("; ")}.` : "";
		const auditNote = `[MCEM stage transition ${timestamp}] Stage ${previousStage} -> Stage ${request.targetStage}; disposition: ${disposition}.${detail}${request.reason ? ` Reason: ${request.reason}` : ""}`;
		const opportunity = await this.msx.updateOpportunityStage(request.opportunityId, request.targetStage, auditNote);
		return mcemStageTransitionResultSchema.parse({
			opportunity,
			previousStage,
			targetStage: request.targetStage,
			disposition,
			auditNote
		});
	}
	async runMcemCoach(input) {
		const request = mcemRequestSchema.parse(input);
		const context = await this.msx.getOpportunityContext(request.opportunityId);
		if (context.account.id !== request.accountId) throw new Error("The selected opportunity does not belong to the selected account.");
		const milestones = await this.msx.listMilestones(request.opportunityId);
		const guidance = await this.mcem.getStageGuidance(context.opportunity.recordedStage);
		return evaluateMcemProgress({
			...context,
			milestones
		}, guidance);
	}
	async runAgentTask(input) {
		const request = agentTaskRequestSchema.parse(input);
		const configuredAgent = this.taskAgents[request.capability];
		if (!configuredAgent) throw new Error(`The ${request.capability} agent is not configured.`);
		const baseContext = await measurePerformance("agent.context.msx", this.performanceReporter, () => this.msx.getOpportunityContext(request.opportunityId));
		if (baseContext.account.id !== request.accountId) throw new Error("The selected opportunity does not belong to the selected account.");
		const milestones = await this.msx.listMilestones(request.opportunityId);
		const opportunityContext = {
			...baseContext,
			milestones
		};
		const guidance = await measurePerformance("agent.context.mcem", this.performanceReporter, () => this.mcem.getStageGuidance(opportunityContext.opportunity.recordedStage));
		const localEvaluation = evaluateMcemProgress(opportunityContext, guidance);
		const content = await measurePerformance(`agent.invoke.${request.capability}`, this.performanceReporter, () => configuredAgent.agent.invoke({
			request,
			opportunityContext,
			guidance,
			localEvaluation
		}));
		if (!content?.trim()) throw new Error(`The ${request.capability} agent returned no content.`);
		const sourceHealth = [opportunityContext.sourceHealth, guidance.sourceHealth];
		const isPartial = sourceHealth.some((source) => [
			"partial",
			"stale",
			"unavailable"
		].includes(source.state));
		const responseContent = addMsxOpportunityLink(content.trim(), opportunityContext.opportunity.id);
		return {
			contractVersion: "1.0",
			correlationId: randomUUID(),
			capability: request.capability,
			agentVersion: configuredAgent.version,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			mode: opportunityContext.sourceHealth.state === "sample" ? "sample" : "live",
			state: isPartial ? "partial" : "complete",
			content: responseContent,
			sourceHealth
		};
	}
};
//#endregion
//#region apps/desktop/electron/main/azure-cli-token-provider.ts
var refreshBufferMs = 3e5;
var AzureCliMsxTokenProvider = class {
	cachedToken;
	corpId;
	credential;
	scope;
	expectedUserDomain;
	authenticationLabel;
	constructor(options = {}) {
		this.credential = options.credential ?? new AzureCliCredential({ processTimeoutInMs: 3e4 });
		this.scope = options.scope ?? "https://microsoftsales.crm.dynamics.com/.default";
		this.expectedUserDomain = options.expectedUserDomain ?? "@microsoft.com";
		this.authenticationLabel = options.authenticationLabel ?? "Azure CLI";
	}
	async getAccessToken() {
		if (this.cachedToken && this.cachedToken.expiresOnTimestamp > Date.now() + refreshBufferMs) return this.cachedToken.token;
		const accessToken = await this.credential.getToken(this.scope);
		if (!accessToken) throw new Error(`${this.authenticationLabel} did not return an MSX access token.`);
		this.corpId = readMicrosoftCorpId(accessToken.token, this.expectedUserDomain);
		this.cachedToken = accessToken;
		return accessToken.token;
	}
	async getAuthStatus() {
		try {
			await this.getAccessToken();
			return {
				state: "ready",
				...this.corpId ? { displayName: this.corpId } : {},
				...this.corpId ? { userEmail: this.corpId } : {},
				detail: `${this.authenticationLabel} is signed in as ${this.corpId ?? "an authorized user"}.`
			};
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Azure CLI authentication failed.";
			const normalized = detail.toLowerCase();
			return {
				state: normalized.includes("could not be found") || normalized.includes("not recognized") ? "cli-missing" : normalized.includes("aadsts65001") || normalized.includes("consent") ? "consent-required" : normalized.includes("aadsts50020") || normalized.includes("tenant") || normalized.includes("authorized identity") ? "tenant-mismatch" : "login-required",
				detail
			};
		}
	}
};
function readMicrosoftCorpId(accessToken, expectedUserDomain = "@microsoft.com") {
	const payloadPart = accessToken.split(".")[1];
	if (!payloadPart) throw new Error("Azure CLI returned an invalid MSX access token.");
	let claims;
	try {
		claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
	} catch {
		throw new Error("Azure CLI returned an unreadable MSX access token.");
	}
	const corpId = [
		claims["preferred_username"],
		claims["upn"],
		claims["unique_name"]
	].find((claim) => typeof claim === "string" && claim.toLowerCase().endsWith(expectedUserDomain));
	if (!corpId) throw new Error(`The active token is not an authorized identity. Sign in with an ${expectedUserDomain} account.`);
	return corpId;
}
//#endregion
//#region apps/desktop/electron/main/packaged-configuration.ts
async function prepareFoundryEnvironmentFile(options) {
	const environment = options.environment ?? process.env;
	const workingDirectory = options.workingDirectory ?? process.cwd();
	const configuredPath = environment["TLC_FOUNDRY_ENV_FILE"]?.trim();
	if (!options.isPackaged || configuredPath) return {
		filePath: resolveFoundryEnvironmentPath(environment, workingDirectory),
		created: false,
		requiresConfiguration: false
	};
	const filePath = join(options.userDataPath, "foundry.environment.json");
	try {
		await stat(filePath);
		return {
			filePath,
			created: false,
			requiresConfiguration: false
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(dirname(filePath), { recursive: true });
	await copyFile(options.templatePath, filePath);
	return {
		filePath,
		created: true,
		requiresConfiguration: options.requiresConfigurationOnCreate ?? true
	};
}
//#endregion
//#region apps/desktop/electron/main/runtime-credentials.ts
function createRuntimeCredentials(authentication) {
	if (authentication.mode === "interactive-browser") {
		const appRegistration = authentication.appRegistration;
		return {
			msx: new InteractiveBrowserCredential({
				tenantId: appRegistration.tenantId,
				clientId: appRegistration.clientId,
				redirectUri: appRegistration.redirectUri
			}),
			foundry: new InteractiveBrowserCredential({
				tenantId: authentication.foundryTenantId,
				clientId: appRegistration.clientId,
				redirectUri: appRegistration.redirectUri
			})
		};
	}
	return {
		msx: new AzureCliCredential({ processTimeoutInMs: 3e4 }),
		foundry: new AzureCliCredential({
			tenantId: authentication.foundryTenantId,
			processTimeoutInMs: 3e4
		})
	};
}
//#endregion
//#region apps/desktop/electron/main/outlook-compose.ts
var maxComposeUriLength = 16e3;
var mimeBoundary = "----tlc-agent-response-boundary";
async function openOutlookDraft(request, draftPath, host) {
	await host.writeFile(draftPath, createOutlookDraftMessage(request), "utf8");
	const openError = await host.openPath(draftPath);
	if (!openError) return;
	try {
		await host.openExternal(createOutlookComposeUri(request));
	} catch (fallbackError) {
		const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
		const openErrorDetail = openError.replace(/\s*\.?\s*$/, "");
		throw new Error(`The email draft could not be opened: ${openErrorDetail}. The default mail fallback also failed: ${fallbackMessage}`, { cause: fallbackError });
	}
}
function createOutlookDraftMessage(request) {
	const textBody = markdownToEmailText(request.responseMarkdown);
	const htmlBody = markdownToEmailHtml(request.responseMarkdown);
	return [
		`To: ${request.recipients.map(sanitizeHeader).join(", ")}`,
		`Subject: ${encodeMimeHeader(request.subject)}`,
		"MIME-Version: 1.0",
		"X-Unsent: 1",
		`Content-Type: multipart/alternative; boundary="${mimeBoundary}"`,
		"",
		`--${mimeBoundary}`,
		"Content-Type: text/plain; charset=\"UTF-8\"",
		"Content-Transfer-Encoding: base64",
		"",
		encodeBase64Lines(textBody),
		`--${mimeBoundary}`,
		"Content-Type: text/html; charset=\"UTF-8\"",
		"Content-Transfer-Encoding: base64",
		"",
		encodeBase64Lines(emailDocument(request.responseTitle, htmlBody)),
		`--${mimeBoundary}--`,
		""
	].join("\r\n");
}
function createOutlookComposeUri(request) {
	const recipients = request.recipients.map(encodeURIComponent).join(",");
	const body = markdownToEmailText(request.responseMarkdown);
	const composeUri = `mailto:${recipients}?subject=${encodeURIComponent(request.subject)}&body=${encodeURIComponent(body)}`;
	if (composeUri.length > maxComposeUriLength) throw new Error("The response is too long to open in Outlook. Export it to Word instead.");
	return composeUri;
}
function markdownToEmailText(markdown) {
	return formatBlocks(unified().use(remarkParse).use(remarkGfm).parse(markdown).children).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
function formatBlocks(nodes, indent = "") {
	return nodes.flatMap((node) => {
		switch (node.type) {
			case "heading": {
				const heading = inlineText(node.children).trim();
				return heading ? [`${heading}\n${headingSeparator(heading, node.depth)}`] : [];
			}
			case "paragraph": return [inlineText(node.children).trim()];
			case "list": return [node.children.map((item, index) => formatListItem(item, node.ordered ? `${(node.start ?? 1) + index}.` : "-", indent)).join("\n")];
			case "table": return [formatTable(node)];
			case "blockquote": return [formatBlocks(node.children, `${indent}  `).join("\n\n").split("\n").map((line) => `${indent}  ${line}`).join("\n")];
			case "code": return [node.value.split("\n").map((line) => `${indent}    ${line}`).join("\n")];
			case "thematicBreak": return ["----------------------------------------"];
			case "html": return [];
			default: return [];
		}
	}).filter(Boolean);
}
function formatListItem(item, marker, indent) {
	const [first, ...rest] = item.children;
	const lines = [`${indent}${marker} ${first?.type === "paragraph" ? inlineText(first.children).trim() : first ? formatBlocks([first], `${indent}  `).join("\n") : ""}`];
	for (const child of rest) if (child.type === "list") lines.push(formatBlocks([child], `${indent}  `).join("\n"));
	else lines.push(...formatBlocks([child], `${indent}  `).map((line) => `${indent}  ${line}`));
	return lines.join("\n");
}
function formatTable(table) {
	const rows = table.children.map((row) => row.children.map((cell) => inlineText(cell.children).trim()));
	if (rows.length === 0) return "";
	const columnCount = Math.max(...rows.map((row) => row.length));
	const widths = Array.from({ length: columnCount }, (_, column) => Math.max(3, ...rows.map((row) => row[column]?.length ?? 0)));
	const formatRow = (row) => row.map((cell, column) => (cell ?? "").padEnd(widths[column] ?? 3)).join(" | ").trimEnd();
	const separator = widths.map((width) => "-".repeat(width)).join("-+-");
	return [
		formatRow(rows[0] ?? []),
		separator,
		...rows.slice(1).map(formatRow)
	].join("\n");
}
function inlineText(nodes) {
	return nodes.map((node) => {
		switch (node.type) {
			case "text":
			case "inlineCode": return node.value;
			case "break": return "\n";
			case "link": {
				const label = inlineText(node.children);
				return label === node.url ? label : `${label} (${node.url})`;
			}
			case "image": return node.alt ? `${node.alt} (${node.url})` : node.url;
			case "strong":
			case "emphasis":
			case "delete": return inlineText(node.children);
			default: return textContent$1(node);
		}
	}).join("");
}
function textContent$1(node) {
	if ("value" in node && typeof node.value === "string") return node.value;
	return "children" in node && Array.isArray(node.children) ? node.children.map((child) => textContent$1(child)).join("") : "";
}
function headingSeparator(heading, depth) {
	return (depth === 1 ? "=" : "-").repeat(Math.min(heading.length, 72));
}
function markdownToEmailHtml(markdown) {
	return htmlBlocks(unified().use(remarkParse).use(remarkGfm).parse(markdown).children);
}
function htmlBlocks(nodes) {
	return nodes.map((node) => {
		switch (node.type) {
			case "heading": return `<h${node.depth}>${inlineHtml(node.children)}</h${node.depth}>`;
			case "paragraph": return `<p>${inlineHtml(node.children)}</p>`;
			case "list": {
				const tag = node.ordered ? "ol" : "ul";
				return `<${tag}${node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : ""}>${node.children.map((item) => `<li>${htmlBlocks(item.children)}</li>`).join("")}</${tag}>`;
			}
			case "table": return `<table><thead><tr>${node.children[0]?.children.map((cell) => `<th>${inlineHtml(cell.children)}</th>`).join("") ?? ""}</tr></thead><tbody>${node.children.slice(1).map((row) => `<tr>${row.children.map((cell) => `<td>${inlineHtml(cell.children)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
			case "blockquote": return `<blockquote>${htmlBlocks(node.children)}</blockquote>`;
			case "code": return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
			case "thematicBreak": return "<hr>";
			default: return "";
		}
	}).join("");
}
function inlineHtml(nodes) {
	return nodes.map((node) => {
		switch (node.type) {
			case "text": return escapeHtml(node.value);
			case "strong": return `<strong>${inlineHtml(node.children)}</strong>`;
			case "emphasis": return `<em>${inlineHtml(node.children)}</em>`;
			case "delete": return `<s>${inlineHtml(node.children)}</s>`;
			case "inlineCode": return `<code>${escapeHtml(node.value)}</code>`;
			case "break": return "<br>";
			case "link": return /^https:\/\//i.test(node.url) ? `<a href="${escapeHtml(node.url)}">${inlineHtml(node.children)}</a>` : inlineHtml(node.children);
			case "image": return node.alt ? escapeHtml(node.alt) : "";
			default: return escapeHtml(textContent$1(node));
		}
	}).join("");
}
function emailDocument(title, body) {
	return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Aptos,Calibri,sans-serif;color:#242424;font-size:11pt;line-height:1.45}h1,h2,h3,h4,h5,h6{color:#17365d;margin:18px 0 8px}h1{font-size:22pt}h2{font-size:17pt}h3{font-size:13pt}p{margin:0 0 10px}li{margin:0 0 5px}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #b7c9d6;padding:6px 9px;text-align:left}th{background:#eaf1f6;font-weight:700}blockquote{border-left:3px solid #8aa6b8;margin:12px 0;padding-left:12px;color:#555}code,pre{font-family:Consolas,monospace;background:#f3f4f6}pre{padding:10px;white-space:pre-wrap}a{color:#0563c1}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}
function escapeHtml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function sanitizeHeader(value) {
	return value.replace(/[\r\n]+/g, " ").trim();
}
function encodeMimeHeader(value) {
	return `=?UTF-8?B?${Buffer.from(sanitizeHeader(value), "utf8").toString("base64")}?=`;
}
function encodeBase64Lines(value) {
	return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}
//#endregion
//#region apps/desktop/electron/main/response-document.ts
var numberingReference = "agent-response-numbering";
var bulletReference = "agent-response-bullets";
var listLevels = Array.from({ length: 6 }, (_, level) => ({
	level,
	format: LevelFormat.DECIMAL,
	text: `%${level + 1}.`,
	alignment: AlignmentType.START,
	style: { paragraph: { indent: {
		left: 720 + level * 360,
		hanging: 360
	} } }
}));
var bulletLevels = [
	"•",
	"◦",
	"▪",
	"•",
	"◦",
	"▪"
].map((text, level) => ({
	level,
	format: LevelFormat.BULLET,
	text,
	alignment: AlignmentType.START,
	style: { paragraph: { indent: {
		left: 720 + level * 360,
		hanging: 360
	} } }
}));
async function createResponseDocumentBuffer(request) {
	const tree = unified().use(remarkParse).use(remarkGfm).parse(request.responseMarkdown);
	const children = [
		new Paragraph({
			text: request.responseTitle,
			heading: HeadingLevel.TITLE
		}),
		new Paragraph({ children: [new TextRun({
			text: `Generated ${new Date(request.generatedAt).toLocaleString("en-US")}`,
			color: "666666",
			italics: true
		})] }),
		...tree.children.flatMap((node) => blockToDocument(node))
	];
	const document = new Document({
		styles: { default: {
			document: {
				run: {
					font: "Aptos",
					size: 22,
					color: "242424"
				},
				paragraph: { spacing: {
					after: 120,
					line: 276
				} }
			},
			title: {
				run: {
					font: "Aptos Display",
					size: 36,
					bold: true,
					color: "17365D"
				},
				paragraph: { spacing: { after: 180 } }
			},
			heading1: {
				run: {
					font: "Aptos Display",
					size: 30,
					bold: true,
					color: "17365D"
				},
				paragraph: {
					spacing: {
						before: 280,
						after: 120
					},
					keepNext: true
				}
			},
			heading2: {
				run: {
					font: "Aptos Display",
					size: 26,
					bold: true,
					color: "24527A"
				},
				paragraph: {
					spacing: {
						before: 240,
						after: 100
					},
					keepNext: true
				}
			},
			heading3: {
				run: {
					font: "Aptos",
					size: 23,
					bold: true,
					color: "2F5F85"
				},
				paragraph: {
					spacing: {
						before: 200,
						after: 80
					},
					keepNext: true
				}
			}
		} },
		numbering: { config: [{
			reference: numberingReference,
			levels: listLevels
		}, {
			reference: bulletReference,
			levels: bulletLevels
		}] },
		sections: [{
			properties: { page: {
				size: {
					width: 12240,
					height: 15840
				},
				margin: {
					top: 1080,
					right: 1080,
					bottom: 1080,
					left: 1080
				}
			} },
			children
		}]
	});
	return Packer.toBuffer(document);
}
function blockToDocument(node, listLevel = 0) {
	switch (node.type) {
		case "heading": return [new Paragraph({
			heading: headingLevel(node.depth),
			children: inlineChildren(node.children)
		})];
		case "paragraph": return [new Paragraph({
			children: inlineChildren(node.children),
			spacing: { after: 120 }
		})];
		case "list": return node.children.flatMap((item) => item.children.flatMap((child) => {
			if (child.type === "list") return blockToDocument(child, Math.min(listLevel + 1, 5));
			const children = child.type === "paragraph" ? inlineChildren(child.children) : [new TextRun(textContent(child))];
			return [new Paragraph({
				children,
				numbering: {
					reference: node.ordered ? numberingReference : bulletReference,
					level: listLevel
				},
				spacing: { after: 60 }
			})];
		}));
		case "table": return [new Table({
			width: {
				size: 100,
				type: WidthType.PERCENTAGE
			},
			rows: node.children.map((row) => new TableRow({ children: row.children.map((cell) => new TableCell({ children: [new Paragraph({ children: inlineChildren(cell.children) })] })) }))
		})];
		case "blockquote": return node.children.flatMap((child) => blockToDocument(child).map((block) => block instanceof Paragraph ? new Paragraph({
			children: [new TextRun({
				text: textContent(child),
				italics: true,
				color: "555555"
			})],
			indent: { left: 360 }
		}) : block));
		case "code": return [new Paragraph({
			children: [new TextRun({
				text: node.value,
				font: "Consolas"
			})],
			shading: { fill: "F3F4F6" }
		})];
		case "thematicBreak": return [new Paragraph({ text: "" })];
		default: return [];
	}
}
function inlineChildren(nodes) {
	return nodes.flatMap((node) => {
		switch (node.type) {
			case "text": return [new TextRun(node.value)];
			case "strong": return [new TextRun({
				text: textContent(node),
				bold: true
			})];
			case "emphasis": return [new TextRun({
				text: textContent(node),
				italics: true
			})];
			case "delete": return [new TextRun({
				text: textContent(node),
				strike: true
			})];
			case "inlineCode": return [new TextRun({
				text: node.value,
				font: "Consolas"
			})];
			case "break": return [new TextRun({ break: 1 })];
			case "link": return /^https:\/\//i.test(node.url) ? [new ExternalHyperlink({
				link: node.url,
				children: [new TextRun({
					text: textContent(node),
					style: "Hyperlink"
				})]
			})] : [new TextRun(textContent(node))];
			default: return [new TextRun(textContent(node))];
		}
	});
}
function textContent(node) {
	if (!node || typeof node !== "object") return "";
	const candidate = node;
	if (typeof candidate.value === "string") return candidate.value;
	return Array.isArray(candidate.children) ? candidate.children.map(textContent).join("") : "";
}
function headingLevel(depth) {
	return [
		HeadingLevel.HEADING_1,
		HeadingLevel.HEADING_2,
		HeadingLevel.HEADING_3,
		HeadingLevel.HEADING_4,
		HeadingLevel.HEADING_5,
		HeadingLevel.HEADING_6
	][depth - 1] ?? HeadingLevel.HEADING_6;
}
//#endregion
//#region apps/desktop/electron/main/response-save-dialog.ts
function showResponseSaveDialog(parent, defaultPath, showDialog) {
	return showDialog({
		title: "Export agent response",
		defaultPath,
		filters: [{
			name: "Microsoft Word document",
			extensions: ["docx"]
		}],
		properties: ["createDirectory", "showOverwriteConfirmation"]
	}, parent);
}
//#endregion
//#region apps/desktop/electron/main/sample-agent-response.ts
function isReadyToAdvance(context) {
	return context.localEvaluation.evidenceBasedStage > context.opportunityContext.opportunity.recordedStage;
}
var capabilitySummary = {
	"account-pulse": (context) => isReadyToAdvance(context) ? `Focus this week on confirming progression of ${context.opportunityContext.opportunity.name} to Stage ${context.localEvaluation.evidenceBasedStage}.` : `Focus this week on ${context.opportunityContext.opportunity.name} and close the highest-priority Stage ${context.guidance.stage} evidence gaps.`,
	"mcem-coach": (context) => context.localEvaluation.summary,
	"pursuit-executive": (context) => isReadyToAdvance(context) ? `Prepare ${context.opportunityContext.opportunity.name} for a customer-confirmed move to Stage ${context.localEvaluation.evidenceBasedStage}.` : `Prepare the pursuit for ${context.opportunityContext.opportunity.name} around its Stage ${context.guidance.stage} gaps and customer commitments.`,
	"risk-solution-play": (context) => isReadyToAdvance(context) ? `${context.opportunityContext.opportunity.name} has complete current-stage evidence and is ready for progression review.` : `${context.opportunityContext.opportunity.name} has ${context.localEvaluation.recommendations.length} progression risk${context.localEvaluation.recommendations.length === 1 ? "" : "s"} requiring action.`
};
function buildSampleAgentResponse(capability, context) {
	const { account, opportunity } = context.opportunityContext;
	const criteria = context.localEvaluation.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** - ${criterion.rationale}`).join("\n");
	const recommendations = context.localEvaluation.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join("\n");
	const missingInformation = context.localEvaluation.missingData.length > 0 ? context.localEvaluation.missingData.join("; ") : context.localEvaluation.criteria.some((criterion) => criterion.status === "partial") ? "No criterion evidence is missing; partially supported criteria still require confirmation." : "No criterion evidence is missing; all current-stage exit criteria are supported.";
	return `## Summary

${capabilitySummary[capability](context)}

## Context used

**Opportunity:** ${opportunity.name}
**Account:** ${account.name}
**Recorded / evidence-based stage:** ${opportunity.recordedStage} / ${context.localEvaluation.evidenceBasedStage}

## Exit criteria

${criteria}

## Recommended actions

| Owner | Action | Confidence |
| --- | --- | --- |
${recommendations}

## Sources

Sanitized MSX sample evidence; ${context.guidance.title}, version ${context.guidance.version}.

## Assumptions and missing information

${missingInformation} External signals are unavailable in sample mode.

## Feedback prompt

Was this ${capability.replaceAll("-", " ")} guidance actionable?`;
}
//#endregion
//#region apps/desktop/electron/main/startup-dialog.ts
async function openConfigurationAndExit(application, dialog, shell, filePath, detail) {
	await application.whenReady();
	if ((await dialog.showMessageBox({
		type: "info",
		title: "TLC MultiAgent Assist setup",
		message: "Configure your environment before starting TLC MultiAgent Assist.",
		detail: `${detail}\n\nConfiguration file:\n${filePath}`,
		buttons: ["Open configuration", "Exit"],
		defaultId: 0,
		cancelId: 1,
		noLink: true
	})).response === 0) {
		if (await shell.openPath(filePath)) shell.showItemInFolder(filePath);
	}
	application.quit();
}
//#endregion
//#region apps/desktop/electron/main/workflow-ipc.ts
var workflowIpcChannels = {
	list: "tlc:workflow-list",
	start: "tlc:workflow-start",
	get: "tlc:workflow-get",
	cancel: "tlc:workflow-cancel",
	history: "tlc:workflow-history",
	guidance: "tlc:workflow-guidance"
};
function createWorkflowIpcHandlers(host) {
	return Object.fromEntries(Object.entries(workflowIpcChannels).map(([operation, channel]) => [channel, (request) => invokeWorkflowHost(host, operation, request)]));
}
//#endregion
//#region apps/desktop/electron/main/index.ts
var currentDirectory = dirname(fileURLToPath(import.meta.url));
var desktopRoot = resolve(currentDirectory, "../..");
var rendererFile = process.env["TLC_UI_MODE"] === "legacy" ? resolve(desktopRoot, "dist/renderer/index.html") : resolve(desktopRoot, "dist/revamp/desktop.html");
var preloadFile = resolve(desktopRoot, "dist-electron/preload/index.cjs");
var appIcon = resolve(desktopRoot, "build/icon.png");
var developmentUrl = process.env["VITE_DEV_SERVER_URL"];
var allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString();
var dataMode = process.env["TLC_DATA_MODE"] === "sample" ? "sample" : "live";
var preparedEnvironment = app.isPackaged || dataMode === "live" ? await prepareFoundryEnvironmentFile({
	isPackaged: app.isPackaged,
	userDataPath: app.getPath("userData"),
	templatePath: resolve(process.resourcesPath, "config/foundry.environment.default.json"),
	requiresConfigurationOnCreate: false
}) : void 0;
var runtimeEnvironment;
var startupBlocked = false;
if (dataMode === "live" && preparedEnvironment?.requiresConfiguration) {
	startupBlocked = true;
	await openConfigurationAndExit(app, dialog, shell, preparedEnvironment.filePath, "Your configuration file has been created. Set the Foundry project, agent names, tenant, client ID, and authentication mode, then reopen the application.");
} else if (dataMode === "live" && preparedEnvironment) try {
	runtimeEnvironment = await loadFoundryEnvironment(preparedEnvironment.filePath);
} catch (error) {
	startupBlocked = true;
	await openConfigurationAndExit(app, dialog, shell, preparedEnvironment.filePath, `The configuration could not be loaded. Correct it, then reopen the application.\n\n${error instanceof Error ? error.message : String(error)}`);
}
var authentication = runtimeEnvironment?.authentication;
var fallbackCredential = new AzureCliCredential({ processTimeoutInMs: 3e4 });
var credentials = authentication ? createRuntimeCredentials(authentication) : {
	msx: fallbackCredential,
	foundry: fallbackCredential
};
var tokenProvider = new AzureCliMsxTokenProvider({
	credential: credentials.msx,
	...authentication ? {
		scope: authentication.scopes.msx[0],
		expectedUserDomain: authentication.expectedUserDomain,
		authenticationLabel: authentication.mode === "interactive-browser" ? "Interactive sign-in" : "Azure CLI"
	} : {}
});
var reportPerformance = (event) => {
	console.info(`[performance] ${JSON.stringify(event)}`);
};
var mcemConnector = new LocalPdfMcemGuidanceConnector(app.isPackaged ? resolve(process.resourcesPath, "docs/knowledge/MCEM Overview.pdf") : resolve(desktopRoot, "../../docs/knowledge/MCEM Overview.pdf"));
var portfolioPreferenceStore = new JsonFilePortfolioPreferenceStore(resolve(app.getPath("userData"), "portfolio-preferences.json"));
var liveMsxConnector = dataMode === "sample" ? void 0 : new LiveMsxConnector(tokenProvider, fetch, void 0, reportPerformance, msxWriteMetadataFromEnvironment(process.env), portfolioPreferenceStore);
var msxConnector = liveMsxConnector ?? createLocalStoreMsxConnector() ?? new FixtureMsxConnector();
var foundryOpenAIClient = runtimeEnvironment ? createFoundryOpenAIClient(runtimeEnvironment.foundry.projectEndpoint, credentials.foundry) : void 0;
var orchestrator = new ThinSliceOrchestrator(msxConnector, mcemConnector, Object.fromEntries([
	"account-pulse",
	"mcem-coach",
	"pursuit-executive",
	"risk-solution-play"
].map((capability) => {
	if (!runtimeEnvironment) return [capability, {
		version: "sample-v2",
		agent: { invoke: async (context) => buildSampleAgentResponse(capability, context) }
	}];
	const binding = {
		"account-pulse": runtimeEnvironment.foundry.agents.accountPulse,
		"mcem-coach": runtimeEnvironment.foundry.agents.mcemCoach,
		"pursuit-executive": runtimeEnvironment.foundry.agents.pursuitExecutive,
		"risk-solution-play": runtimeEnvironment.foundry.agents.riskSolutionPlay
	}[capability];
	return [capability, {
		version: "active",
		agent: new FoundryPromptAgent({
			projectEndpoint: runtimeEnvironment.foundry.projectEndpoint,
			agentName: binding.name,
			requestTimeoutMs: runtimeEnvironment.foundry.requestTimeoutMs,
			credential: credentials.foundry,
			openAIClient: foundryOpenAIClient
		})
	}];
})), reportPerformance);
var configurationRoot = app.isPackaged ? resolve(process.resourcesPath, "config") : resolve(desktopRoot, "../../config");
var [mcpRegistry, mcpPolicy, dataverseEntityMap] = await Promise.all([
	loadMcpServerRegistry(resolve(configurationRoot, "mcp.servers.json")),
	loadMcpToolPolicy(resolve(configurationRoot, "mcp.tool-policy.json")),
	loadDataverseEntityMap(resolve(configurationRoot, "dataverse.entity-map.json"))
]);
var configuredWorkflowHost = dataMode === "sample" ? void 0 : createLivePlayWorkflowHost({
	registry: mcpRegistry,
	policy: mcpPolicy,
	entityMap: dataverseEntityMap,
	getAccessToken: async (server) => {
		const token = await credentials.msx.getToken(server.authentication.scopes);
		if (!token) throw new Error("A delegated MCP access token is unavailable.");
		return token.token;
	},
	resolveCurrentUserId: async () => {
		if (!liveMsxConnector) throw new Error("Live Plays require the live MSX connection.");
		return liveMsxConnector.getCurrentUserId();
	},
	resolveExcludedAccountIds: async () => {
		if (!liveMsxConnector) return [];
		return (await liveMsxConnector.listAccounts({ includeHidden: true })).filter((account) => account.visibility === "hidden").map((account) => account.id);
	},
	onStepError: (info) => {
		console.error(`[play ${info.workflowId}] ${info.connector}/${info.operation} ${info.required ? "required" : "optional"} step failed: ${info.message}`);
	}
});
var workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost(async () => {
	const accounts = await msxConnector.listAccounts();
	const opportunities = (await Promise.all(accounts.map((account) => msxConnector.listOpportunities(account.id)))).flat();
	return {
		accountIds: accounts.map((account) => account.id),
		opportunityIds: opportunities.map((opportunity) => opportunity.id)
	};
});
async function getDataStatus() {
	if (dataMode === "sample") return {
		mode: "sample",
		auth: {
			state: "ready",
			detail: "Automated fixture mode is active."
		}
	};
	return {
		mode: "live",
		auth: await tokenProvider.getAuthStatus()
	};
}
async function connectMcem() {
	await mcemConnector.getStageGuidance(1);
	return {
		state: "ready",
		detail: "MCEM guidance is loaded from docs/knowledge/MCEM Overview.pdf. No live SharePoint request was made."
	};
}
function assertTrustedSender(event) {
	const senderUrl = event.senderFrame?.url;
	if (!senderUrl || !senderUrl.startsWith(allowedRendererUrl)) throw new Error("Rejected IPC request from an untrusted renderer.");
}
function registerIpc() {
	for (const [channel, handler] of Object.entries(createWorkflowIpcHandlers(workflowHost))) ipcMain.handle(channel, (event, request) => {
		assertTrustedSender(event);
		return handler(request);
	});
	ipcMain.handle("tlc:exit-application", (event) => {
		assertTrustedSender(event);
		setImmediate(() => app.quit());
	});
	ipcMain.handle("tlc:get-data-status", (event) => {
		assertTrustedSender(event);
		return getDataStatus();
	});
	ipcMain.handle("tlc:list-accounts", (event, options) => {
		assertTrustedSender(event);
		return orchestrator.listAccounts(accountListOptionsSchema.parse(options ?? {}));
	});
	ipcMain.handle("tlc:search-accounts", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.searchAccounts(accountSearchRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:add-account", (event, accountId) => {
		assertTrustedSender(event);
		return orchestrator.addAccount(z.string().min(1).max(200).parse(accountId));
	});
	ipcMain.handle("tlc:set-account-visibility", (event, accountId, visibility) => {
		assertTrustedSender(event);
		return orchestrator.setAccountVisibility(z.string().min(1).max(200).parse(accountId), accountVisibilitySchema.parse(visibility));
	});
	ipcMain.handle("tlc:connect-mcem", (event) => {
		assertTrustedSender(event);
		return connectMcem();
	});
	ipcMain.handle("tlc:list-opportunities", (event, accountId) => {
		assertTrustedSender(event);
		return orchestrator.listOpportunities(z.string().min(1).parse(accountId));
	});
	ipcMain.handle("tlc:discover-opportunities", (event, domain) => {
		assertTrustedSender(event);
		return orchestrator.discoverOpportunities(seDomainSchema.parse(domain));
	});
	ipcMain.handle("tlc:join-deal-team", (event, opportunityId) => {
		assertTrustedSender(event);
		return orchestrator.joinDealTeam(z.string().min(1).parse(opportunityId));
	});
	ipcMain.handle("tlc:leave-deal-team", (event, opportunityId) => {
		assertTrustedSender(event);
		return orchestrator.leaveDealTeam(z.string().min(1).max(200).parse(opportunityId));
	});
	ipcMain.handle("tlc:join-milestone-team", (event, opportunityId, milestoneId) => {
		assertTrustedSender(event);
		return orchestrator.joinMilestoneTeam(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId));
	});
	ipcMain.handle("tlc:leave-milestone-team", (event, opportunityId, milestoneId) => {
		assertTrustedSender(event);
		return orchestrator.leaveMilestoneTeam(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId));
	});
	ipcMain.handle("tlc:list-milestones", (event, opportunityId) => {
		assertTrustedSender(event);
		return orchestrator.listMilestones(z.string().min(1).parse(opportunityId));
	});
	ipcMain.handle("tlc:list-discoverable-milestones", (event, opportunityId) => {
		assertTrustedSender(event);
		return orchestrator.listDiscoverableMilestones(z.string().min(1).max(200).parse(opportunityId));
	});
	ipcMain.handle("tlc:list-milestone-activities", (event, opportunityId, milestoneId) => {
		assertTrustedSender(event);
		return orchestrator.listMilestoneActivities(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId));
	});
	ipcMain.handle("tlc:create-milestone-activity", (event, opportunityId, milestoneId, request) => {
		assertTrustedSender(event);
		return orchestrator.createMilestoneActivity(z.string().min(1).max(200).parse(opportunityId), z.string().min(1).max(200).parse(milestoneId), createMilestoneActivityRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:update-milestone", (event, opportunityId, milestoneId, update) => {
		assertTrustedSender(event);
		return orchestrator.updateMilestone(z.string().min(1).parse(opportunityId), z.string().min(1).parse(milestoneId), milestoneUpdateSchema.parse(update));
	});
	ipcMain.handle("tlc:update-opportunity", (event, opportunityId, update) => {
		assertTrustedSender(event);
		return orchestrator.updateOpportunity(z.string().min(1).parse(opportunityId), opportunityUpdateSchema.parse(update));
	});
	ipcMain.handle("tlc:run-mcem-coach", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.runMcemCoach(mcemRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:transition-opportunity-stage", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.transitionOpportunityStage(mcemStageTransitionRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:run-agent-task", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.runAgentTask(agentTaskRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:open-email-compose", async (event, rawRequest) => {
		assertTrustedSender(event);
		const request = emailComposeRequestSchema.parse(rawRequest);
		const draftDirectory = resolve(app.getPath("temp"), "TLC-MultiAgentAssist", "email-drafts");
		await mkdir(draftDirectory, { recursive: true });
		await openOutlookDraft(request, resolve(draftDirectory, `${safeFileName(request.responseTitle)}-${randomUUID()}.eml`), {
			writeFile,
			openPath: (path) => shell.openPath(path),
			openExternal: (url) => shell.openExternal(url)
		});
		return { state: "opened" };
	});
	ipcMain.handle("tlc:export-agent-response", async (event, rawRequest) => {
		assertTrustedSender(event);
		const request = exportResponseRequestSchema.parse(rawRequest);
		const result = await showResponseSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? void 0, `${safeFileName(request.responseTitle)}.docx`, (options, parent) => {
			return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
		});
		if (result.canceled || !result.filePath) return { state: "cancelled" };
		const filePath = result.filePath.toLowerCase().endsWith(".docx") ? result.filePath : `${result.filePath}.docx`;
		await writeFile(filePath, await createResponseDocumentBuffer(request));
		return {
			state: "saved",
			filePath
		};
	});
	ipcMain.handle("tlc:open-evidence", async (event, rawUrl) => {
		assertTrustedSender(event);
		const url = new URL(z.string().url().parse(rawUrl));
		if (url.protocol !== "https:") throw new Error("Only HTTPS evidence links are allowed.");
		await shell.openExternal(url.toString());
	});
}
function safeFileName(value) {
	return [...value].map((character) => character.charCodeAt(0) < 32 || "<>:\"/\\|?*".includes(character) ? "-" : character).join("").replace(/[. ]+$/g, "").slice(0, 120) || "TLC agent response";
}
async function createWindow() {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1080,
		minHeight: 720,
		backgroundColor: "#f5f7fa",
		title: "TLC Account Team Intelligence",
		icon: appIcon,
		autoHideMenuBar: true,
		webPreferences: {
			preload: preloadFile,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webviewTag: false
		}
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith(allowedRendererUrl)) event.preventDefault();
	});
	if (developmentUrl) await window.loadURL(developmentUrl);
	else await window.loadFile(rendererFile);
}
if (!startupBlocked) {
	registerIpc();
	app.whenReady().then(createWindow);
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
	configuredWorkflowHost?.dispose();
});
//#endregion
export {};

//# sourceMappingURL=index.js.map