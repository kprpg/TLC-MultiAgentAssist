import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { AzureCliCredential, InteractiveBrowserCredential } from "@azure/identity";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
var accountSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	segment: z.string().min(1)
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
	comments: z.string().optional()
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
//#region packages/connectors/msx/live.ts
var defaultBaseUrl = "https://microsoftsales.crm.dynamics.com/api/data/v9.2/";
var formattedValueSuffix = "@OData.Community.Display.V1.FormattedValue";
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
function msxWriteMetadataFromEnvironment(environment) {
	const riskDetailsField = environment["TLC_MSX_RISK_DETAILS_FIELD"]?.trim();
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
	return {
		...riskDetailsField ? { riskDetailsField } : {},
		...Object.keys(configuredCodes).length > 0 ? { milestoneStatusCodes: configuredCodes } : {},
		...Object.keys(stageCodes).length > 0 ? { stageCodes } : {}
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
	baseUrl;
	portfolioPromise;
	observationPromises = /* @__PURE__ */ new Map();
	milestonePromises = /* @__PURE__ */ new Map();
	constructor(tokenProvider, fetchImplementation = fetch, baseUrl = defaultBaseUrl, performanceReporter, writeMetadata = {}) {
		this.tokenProvider = tokenProvider;
		this.fetchImplementation = fetchImplementation;
		this.performanceReporter = performanceReporter;
		this.writeMetadata = writeMetadata;
		this.baseUrl = new URL(baseUrl);
		if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) throw new Error("The MSX risk details logical field name is invalid.");
	}
	async listAccounts() {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.accounts);
	}
	async listOpportunities(accountId) {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.opportunities.filter((opportunity) => opportunity.accountId === accountId));
	}
	async listMilestones(opportunityId) {
		if (!(await this.getPortfolio()).opportunities.some((opportunity) => opportunity.id === opportunityId)) throw new Error("The opportunity is not in the signed-in user’s active MSX portfolio.");
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
			...typeof row.msp_forecastcomments === "string" ? { comments: row.msp_forecastcomments } : {}
		}));
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
	refresh() {
		this.portfolioPromise = void 0;
		this.observationPromises.clear();
		this.milestonePromises.clear();
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
		const identity = await measurePerformance("msx.identity", this.performanceReporter, () => this.requestJson("WhoAmI"));
		const opportunityIds = unique((await measurePerformance("msx.deal-team", this.performanceReporter, () => this.requestAll("msp_dealteams", {
			"$select": "_msp_parentopportunityid_value",
			"$filter": `statecode eq 0 and _msp_dealteamuserid_value eq ${identity.UserId}`
		}))).map((row) => row._msp_parentopportunityid_value).filter(isPresent));
		const activeOpportunities = (await measurePerformance("msx.opportunities", this.performanceReporter, () => this.requestByIds("opportunities", "opportunityid", opportunityIds, "opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description"))).filter((row) => row._parentaccountid_value);
		const accountIds = unique(activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent));
		const accounts = (await measurePerformance("msx.accounts", this.performanceReporter, () => this.requestByIds("accounts", "accountid", accountIds, "accountid,name"))).map((row) => ({
			id: row.accountid,
			name: row.name,
			segment: "Live MSX"
		})).sort((left, right) => left.name.localeCompare(right.name));
		const accessibleAccountIds = new Set(accounts.map((account) => account.id));
		return {
			accounts,
			opportunities: activeOpportunities.filter((row) => row._parentaccountid_value && accessibleAccountIds.has(row._parentaccountid_value)).map((row) => this.mapOpportunity(row)).sort((left, right) => left.name.localeCompare(right.name))
		};
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
//#region packages/connectors/msx/index.ts
var accounts = [{
	id: "account-contoso",
	name: "Contoso Energy",
	segment: "Strategic"
}, {
	id: "account-fabrikam",
	name: "Fabrikam Retail",
	segment: "Enterprise"
}];
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
	]
};
var FixtureMsxConnector = class {
	opportunities = structuredClone(opportunities);
	milestonesByOpportunity = structuredClone(milestonesByOpportunity);
	async listAccounts() {
		return structuredClone(accounts);
	}
	async listOpportunities(accountId) {
		return structuredClone(this.opportunities.filter((opportunity) => opportunity.accountId === accountId));
	}
	async listMilestones(opportunityId) {
		return structuredClone(this.milestonesByOpportunity[opportunityId] ?? []);
	}
	async updateMilestone(opportunityId, milestoneId, update) {
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
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		opportunity.comments = update.comments;
		return structuredClone(opportunity);
	}
	async updateOpportunityStage(opportunityId, targetStage, auditNote) {
		const opportunity = this.opportunities.find((candidate) => candidate.id === opportunityId);
		if (!opportunity) throw new Error(`Unknown sample opportunity: ${opportunityId}`);
		opportunity.recordedStage = targetStage;
		opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join("\n\n");
		return structuredClone(opportunity);
	}
	async getOpportunityContext(opportunityId) {
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
};
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
	const recommendations = gaps.length === 0 ? [{
		id: "recommendation-advance-stage",
		action: evidenceBasedStage > context.opportunity.recordedStage ? `Review the completed exit criteria and advance the opportunity to Stage ${evidenceBasedStage} in MSX after customer confirmation.` : "Continue validating value realization and maintain current evidence in MSX.",
		ownerRole: "Account Executive",
		rationale: evidenceBasedStage > context.opportunity.recordedStage ? `All supplied Stage ${context.opportunity.recordedStage} exit criteria are met, supporting progression to Stage ${evidenceBasedStage}.` : "The opportunity is already at the highest supported MCEM stage.",
		evidenceIds: [msxEvidenceId, guidanceEvidenceId],
		assumption: false,
		confidence: "high"
	}] : gapRecommendations;
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	return mcemResponseSchema.parse({
		contractVersion: "1.0",
		correlationId,
		capability: "mcem-coach",
		agentVersion: mcemCoachVersion,
		generatedAt,
		mode: context.sourceHealth.state === "live" ? "live" : "sample",
		state: "complete",
		summary: evidenceBasedStage > context.opportunity.recordedStage ? `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the completed exit criteria support progression to Stage ${evidenceBasedStage}.` : evidenceBasedStage === context.opportunity.recordedStage ? `The available evidence supports recorded Stage ${context.opportunity.recordedStage}.` : `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the available evidence supports Stage ${evidenceBasedStage}.`,
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
	"WF-005",
	"WF-006",
	"WF-007",
	"WF-009",
	"WF-010",
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
	"WF-005": z.object({
		asOf: asOfSchema,
		lookbackDays: z.number().int().min(1).max(90).default(7)
	}).strict(),
	"WF-006": z.object({ asOf: asOfSchema }).strict(),
	"WF-007": z.object({
		asOf: asOfSchema,
		meetingWindowDays: z.number().int().min(1).max(90).default(14)
	}).strict(),
	"WF-009": z.object({
		asOf: asOfSchema,
		maximumActiveItems: z.number().int().min(1).max(100).default(20)
	}).strict(),
	"WF-010": z.object({
		asOf: asOfSchema,
		followUpAfterDays: z.number().int().min(1).max(90).default(14)
	}).strict(),
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
	opportunityId: z.string().min(1).optional(),
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
	createDefinition("WF-009", "Owner workload imbalance", ["Manager"], "ownership", "metric-strip", [{
		connector: "dataverse-mcp",
		operation: "read_query",
		required: true
	}]),
	createDefinition("WF-010", "Activity follow-up debt", ["Seller", "SE"], "activity-compliance", "action-list", [{
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
	if (workflowId === "WF-002" || workflowId === "WF-010" || workflowId === "WF-012") return {
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
		const counts = /* @__PURE__ */ new Map();
		for (const record of records) {
			const owner = text(record.ownerId) ?? "Unassigned";
			counts.set(owner, (counts.get(owner) ?? 0) + 1);
		}
		return [...counts.entries()].filter(([, count]) => count > threshold).sort(([left], [right]) => left.localeCompare(right)).map(([owner, count]) => ({
			id: `${workflowId}:${owner}`,
			workflowId,
			priority: count > threshold * 2 ? "P0" : "P1",
			title: `${owner} owns ${count} active opportunities`,
			owner,
			evidenceIds,
			status: "new"
		}));
	}
	return records.map((record, index) => {
		const recordId = text(record.id) ?? `${index + 1}`;
		const dueDate = date(record.targetDate) ?? date(record.dueDate) ?? date(record.closeDate);
		return {
			id: `${workflowId}:${recordId}`,
			workflowId,
			priority: workflowId === "WF-003" && Number(record.recordedStage ?? 0) >= 4 || workflowId === "WF-005" && record.status === "Blocked" ? "P0" : "P1",
			title: queueTitle(workflowId, record),
			...text(record.ownerId) ? { owner: text(record.ownerId) } : {},
			...text(record.accountId) ? { accountId: text(record.accountId) } : {},
			...text(record.opportunityId) ? { opportunityId: text(record.opportunityId) } : {},
			...dueDate ? { dueDate } : {},
			evidenceIds,
			status: "new"
		};
	});
}
function queueTitle(workflowId, record) {
	const label = text(record.name) ?? text(record.subject) ?? text(record.id) ?? "Untitled record";
	return `${{
		"WF-001": "Review stale opportunity",
		"WF-002": "Triage overdue milestone",
		"WF-003": "Review stage evidence",
		"WF-005": "Review governance exception",
		"WF-006": "Review commit risk",
		"WF-007": "Prepare for next meeting",
		"WF-010": "Complete overdue follow-up",
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
	"owner",
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
		if (!text(merged.ownerId) && text(curated.owner)) merged.ownerId = curated.owner;
		if (!text(merged.accountId) && text(curated.accountId)) merged.accountId = curated.accountId;
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
var DataverseQueryGuardError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "DataverseQueryGuardError";
	}
};
function translateDataverseQuery(entityMapInput, queryInput, delegatedScope, maximumRows) {
	const entityMap = dataverseEntityMapSchema.parse(entityMapInput);
	const query = guardedQueryRequestSchema.parse(queryInput);
	if (!Number.isInteger(maximumRows) || maximumRows < 1) throw new Error("Dataverse maximum row count must be a positive integer.");
	const entity = entityMap.entities.find((candidate) => candidate.canonical === query.entity);
	if (!entity) throw new DataverseQueryGuardError("entity_denied", "Dataverse entity is not allowlisted.");
	if (query.expand.length > 0) throw new DataverseQueryGuardError("relationship_denied", "Dataverse relationship expansion is not allowlisted by the semantic map.");
	const attributes = new Map(entity.attributes.map((attribute) => [attribute.canonical, attribute]));
	const resolveAttribute = (canonical) => {
		const attribute = attributes.get(canonical);
		if (!attribute) throw new DataverseQueryGuardError("field_denied", "Dataverse field is not allowlisted.");
		return attribute;
	};
	const userScopePredicate = entity.userScopePredicate === void 0 ? void 0 : renderScopePredicate(entity.userScopePredicate, delegatedScope);
	return {
		entitySetName: entity.entitySetName,
		select: query.select.map((field) => resolveAttribute(field).logicalName),
		filter: query.filter.map((filter) => ({
			field: resolveAttribute(filter.field).logicalName,
			operator: normalizeOperator(filter.operator),
			value: filter.value
		})),
		orderBy: query.orderBy.map((order) => ({
			field: resolveAttribute(order.field).logicalName,
			direction: order.direction
		})),
		top: Math.min(query.top, maximumRows),
		expand: [],
		...userScopePredicate ? { userScopePredicate } : {}
	};
}
function renderScopePredicate(template, scope) {
	const replacements = {
		delegatedUserAccountIds: scope.delegatedUserAccountIds,
		delegatedUserOpportunityIds: scope.delegatedUserOpportunityIds
	};
	let rendered = template;
	const placeholders = [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)];
	if (placeholders.length === 0) throw new DataverseQueryGuardError("scope_required", "Dataverse scope predicate has no delegated-user placeholder.");
	for (const match of placeholders) {
		const name = match[1];
		const values = name === void 0 ? void 0 : replacements[name];
		if (!values || values.length === 0 || values.some((value) => !isSafeIdentifier(value))) throw new DataverseQueryGuardError("scope_required", "Delegated Dataverse scope is missing or invalid.");
		rendered = rendered.replaceAll(`{${name}}`, `(${values.join(",")})`);
	}
	if (/[{}]/.test(rendered)) throw new DataverseQueryGuardError("scope_required", "Dataverse scope predicate contains an unknown placeholder.");
	return rendered;
}
function isSafeIdentifier(value) {
	return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value);
}
function normalizeOperator(operator) {
	if (operator === "on-or-after") return "ge";
	if (operator === "on-or-before") return "le";
	return operator;
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
		const arguments_ = translateDataverseQuery(this.options.entityMap, query, context.delegatedScope, this.maximumRows);
		const checkedAt = this.now().toISOString();
		const lineage = {
			connector: "dataverse-mcp",
			operation: "read_query",
			toolCallId: this.createToolCallId()
		};
		try {
			const result = await this.options.broker.execute({
				correlationId: context.correlationId,
				serverId: "dataverse",
				tool: "read_query",
				capability: context.capability,
				scope: context.scope.kind,
				arguments: arguments_,
				...context.signal ? { signal: context.signal } : {}
			});
			if (result.kind !== "untrusted-mcp-data") throw new DataverseMcpAdapterError("malformed_response", "Dataverse MCP result was not marked as untrusted data.");
			const rows = extractRows(result.data);
			const records = mapRowsToCanonical(this.options.entityMap, query, rows);
			const truncated = result.truncated || records.length < result.recordCount;
			return {
				state: truncated ? "partial" : "complete",
				records,
				recordCount: result.recordCount,
				truncated,
				sourceHealth: {
					source: "dataverse-mcp",
					state: truncated ? "partial" : "live",
					detail: truncated ? "Dataverse MCP returned a row-limited delegated result." : "Dataverse MCP returned delegated user-scoped data.",
					checkedAt
				},
				lineage
			};
		} catch (error) {
			const code = errorCode(error);
			if (code === "aborted" || error instanceof Error && error.name === "AbortError") throw error;
			if (isUnauthorizedCode(code)) return failureResult("unauthorized", "unauthorized", "Dataverse MCP delegated authorization is unavailable.", checkedAt, lineage);
			if (error instanceof DataverseMcpAdapterError) throw error;
			return failureResult("partial", "unavailable", "Dataverse MCP data is temporarily unavailable.", checkedAt, lineage);
		}
	}
};
var DataverseMcpAdapterError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "DataverseMcpAdapterError";
	}
};
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
	return rows.map((row) => Object.fromEntries(selected.map((attribute) => [attribute.canonical, row[attribute.logicalName] ?? null])));
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
		for (const server of options.registry.servers) {
			if (!server.enabled) continue;
			this.entries.set(server.id, {
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
			});
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
		for (const entry of this.entries.values()) {
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
	constructor(registry, executor, options = {}) {
		this.registry = registry;
		this.executor = executor;
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? randomUUID;
		this.resultAssembler = options.resultAssembler;
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
					if (connectorResult.state === "unauthorized") outcome = step.required ? "unauthorized" : "partial";
					else if (connectorResult.state === "partial") outcome = "partial";
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
var workflowRunViewSchema = z.object({
	run: workflowRunSchema,
	output: initialWorkflowOutputSchema.optional()
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
		broker
	}), new MsxMcpReadAdapter(broker), options.resolveDelegatedScope);
	const workflowRegistry = new WorkflowRegistry(initialWorkflowDefinitions);
	return {
		host: new SharedWorkflowHost(workflowRegistry, new WorkflowRuntime(workflowRegistry, executor, { resultAssembler: new InitialWorkflowResultAssembler() })),
		dispose: () => pool.dispose()
	};
}
//#endregion
//#region packages/orchestrator/workflows/sample-host.ts
var sampleRows = {
	"WF-001": [{
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
	"WF-002": [{
		id: "milestone-grid",
		opportunityId: "opp-grid-modernization",
		name: "Architecture sign-off",
		status: "At Risk",
		targetDate: "2026-09-01"
	}],
	"WF-003": [{
		id: "milestone-stage-gap",
		opportunityId: "opp-grid-modernization",
		name: "Customer outcome evidence",
		status: "At Risk",
		targetDate: "2026-09-05"
	}],
	"WF-005": [{
		id: "milestone-governance",
		opportunityId: "opp-ai-service",
		name: "Proof review",
		status: "Blocked",
		targetDate: "2026-09-10"
	}],
	"WF-006": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		name: "Grid operations modernization",
		closeDate: "2026-10-30"
	}],
	"WF-007": [{
		id: "meeting-grid",
		opportunityId: "opp-grid-modernization",
		subject: "Executive architecture review",
		ownerId: "owner-1",
		dueDate: "2026-09-18",
		status: "Open"
	}],
	"WF-009": [{
		id: "opp-grid-modernization",
		accountId: "account-contoso",
		name: "Grid operations modernization",
		ownerId: "owner-1",
		closeDate: "2026-10-30"
	}, {
		id: "opp-cloud-security-readiness",
		accountId: "account-contoso",
		name: "Cloud security readiness",
		ownerId: "owner-1",
		closeDate: "2027-02-26"
	}],
	"WF-010": [{
		id: "activity-grid",
		opportunityId: "opp-grid-modernization",
		subject: "Customer follow-up",
		ownerId: "owner-1",
		dueDate: "2026-08-01",
		status: "Open"
	}],
	"WF-012": [{
		id: "milestone-exit-1",
		opportunityId: "opp-grid-modernization",
		name: "Decision criteria confirmed",
		status: "Completed",
		targetDate: "2026-09-08"
	}, {
		id: "milestone-exit-2",
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
function createSampleWorkflowHost() {
	const registry = new WorkflowRegistry(initialWorkflowDefinitions);
	return new SharedWorkflowHost(registry, new WorkflowRuntime(registry, { execute: async (step, context) => {
		const workflowId = context.workflowId;
		const data = step.connector === "dataverse-mcp" ? sampleRows[workflowId] : step.operation === "get_forecast_snapshot" ? {
			currency: "USD",
			committed: 42e5,
			bestCase: 175e4,
			target: 7e6,
			gap: -28e5
		} : sampleMsxRows;
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
	listAccounts() {
		return this.msx.listAccounts();
	}
	listOpportunities(accountId) {
		return this.msx.listOpportunities(accountId);
	}
	listMilestones(opportunityId) {
		return this.msx.listMilestones(opportunityId);
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
		return evaluateMcemProgress(context, await this.mcem.getStageGuidance(context.opportunity.recordedStage));
	}
	async runAgentTask(input) {
		const request = agentTaskRequestSchema.parse(input);
		const configuredAgent = this.taskAgents[request.capability];
		if (!configuredAgent) throw new Error(`The ${request.capability} agent is not configured.`);
		const opportunityContext = await measurePerformance("agent.context.msx", this.performanceReporter, () => this.msx.getOpportunityContext(request.opportunityId));
		if (opportunityContext.account.id !== request.accountId) throw new Error("The selected opportunity does not belong to the selected account.");
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
			}),
			graph: new InteractiveBrowserCredential({
				tenantId: appRegistration.tenantId,
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
		}),
		graph: authentication.appRegistration ? new InteractiveBrowserCredential({
			tenantId: authentication.appRegistration.tenantId,
			clientId: authentication.appRegistration.clientId,
			redirectUri: authentication.appRegistration.redirectUri
		}) : new AzureCliCredential({ processTimeoutInMs: 3e4 })
	};
}
//#endregion
//#region apps/desktop/electron/main/outlook-compose.ts
var mimeBoundary = "----tlc-agent-response-boundary";
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
	foundry: fallbackCredential,
	graph: fallbackCredential
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
var msxConnector = dataMode === "sample" ? new FixtureMsxConnector() : new LiveMsxConnector(tokenProvider, fetch, void 0, reportPerformance, msxWriteMetadataFromEnvironment(process.env));
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
var delegatedScope;
var configuredWorkflowHost = dataMode === "sample" ? void 0 : createConfiguredWorkflowHost({
	registry: mcpRegistry,
	policy: mcpPolicy,
	entityMap: dataverseEntityMap,
	getAccessToken: async (server) => {
		const token = await credentials.msx.getToken(server.authentication.scopes);
		if (!token) throw new Error("A delegated MCP access token is unavailable.");
		return token.token;
	},
	resolveDelegatedScope: () => {
		delegatedScope ??= resolveMsxScope();
		return delegatedScope;
	}
});
async function resolveMsxScope() {
	const accounts = await msxConnector.listAccounts();
	const opportunities = (await Promise.all(accounts.map(({ id }) => msxConnector.listOpportunities(id)))).flat();
	return {
		delegatedUserAccountIds: accounts.map(({ id }) => id),
		delegatedUserOpportunityIds: opportunities.map(({ id }) => id)
	};
}
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
	ipcMain.handle("tlc:list-accounts", (event) => {
		assertTrustedSender(event);
		return orchestrator.listAccounts();
	});
	ipcMain.handle("tlc:connect-mcem", (event) => {
		assertTrustedSender(event);
		return connectMcem();
	});
	ipcMain.handle("tlc:list-opportunities", (event, accountId) => {
		assertTrustedSender(event);
		return orchestrator.listOpportunities(z.string().min(1).parse(accountId));
	});
	ipcMain.handle("tlc:list-milestones", (event, opportunityId) => {
		assertTrustedSender(event);
		return orchestrator.listMilestones(z.string().min(1).parse(opportunityId));
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
		const draftPath = resolve(draftDirectory, `${safeFileName(request.responseTitle)}-${randomUUID()}.eml`);
		await writeFile(draftPath, createOutlookDraftMessage(request), "utf8");
		const openError = await shell.openPath(draftPath);
		if (openError) throw new Error(`Outlook could not open the email draft: ${openError}`);
		return { state: "opened" };
	});
	ipcMain.handle("tlc:export-agent-response", async (event, rawRequest) => {
		assertTrustedSender(event);
		const request = exportResponseRequestSchema.parse(rawRequest);
		const result = await dialog.showSaveDialog({
			title: "Export agent response",
			defaultPath: `${safeFileName(request.responseTitle)}.docx`,
			filters: [{
				name: "Microsoft Word document",
				extensions: ["docx"]
			}],
			properties: ["createDirectory", "showOverwriteConfirmation"]
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
var workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost();
//#endregion
export {};

//# sourceMappingURL=index.js.map