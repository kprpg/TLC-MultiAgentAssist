import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createServer as createServer$1 } from "node:https";
import { access, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ConfidentialClientApplication, PublicClientApplication } from "@azure/msal-node";
import { ZodError, z } from "zod";
import { homedir, tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";
import { AsyncLocalStorage } from "node:async_hooks";
import { PDFParse } from "pdf-parse";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AIProjectClient } from "@azure/ai-projects";
import { App, ExpressAdapter } from "@microsoft/teams.apps";
import { createConnection, createServer as createServer$2 } from "node:net";
//#region ../../packages/common/configuration/foundry-environment.ts
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
async function loadFoundryEnvironmentFromEnvironment(environment = process.env, workingDirectory = process.cwd()) {
	const encodedEnvironment = environment["TLC_FOUNDRY_ENV_BASE64"]?.trim();
	if (!encodedEnvironment) return loadFoundryEnvironment(resolveFoundryEnvironmentPath(environment, workingDirectory));
	let candidate;
	try {
		candidate = JSON.parse(Buffer.from(encodedEnvironment, "base64").toString("utf8"));
	} catch (cause) {
		throw new Error("TLC_FOUNDRY_ENV_BASE64 is not valid Base64-encoded JSON.", { cause });
	}
	return foundryEnvironmentSchema.parse(candidate);
}
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
//#region src/configuration.ts
var httpsOrigin = z.url().refine((value) => {
	const url = new URL(value);
	return url.protocol === "https:" && value === url.origin;
}, "An exact HTTPS origin is required.");
var liveSchema = z.object({
	mode: z.literal("live"),
	origin: httpsOrigin,
	tenantId: z.uuid(),
	apiClientId: z.uuid(),
	spaClientId: z.uuid(),
	botClientId: z.uuid(),
	apiCredential: z.string().min(1),
	botCredential: z.string().min(1),
	msxResource: httpsOrigin.refine((value) => /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i.test(new URL(value).hostname)),
	mcpScope: z.url().refine((value) => value.startsWith("https://") && value.endsWith("/mcp.tools")),
	storageUrl: httpsOrigin.refine((value) => /^[a-z0-9]+\.table\.core\.windows\.net$/.test(new URL(value).hostname)).optional(),
	environmentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)
}).strict().superRefine((value, context) => {
	if (new URL(value.mcpScope).origin !== value.msxResource) context.addIssue({
		code: "custom",
		path: ["mcpScope"],
		message: "MCP authorization must target the configured MSX environment."
	});
});
var nativeSchema = z.object({
	mode: z.literal("live"),
	authentication: z.literal("local-interactive"),
	origin: httpsOrigin.refine((value) => [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(new URL(value).hostname)),
	tenantId: configuredUuidSchema.transform((value) => value.toLowerCase()),
	nativeClientId: configuredUuidSchema.transform((value) => value.toLowerCase()),
	nativeRedirectUri: z.url().refine((value) => {
		const uri = new URL(value);
		return uri.protocol === "http:" && uri.hostname === "localhost" && uri.pathname === "/" && !uri.username && !uri.password && !uri.search && !uri.hash;
	}),
	msxResource: httpsOrigin.refine((value) => /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/i.test(new URL(value).hostname)),
	mcpScope: z.url(),
	graphScopes: z.array(z.enum(["https://graph.microsoft.com/OnlineMeetings.Read", "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All"])),
	guidanceMode: z.enum(["deterministic", "foundry"]),
	environmentId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)
}).strict().superRefine((value, context) => {
	if (value.mcpScope !== `${value.msxResource}/mcp.tools`) context.addIssue({
		code: "custom",
		path: ["mcpScope"],
		message: "Native MCP scope must match the configured MSX environment."
	});
});
var cliSchema = z.object({
	...nativeSchema.shape,
	authentication: z.literal("local-azure-cli"),
	graphScopes: z.array(z.never()),
	guidanceMode: z.literal("deterministic")
}).omit({
	nativeClientId: true,
	nativeRedirectUri: true
}).strict().superRefine((value, context) => {
	if (value.mcpScope !== `${value.msxResource}/mcp.tools`) context.addIssue({
		code: "custom",
		path: ["mcpScope"],
		message: "Local source scope must match the configured MSX environment."
	});
});
function isNativeConfiguration(value) {
	return value.mode === "live" && "authentication" in value && value.authentication === "local-interactive";
}
function isCliConfiguration(value) {
	return value.mode === "live" && "authentication" in value && value.authentication === "local-azure-cli";
}
function isLocalConfiguration(value) {
	return isNativeConfiguration(value) || isCliConfiguration(value);
}
function loadTeamsRuntimeConfiguration(environment, configuration) {
	const profile = z.enum(["local", "azure"]).parse(environment["TLC_TEAMS_RUNTIME_PROFILE"] ?? (environment["WEBSITE_SITE_NAME"] ? "azure" : "local"));
	const root = resolve(environment["TLC_TEAMS_DATA_DIR"] ?? join(environment["LOCALAPPDATA"] ?? homedir(), "TLC-Assist", "Teams", configuration.mode));
	const dataDirectory = configuration.mode === "live" ? join(root, configuration.tenantId, configuration.environmentId) : root;
	const samplePath = environment["TLC_TEAMS_SAMPLE_PATH"] ?? join(dataDirectory, "sample.sqlite");
	if (configuration.mode === "live" && profile === "azure") {
		if (isLocalConfiguration(configuration)) throw new Error("Local owner authentication cannot run in an Azure host.");
		if (!configuration.storageUrl) throw new Error("The Azure runtime profile requires configured Table Storage.");
		return {
			profile,
			state: {
				kind: "table",
				url: configuration.storageUrl
			},
			samplePath
		};
	}
	const configuredPath = environment["TLC_TEAMS_STATE_PATH"] ?? join(dataDirectory, "collaboration.sqlite");
	if (configuration.mode === "live" && configuredPath === ":memory:") throw new Error("Live laptop state must use a durable SQLite file.");
	const path = configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);
	const resolvedSamplePath = samplePath === ":memory:" ? samplePath : resolve(samplePath);
	if (path !== ":memory:" && path === resolvedSamplePath) throw new Error("Collaboration state and sample data require distinct files.");
	return {
		profile,
		state: {
			kind: "sqlite",
			path
		},
		samplePath: resolvedSamplePath
	};
}
function loadTeamsStateKey(environment) {
	const encoded = environment["TLC_TEAMS_STATE_KEY"] ?? "";
	const key = Buffer.from(encoded, "base64");
	if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("Live Teams state requires a securely provisioned 32-byte Base64 encryption key.");
	return key;
}
function loadTeamsTlsConfiguration(environment, origin) {
	const certificate = environment["TLC_TEAMS_TLS_CERT_PATH"];
	const key = environment["TLC_TEAMS_TLS_KEY_PATH"];
	if (!certificate && !key) return void 0;
	if (!certificate || !key) throw new Error("Local HTTPS requires both a certificate path and a private key path.");
	if (new URL(origin).protocol !== "https:") throw new Error("A local TLS listener requires an HTTPS configured origin.");
	return {
		certificatePath: resolve(certificate),
		keyPath: resolve(key)
	};
}
function loadTeamsAdmission(environment) {
	return z.enum(["enabled", "read-only"]).parse(environment["TLC_TEAMS_ADMISSION"] ?? "enabled") === "enabled";
}
function loadTeamsConfiguration(environment) {
	const hosted = environment["WEBSITE_SITE_NAME"] || environment["TLC_TEAMS_RUNTIME_PROFILE"] === "azure";
	const mode = environment["TLC_TEAMS_MODE"] ?? (hosted ? void 0 : "sample");
	const authMode = environment["TLC_TEAMS_AUTH_MODE"] ?? "hosted-obo";
	if (![
		"hosted-obo",
		"local-interactive",
		"local-azure-cli"
	].includes(authMode)) throw new Error("TLC_TEAMS_AUTH_MODE is invalid.");
	if (authMode === "local-interactive" || authMode === "local-azure-cli") {
		if (mode !== "live" || hosted || environment["TLC_TEAMS_HOST"] && ![
			"localhost",
			"127.0.0.1",
			"::1"
		].includes(environment["TLC_TEAMS_HOST"])) throw new Error("Native authentication requires explicit live mode on a loopback-only local runtime.");
		const msxResource = environment["TLC_TEAMS_MSX_RESOURCE"];
		const local = {
			mode,
			authentication: authMode,
			origin: environment["TLC_TEAMS_ORIGIN"],
			tenantId: environment["TLC_TEAMS_TENANT_ID"],
			msxResource,
			mcpScope: environment["TLC_TEAMS_MCP_SCOPE"] ?? `${msxResource}/mcp.tools`,
			graphScopes: environment["TLC_TEAMS_GRAPH_SCOPES"]?.split(/\s+/).filter(Boolean) ?? [],
			guidanceMode: environment["TLC_TEAMS_GUIDANCE_MODE"] ?? "deterministic",
			environmentId: environment["TLC_TEAMS_ENVIRONMENT_ID"]
		};
		return authMode === "local-azure-cli" ? cliSchema.parse(local) : nativeSchema.parse({
			...local,
			nativeClientId: environment["TLC_TEAMS_NATIVE_CLIENT_ID"],
			nativeRedirectUri: environment["TLC_TEAMS_NATIVE_REDIRECT_URI"] ?? "http://localhost"
		});
	}
	if (mode === "sample") {
		const origin = environment["TLC_TEAMS_ORIGIN"] ?? "http://127.0.0.1:3978";
		const url = new URL(origin);
		if (url.origin !== origin || ![
			"localhost",
			"127.0.0.1",
			"[::1]"
		].includes(url.hostname) && url.protocol !== "https:") throw new Error("Sample mode requires a loopback or exact HTTPS origin.");
		return {
			mode,
			origin,
			environmentId: "sample"
		};
	}
	if (mode !== "live") throw new Error("TLC_TEAMS_MODE must explicitly select sample or live in hosted environments.");
	return liveSchema.parse({
		mode,
		origin: environment["TLC_TEAMS_ORIGIN"],
		tenantId: environment["TLC_TEAMS_TENANT_ID"],
		apiClientId: environment["TLC_TEAMS_API_CLIENT_ID"],
		spaClientId: environment["TLC_TEAMS_SPA_CLIENT_ID"],
		botClientId: environment["TLC_TEAMS_BOT_CLIENT_ID"],
		apiCredential: environment["TLC_TEAMS_API_CREDENTIAL"],
		botCredential: environment["TLC_TEAMS_BOT_CREDENTIAL"],
		msxResource: environment["TLC_TEAMS_MSX_RESOURCE"],
		mcpScope: environment["TLC_TEAMS_MCP_SCOPE"],
		storageUrl: environment["TLC_TEAMS_STORAGE_URL"],
		environmentId: environment["TLC_TEAMS_ENVIRONMENT_ID"]
	});
}
var base$1 = z.object({ contractVersion: z.literal("1.0") });
var localCapabilitySchema = z.object({
	id: z.string().min(1).max(80),
	title: z.string().min(1).max(120),
	state: z.enum([
		"available",
		"requires-source-grant",
		"requires-configuration",
		"requires-redesign",
		"unavailable-local"
	]),
	detail: z.string().min(1).max(1e3)
}).strict();
var nativeCapabilities = [
	{
		id: "msx",
		title: "Live MSX Portfolio",
		state: "requires-source-grant",
		detail: "Connect your approved native identity and verify your own Dataverse access."
	},
	{
		id: "mcp",
		title: "Dataverse MCP Plays",
		state: "requires-source-grant",
		detail: "REST access does not establish the native client MCP scope or allowlisting."
	},
	{
		id: "reviewed-writes",
		title: "Reviewed source changes",
		state: "requires-source-grant",
		detail: "Requires native writer eligibility, source permission, exact review and native concurrency evidence."
	},
	{
		id: "guidance",
		title: "MCEM and live guidance",
		state: "available",
		detail: "Deterministic guidance over your live source context; no claim of a Foundry model response."
	},
	{
		id: "foundry",
		title: "Foundry agents",
		state: "requires-configuration",
		detail: "An optional approved workload credential and project are separate from MSX connectivity."
	},
	{
		id: "graph",
		title: "Meeting transcripts",
		state: "requires-source-grant",
		detail: "Optional delegated Graph reads require separate grants and actual meeting access; local foreground acquisition only."
	},
	{
		id: "shared-contexts",
		title: "Shared channel and chat bindings",
		state: "requires-redesign",
		detail: "Another device cannot resolve this installation’s private binding IDs. No shared TLC store is assumed."
	},
	{
		id: "stage",
		title: "Shared meeting stage",
		state: "requires-redesign",
		detail: "Approved artifact distribution and current audience admission remain required; private source access is not publication authority."
	},
	{
		id: "bot",
		title: "Cloud bot and message extensions",
		state: "unavailable-local",
		detail: "Microsoft cloud callbacks cannot reach another user’s private localhost listener."
	},
	{
		id: "notifications",
		title: "Notifications and Activity",
		state: "available",
		detail: "Private local Activity is available. Proactive Teams delivery is not implied."
	},
	{
		id: "seller-dashboard",
		title: "Live Seller Dashboard",
		state: "requires-redesign",
		detail: "Native MSX connection does not authorize reading a Windows earnings profile; the existing privacy denial is retained."
	}
];
var nativePublicConfigurationSchema = base$1.extend({
	mode: z.literal("live"),
	authentication: z.literal("local-interactive"),
	capabilities: z.array(localCapabilitySchema).min(1)
}).strict();
var cliCapabilities = nativeCapabilities.map((capability) => {
	if (capability.id === "msx") return {
		...capability,
		detail: "Use the current Azure CLI user, verify their Dataverse identity and load their active deal-team accounts. Source access is read-only."
	};
	if ([
		"mcp",
		"graph",
		"foundry",
		"reviewed-writes"
	].includes(capability.id)) return {
		...capability,
		state: "unavailable-local",
		detail: "This explicit CLI profile permits private MSX reads and deterministic guidance only. Use an approved native profile for separately granted capabilities."
	};
	return { ...capability };
});
var cliPublicConfigurationSchema = z.object({
	contractVersion: z.literal("1.1"),
	mode: z.literal("live"),
	authentication: z.literal("local-azure-cli"),
	capabilities: z.array(localCapabilitySchema).min(1)
}).strict();
var localPairRequestSchema = base$1.extend({
	challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	contextTenantId: z.uuid().optional(),
	contextUserId: z.uuid().optional()
}).strict();
base$1.extend({
	requestId: z.uuid(),
	userCode: z.string().regex(/^[A-F0-9]{8}$/),
	expiresAt: z.iso.datetime(),
	state: z.literal("pending-owner-approval")
}).strict();
var localPairExchangeSchema = base$1.extend({
	requestId: z.uuid(),
	verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)
}).strict();
z.discriminatedUnion("state", [base$1.extend({
	state: z.literal("pending-owner-approval"),
	expiresAt: z.iso.datetime()
}).strict(), base$1.extend({
	state: z.literal("paired"),
	token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	expiresAt: z.iso.datetime()
}).strict()]);
var localRevokeRequestSchema = base$1.strict();
base$1.extend({ state: z.literal("disconnected") }).strict();
var nativeResourceSchema = z.enum([
	"msx",
	"mcp",
	"graph"
]);
var nativeConnectionStatusSchema = base$1.extend({
	state: z.enum([
		"sign-in-required",
		"connecting",
		"connected",
		"reconnect-required",
		"blocked"
	]),
	detail: z.string().min(1).max(1e3),
	account: z.string().max(500).optional(),
	resources: z.array(z.object({
		resource: nativeResourceSchema,
		state: z.enum([
			"not-connected",
			"connected",
			"consent-required",
			"denied",
			"unavailable"
		]),
		detail: z.string().min(1).max(1e3)
	}).strict()),
	capabilities: z.array(localCapabilitySchema)
}).strict();
var localOwnerCommandSchema = z.discriminatedUnion("action", [
	base$1.extend({ action: z.literal("status") }).strict(),
	base$1.extend({
		action: z.literal("connect"),
		resource: nativeResourceSchema
	}).strict(),
	base$1.extend({
		action: z.literal("approve"),
		userCode: z.string().regex(/^[A-F0-9]{8}$/)
	}).strict(),
	base$1.extend({ action: z.literal("disconnect") }).strict()
]);
var localOwnerResultSchema = z.discriminatedUnion("ok", [base$1.extend({
	ok: z.literal(true),
	status: nativeConnectionStatusSchema,
	pending: z.array(z.object({
		userCode: z.string().regex(/^[A-F0-9]{8}$/),
		expiresAt: z.iso.datetime(),
		approved: z.boolean()
	}).strict()).max(3)
}).strict(), base$1.extend({
	ok: z.literal(false),
	error: z.string().regex(/^[a-z_]{1,100}$/)
}).strict()]);
var localOwnerRecordSchema = base$1.extend({
	instanceId: z.uuid(),
	processId: z.int().positive(),
	origin: z.url()
}).strict();
var identifier$1 = z.string().min(1).max(500);
var digest = z.string().regex(/^[a-f0-9]{64}$/);
var base = z.object({ contractVersion: z.literal("1.0") });
var contextBindingSchema = base.extend({
	id: identifier$1,
	kind: z.enum([
		"channel",
		"chat",
		"meeting"
	]),
	accountId: identifier$1,
	opportunityId: identifier$1.optional(),
	contextId: identifier$1,
	revision: z.number().int().positive()
}).strict();
var actionPreviewSchema = base.extend({
	id: identifier$1,
	operation: identifier$1,
	digest,
	expiresAt: z.iso.datetime(),
	input: z.record(z.string(), z.unknown()),
	before: z.unknown().optional(),
	state: z.literal("awaiting-approval")
}).strict();
var actionApprovalSchema = base.extend({
	id: identifier$1,
	digest,
	reason: z.string().trim().min(3).max(1e3)
}).strict();
var actionReceiptSchema = base.extend({
	id: identifier$1,
	operation: identifier$1,
	state: z.enum([
		"confirmed",
		"failed-before-send",
		"effect-unknown"
	]),
	occurredAt: z.iso.datetime(),
	result: z.unknown().optional()
}).strict();
var acquisitionSchema = base.extend({
	id: identifier$1,
	state: z.enum([
		"ready",
		"waiting",
		"denied",
		"admin-blocked",
		"auth-required",
		"unsupported",
		"paused"
	]),
	meetingId: identifier$1,
	transcriptIds: z.array(identifier$1),
	attribution: z.enum([
		"attributed",
		"unattributed",
		"unknown"
	]),
	detail: z.string().min(1),
	checkedAt: z.iso.datetime()
}).strict();
base.extend({
	id: identifier$1,
	category: z.enum([
		"action",
		"workflow",
		"acquisition",
		"publication",
		"notification"
	]),
	state: identifier$1,
	title: identifier$1,
	occurredAt: z.iso.datetime()
}).strict();
base.extend({
	mode: z.enum(["sample", "live"]),
	roles: z.array(z.string()),
	displayName: z.string().min(1)
}).strict();
z.union([
	z.object({ mode: z.literal("sample") }).strict(),
	z.object({
		mode: z.literal("live"),
		tenantId: z.uuid(),
		spaClientId: z.uuid(),
		apiScope: z.string().min(1)
	}).strict(),
	nativePublicConfigurationSchema,
	cliPublicConfigurationSchema
]);
var collaborationLifecycleCommandSchema = base.extend({ command: z.enum([
	"pause",
	"resume",
	"retire"
]) }).strict();
var collaborationLifecycleSchema = base.extend({
	state: z.enum([
		"active",
		"paused",
		"retired"
	]),
	generation: z.number().int().nonnegative(),
	acceptingNewWork: z.boolean()
}).strict();
//#endregion
//#region ../../packages/common/contracts/meeting.ts
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
//#region ../../packages/common/configuration/se-domains.ts
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
//#region ../../packages/common/contracts/mcp.ts
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
//#region ../../packages/common/contracts/portfolio.ts
var accountProvenanceSchema = z.enum([
	"deal-team",
	"manual",
	"both"
]);
var accountVisibilitySchema = z.enum(["visible", "hidden"]);
var accountSchema$1 = z.object({
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
var accountCandidateSchema = accountSchema$1.extend({ state: z.enum([
	"not-added",
	"visible",
	"hidden"
]) }).strict();
var accountListOptionsSchema = z.object({ includeHidden: z.boolean().optional() }).strict();
z.object({ visibility: accountVisibilitySchema }).strict();
var dealTeamJoinResultSchema = z.object({
	opportunityId: z.string().min(1),
	onDealTeam: z.literal(true),
	alreadyMember: z.boolean()
}).strict();
var dealTeamLeaveResultSchema = z.object({
	opportunityId: z.string().min(1),
	onDealTeam: z.literal(false),
	alreadyAbsent: z.boolean()
}).strict();
var voiceLimits = {
	maxAudioMs: 3e4,
	silenceMs: 1e4,
	maxTranscriptChars: 2e3,
	maxSegments: 64,
	finalizationMs: 1e3
};
var voiceAvailabilitySchema = z.discriminatedUnion("available", [z.object({
	available: z.literal(true),
	processing: z.literal("on-device"),
	engine: z.enum(["windows-offline", "browser-offline"])
}).strict(), z.object({
	available: z.literal(false),
	reason: z.enum([
		"unsupported-platform",
		"remote-host",
		"missing-language",
		"not-configured"
	]),
	message: z.string().min(1).max(400)
}).strict()]);
var voiceSegmentSchema = z.object({
	id: z.string().min(1).max(80),
	sequence: z.number().int().nonnegative(),
	text: z.string().max(voiceLimits.maxTranscriptChars),
	isFinal: z.boolean()
}).strict();
var voiceErrorCodeSchema = z.enum([
	"permission-denied",
	"no-speech",
	"device-lost",
	"provider-error",
	"cancelled"
]);
z.discriminatedUnion("type", [
	z.object({
		contractVersion: z.literal("1.0"),
		type: z.literal("started")
	}).strict(),
	z.object({
		contractVersion: z.literal("1.0"),
		type: z.literal("segment"),
		segment: voiceSegmentSchema.extend({ text: z.string().max(16384) }).strict()
	}).strict(),
	z.object({
		contractVersion: z.literal("1.0"),
		type: z.literal("ended")
	}).strict(),
	z.object({
		contractVersion: z.literal("1.0"),
		type: z.literal("error"),
		code: voiceErrorCodeSchema,
		message: z.string().min(1).max(400)
	}).strict()
]);
var envelope = { contractVersion: z.literal("1.0") };
var voiceStartRequestSchema = z.object({
	...envelope,
	operation: z.literal("start"),
	sessionId: z.string().uuid(),
	locale: z.literal("en-US"),
	consent: z.literal(true),
	hints: z.array(z.string().trim().min(1).max(200)).max(64).default([])
}).strict();
z.discriminatedUnion("operation", [
	z.object({
		...envelope,
		operation: z.literal("availability")
	}).strict(),
	voiceStartRequestSchema,
	z.object({
		...envelope,
		operation: z.enum([
			"read",
			"stop",
			"cancel"
		]),
		sessionId: z.string().uuid()
	}).strict()
]);
var voiceSessionSchema = z.object({
	...envelope,
	kind: z.literal("session"),
	sessionId: z.string().uuid(),
	status: z.enum([
		"arming",
		"listening",
		"finalizing",
		"ended",
		"cancelled",
		"error"
	]),
	segments: z.array(voiceSegmentSchema).max(voiceLimits.maxSegments),
	message: z.string().max(400),
	errorCode: voiceErrorCodeSchema.optional()
}).strict();
z.discriminatedUnion("kind", [z.object({
	...envelope,
	kind: z.literal("availability"),
	availability: voiceAvailabilitySchema
}).strict(), voiceSessionSchema]);
var text$1 = z.string().max(3e4);
var name = z.string().min(1).max(500);
var identifier = z.string().min(1).max(200);
var tpid = z.string().regex(/^[1-9][0-9]{0,19}$/);
var amount = z.number().finite();
var nonnegative = amount.nonnegative();
var count = z.number().int().nonnegative();
var date$1 = z.iso.date();
var timestamp = z.iso.datetime({ offset: true });
var quality = z.enum([
	"complete",
	"partial",
	"unavailable"
]);
var timing = z.enum([
	"overdue",
	"in-quarter",
	"future",
	"undated"
]);
var bucketSchema = z.object({
	name,
	weight: amount.min(0).max(1),
	unit: z.literal("USD"),
	attainment: amount,
	actual: amount,
	quota: amount,
	recurring: amount,
	calcActual: amount,
	calcQuota: nonnegative,
	gap: nonnegative
}).strict();
var metricSchema = z.object({
	name,
	bucket: name,
	unit: z.literal("USD"),
	mappingSupported: z.boolean(),
	scenarioAllowed: z.boolean(),
	attainment: amount,
	actual: amount,
	quota: amount,
	recurring: amount,
	calcActual: amount,
	calcQuota: amount,
	gap: nonnegative,
	closedGap: nonnegative,
	closedAttainment: amount.nullable(),
	accountActualDifference: amount,
	accountQuotaDifference: amount
}).strict();
var accountMetricSchema = z.object({
	metric: name,
	bucket: name,
	quota: nonnegative,
	actual: amount.nullable(),
	variance: amount.nullable(),
	gap: nonnegative.nullable()
}).strict();
var accountSchema = z.object({
	tpid,
	name,
	metrics: z.array(accountMetricSchema).max(100),
	pipeline: z.object({
		status: quality,
		openCount: count,
		inQuarterCount: count,
		inQuarterValue: amount,
		productionCount: count,
		inQuarterProductionCount: count,
		committedMonthly: amount,
		uncommittedMonthly: amount,
		noPipeline: z.boolean(),
		noInQuarterPipeline: z.boolean()
	}).strict(),
	nextAction: text$1
}).strict();
var opportunitySchema$1 = z.object({
	id: identifier,
	number: text$1,
	tpid,
	account: name,
	name,
	owner: text$1,
	stage: text$1,
	solutionArea: text$1,
	salesPlay: text$1,
	intent: text$1,
	estimatedValue: amount.nullable(),
	currency: text$1,
	monthlyRunRate: amount.nullable(),
	closeDate: date$1.nullable(),
	state: text$1,
	forecastComments: text$1,
	timing,
	relevance: text$1,
	modifiedAt: timestamp.optional(),
	estimatedBilledRevenue: amount.nullable().optional(),
	estimatedSqlRevenue: amount.nullable().optional()
}).strict();
var milestoneSchema$1 = z.object({
	id: identifier,
	number: text$1,
	opportunityId: identifier,
	opportunityName: name,
	tpid,
	account: name,
	name,
	owner: text$1,
	category: text$1,
	status: text$1,
	commitment: text$1,
	monthly: amount.nullable(),
	date: date$1.nullable(),
	workload: text$1,
	forecastComments: text$1,
	currency: text$1,
	active: z.boolean().nullable(),
	timing,
	metricCandidates: z.array(name).max(100),
	mappingBasis: text$1,
	classification: text$1,
	scenarioCredit: amount.nullable(),
	modifiedAt: timestamp.optional(),
	commitmentChangedAt: timestamp.optional(),
	region: text$1.optional(),
	riskDetails: text$1.optional()
}).strict();
var coverageSchema = z.object({
	metric: name,
	bucket: name,
	gap: nonnegative,
	candidateCount: count,
	committedMonthly: amount,
	uncommittedMonthly: amount,
	verifiedPeriodCredit: z.null(),
	state: text$1,
	mappingSupported: z.boolean(),
	mappingReviewRequired: z.boolean(),
	scenarioAllowed: z.boolean(),
	scenarioCommittedCredit: amount.nullable(),
	scenarioUncommittedCredit: amount.nullable(),
	scenarioRemainingGap: amount.nullable(),
	nextAction: text$1
}).strict();
var sellerDashboardReportSchema = z.object({
	schemaVersion: z.literal(1),
	generatedAt: timestamp,
	plan: z.object({
		currency: z.literal("USD"),
		unit: z.literal("USD"),
		fiscalYear: z.number().int().min(2e3).max(2200),
		sourceUnitsVerified: z.boolean(),
		metricMapping: z.array(z.object({
			metric: name,
			bucket: name,
			hintSupported: z.boolean(),
			state: text$1,
			scenarioAllowed: z.boolean()
		}).strict()).max(100),
		unmappedProductionCandidates: count
	}).strict(),
	period: z.object({
		label: name,
		start: date$1,
		end: date$1,
		today: date$1
	}).strict(),
	sources: z.object({
		earnings: z.object({
			status: z.enum(["live", "stale"]),
			generatedAt: timestamp,
			refreshedAt: timestamp.nullable(),
			months: z.array(name).max(12),
			ageDays: z.number().int().nullable()
		}).strict(),
		pipeline: z.object({
			status: quality,
			asOf: timestamp.nullable(),
			errors: z.array(text$1).max(1e3)
		}).strict(),
		quota: z.object({
			name,
			rows: count,
			accounts: count.max(200)
		}).strict()
	}).strict(),
	warnings: z.array(text$1).max(1e3),
	official: z.object({
		weightedAttainment: amount,
		closedMonthAttainment: amount.nullable(),
		closedThrough: name.nullable(),
		buckets: z.array(bucketSchema).min(1).max(100),
		metrics: z.array(metricSchema).min(1).max(100)
	}).strict(),
	accounts: z.array(accountSchema).min(1).max(200),
	opportunities: z.array(opportunitySchema$1).max(5e4),
	milestones: z.array(milestoneSchema$1).max(5e4),
	coverage: z.array(coverageSchema).max(100),
	actions: z.array(z.object({
		account: name,
		tpid,
		metric: name,
		priority: z.enum([
			"High",
			"Medium",
			"Low"
		]),
		issue: text$1,
		action: text$1,
		owner: text$1
	}).strict()).max(2e4),
	methodology: z.array(text$1).max(100)
}).strict().superRefine((report, context) => {
	const reject = (message) => context.addIssue({
		code: "custom",
		message
	});
	const unique = (values, label) => {
		if (new Set(values).size !== values.length) reject(`Duplicate ${label}.`);
	};
	const close = (left, right) => Math.abs(left - right) <= .01;
	const { buckets, metrics } = report.official;
	unique(buckets.map((row) => row.name), "bucket");
	unique(metrics.map((row) => row.name), "metric");
	unique(report.accounts.map((row) => row.tpid), "account");
	unique(report.opportunities.map((row) => row.id), "opportunity");
	unique(report.milestones.map((row) => row.id), "milestone");
	unique(report.coverage.map((row) => row.metric), "coverage metric");
	if (Math.abs(buckets.reduce((sum, row) => sum + row.weight, 0) - 1) > 1e-6) reject("Official bucket weights must sum to one.");
	if (report.period.start > report.period.end) reject("Invalid official reporting interval.");
	if (report.period.today < report.period.start || Date.parse(report.period.today) > Date.parse(report.period.end) + 26784e5) reject("As-of date is outside the supported official reporting interval.");
	if (report.period.start < `${report.plan.fiscalYear - 1}-07-01` || report.period.end > `${report.plan.fiscalYear}-06-30`) reject("Reporting interval is outside the fiscal year.");
	for (const row of [...buckets, ...metrics]) if (!close(row.gap, Math.max(row.calcQuota - row.calcActual, 0))) reject("Posted gap does not reconcile to signed calculated amounts.");
	const metricMap = new Map(metrics.map((row) => [row.name, row]));
	const bucketNames = new Set(buckets.map((row) => row.name));
	if (metrics.some((row) => !bucketNames.has(row.bucket))) reject("Unknown metric bucket.");
	if (report.plan.metricMapping.length !== metrics.length || report.plan.metricMapping.some((row) => metricMap.get(row.metric)?.bucket !== row.bucket)) reject("Plan metric mapping does not reconcile.");
	unique(report.plan.metricMapping.map((row) => row.metric), "plan mapping");
	const accountMap = new Map(report.accounts.map((row) => [row.tpid, row]));
	const opportunityMap = new Map(report.opportunities.map((row) => [row.id, row]));
	if (report.sources.quota.accounts !== report.accounts.length) reject("Quota account count does not reconcile.");
	for (const account of report.accounts) {
		unique(account.metrics.map((row) => row.metric), "account metric");
		const accountMetricNames = new Set(account.metrics.map((row) => row.metric));
		if (metrics.some((metric) => !accountMetricNames.has(metric.name))) reject("Account metrics must include the complete official metric set.");
		for (const row of account.metrics) {
			if (metricMap.get(row.metric)?.bucket !== row.bucket) reject("Unknown account metric mapping.");
			if (row.actual === null) {
				if (row.gap !== null || row.variance !== null) reject("Missing actuals cannot establish an account gap.");
			} else if (row.gap === null || row.variance === null || !close(row.gap, Math.max(row.quota - row.actual, 0)) || !close(row.variance, row.actual - row.quota)) reject("Account amounts do not reconcile.");
		}
		if (account.pipeline.status !== "complete" && (account.pipeline.noPipeline || account.pipeline.noInQuarterPipeline)) reject("Incomplete retrieval cannot establish absent pipeline.");
		if (report.sources.pipeline.status === "unavailable" && account.pipeline.status !== "unavailable") reject("Unavailable global retrieval cannot establish complete account data.");
	}
	for (const row of [...report.opportunities, ...report.milestones]) {
		if (accountMap.get(row.tpid)?.name !== row.account) reject("Pipeline is outside the quota roster.");
		const value = "date" in row ? row.date : row.closeDate;
		const expectedTiming = value === null ? "undated" : value < report.period.today ? "overdue" : value > report.period.end ? "future" : "in-quarter";
		if (row.timing !== expectedTiming) reject("Pipeline timing does not match source dates.");
	}
	for (const row of report.milestones) {
		const parent = opportunityMap.get(row.opportunityId);
		if (!parent || parent.tpid !== row.tpid) reject("Milestone parent attribution is invalid.");
		if (row.metricCandidates.some((metric) => !metricMap.has(metric))) reject("Unknown candidate metric.");
		if (parent?.state === "Lost" && row.active === true) reject("A lost parent cannot supply active consumption.");
		if (row.active === null && accountMap.get(row.tpid)?.pipeline.status === "complete") reject("Unknown milestone activity requires incomplete source quality.");
	}
	for (const row of report.coverage) {
		const metric = metricMap.get(row.metric);
		if (!metric || metric.bucket !== row.bucket || !close(row.gap, metric.gap)) reject("Coverage does not reconcile to the official metric.");
	}
	for (const row of report.actions) if (!accountMap.has(row.tpid) || !metricMap.has(row.metric)) reject("Action is outside the reporting scope.");
});
var supplementSourceSchema = z.object({
	name,
	status: quality,
	asOf: timestamp,
	start: date$1,
	end: date$1,
	detail: text$1
}).strict().refine((source) => source.start <= source.end, "Invalid supplemental source interval.");
var sellerDashboardSupplementSchema = z.object({
	schemaVersion: z.literal(1),
	consumption: z.object({
		source: supplementSourceSchema,
		accounts: z.array(z.object({
			tpid,
			actual: nonnegative,
			previousActual: nonnegative.nullable(),
			averageDaily: nonnegative,
			projected: nonnegative.nullable(),
			daysPosted: count,
			pillars: z.array(z.object({
				name,
				actual: nonnegative
			}).strict()).max(100)
		}).strict()).max(200),
		services: z.array(z.object({
			id: identifier,
			tpid,
			name,
			pillar: name,
			previousDaily: nonnegative,
			currentDaily: nonnegative,
			isNew: z.boolean()
		}).strict()).max(5e4),
		subscriptions: z.array(z.object({
			id: identifier,
			tpid,
			name,
			created: date$1,
			averageDaily: nonnegative
		}).strict()).max(5e4),
		sqlReclassification: z.array(z.object({
			id: identifier,
			tpid,
			workload: name,
			monthlyOpportunity: nonnegative,
			evidence: text$1
		}).strict()).max(5e4)
	}).strict().nullable(),
	conversion: z.object({
		source: supplementSourceSchema,
		accounts: z.array(z.object({
			tpid,
			territory: text$1,
			startingMonthly: nonnegative,
			convertedMonthly: nonnegative,
			inQuarterMonthly: nonnegative,
			shiftedOutMonthly: nonnegative,
			startingCount: count,
			convertedCount: count
		}).strict()).max(200)
	}).strict().nullable()
}).strict().superRefine((supplement, context) => {
	const reject = (message) => context.addIssue({
		code: "custom",
		message
	});
	const consumption = supplement.consumption;
	if (consumption) {
		if (new Set(consumption.accounts.map((row) => row.tpid)).size !== consumption.accounts.length) reject("Duplicate consumption account.");
		for (const row of consumption.accounts) {
			if (row.daysPosted > 31 || row.daysPosted === 0 && row.actual !== 0) reject("Invalid posted consumption days.");
			if (Math.abs(row.pillars.reduce((sum, pillar) => sum + pillar.actual, 0) - row.actual) > .01) reject("Pillar consumption does not reconcile to the account.");
		}
	}
	const conversion = supplement.conversion;
	if (conversion) {
		if (new Set(conversion.accounts.map((row) => row.tpid)).size !== conversion.accounts.length) reject("Duplicate conversion account.");
		for (const row of conversion.accounts) if (row.convertedCount > row.startingCount || row.convertedMonthly > row.startingMonthly || Math.abs(row.inQuarterMonthly + row.shiftedOutMonthly - row.convertedMonthly) > .01) reject("Conversion does not reconcile to the historical baseline.");
	}
});
var sellerDashboardSnapshotSchema = z.object({
	contractVersion: z.literal("1.0"),
	kind: z.literal("snapshot"),
	mode: z.enum(["sample", "live"]),
	state: z.enum(["ready", "stale"]),
	message: text$1,
	report: sellerDashboardReportSchema,
	supplement: sellerDashboardSupplementSchema.nullable()
}).strict().superRefine((snapshot, context) => {
	const tpids = new Set(snapshot.report.accounts.map((row) => row.tpid));
	const consumption = snapshot.supplement?.consumption;
	if ([
		...consumption?.accounts ?? [],
		...consumption?.services ?? [],
		...consumption?.subscriptions ?? [],
		...consumption?.sqlReclassification ?? [],
		...snapshot.supplement?.conversion?.accounts ?? []
	].some((row) => !tpids.has(row.tpid))) context.addIssue({
		code: "custom",
		message: "Supplemental data is outside the quota roster."
	});
	for (const source of [consumption, snapshot.supplement?.conversion]) if (source?.source.status === "complete" && source.accounts.length !== tpids.size) context.addIssue({
		code: "custom",
		message: "A complete supplemental source must cover the quota account roster."
	});
});
var sellerDashboardUnavailableSchema = z.object({
	contractVersion: z.literal("1.0"),
	kind: z.literal("unavailable"),
	mode: z.literal("live"),
	code: z.enum([
		"not-configured",
		"unsupported-platform",
		"identity-mismatch",
		"invalid-snapshot",
		"runtime-failed",
		"hosted-profile-denied"
	]),
	message: name
}).strict();
var sellerDashboardResponseSchema = z.discriminatedUnion("kind", [sellerDashboardSnapshotSchema, sellerDashboardUnavailableSchema]);
var sellerDashboardRequestSchema = z.discriminatedUnion("operation", [z.object({
	contractVersion: z.literal("1.0"),
	operation: z.literal("get")
}).strict(), z.object({
	contractVersion: z.literal("1.0"),
	operation: z.literal("refresh"),
	confirmed: z.literal(true),
	asOf: date$1.optional()
}).strict()]);
//#endregion
//#region ../../packages/common/contracts/record-creation.ts
var clientKeySchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
var dateSchema = z.string().date();
var textSchema = z.string().trim().min(1).max(200);
var choiceRefSchema = z.object({
	value: z.number().int(),
	label: textSchema
}).strict();
var lookupRefSchema = z.object({
	id: z.string().trim().min(1).max(200),
	label: textSchema
}).strict();
var currencyRefSchema = lookupRefSchema.extend({ isoCode: z.string().length(3) });
var recordCreationTargetSchema = z.enum([
	"sqlite",
	"draft",
	"live-msx"
]);
var milestoneCreateInputSchema = z.object({
	clientMilestoneKey: clientKeySchema,
	name: z.string().trim().min(1).max(100),
	category: choiceRefSchema,
	milestoneDate: dateSchema,
	workload: lookupRefSchema,
	owner: lookupRefSchema.optional(),
	status: choiceRefSchema.optional(),
	commitment: choiceRefSchema.optional(),
	estimatedMonthlyUsage: z.number().finite().nonnegative().max(922337203685477).optional(),
	comments: z.string().max(35e3).optional(),
	riskDetails: z.string().trim().max(2e3).optional(),
	customerBudgetApproved: choiceRefSchema.optional()
}).strict().superRefine((item, context) => {
	if ((item.status?.value === 861980001 || item.status?.value === 861980002) && !item.riskDetails) context.addIssue({
		code: "custom",
		path: ["riskDetails"],
		message: "Risk/Blocker Details are required for At Risk or Blocked milestones."
	});
});
var opportunityCreateInputSchema = z.object({
	clientOpportunityKey: clientKeySchema,
	name: z.string().trim().min(1).max(200),
	intent: z.array(choiceRefSchema).min(1).max(2).refine((items) => new Set(items.map((item) => item.value)).size === items.length, "Opportunity Intent choices must not repeat."),
	estimatedValue: z.number().finite().nonnegative().max(0xe8d4a51000),
	priceList: lookupRefSchema.optional(),
	currency: lookupRefSchema.optional(),
	owner: lookupRefSchema.optional(),
	estimatedCloseDate: dateSchema,
	need: z.string().max(2e3).optional(),
	solutionArea: choiceRefSchema.optional(),
	technicalCapability: choiceRefSchema.optional()
}).strict();
var opportunityBundleSchema = z.object({
	opportunity: opportunityCreateInputSchema,
	milestones: z.array(milestoneCreateInputSchema).max(50)
}).strict();
var opportunityBatchDraftSchema = z.object({
	kind: z.literal("opportunity-batch"),
	account: lookupRefSchema,
	opportunities: z.array(opportunityBundleSchema).min(1).max(50)
}).strict();
var existingOpportunityMilestoneBatchDraftSchema = z.object({
	kind: z.literal("existing-opportunity-milestone-batch"),
	account: lookupRefSchema,
	opportunity: lookupRefSchema,
	milestones: z.array(milestoneCreateInputSchema).min(1).max(50)
}).strict();
var recordCreationDraftSchema = z.discriminatedUnion("kind", [opportunityBatchDraftSchema, existingOpportunityMilestoneBatchDraftSchema]).superRefine((draft, context) => {
	const opportunityKeys = /* @__PURE__ */ new Set();
	const milestoneKeys = /* @__PURE__ */ new Set();
	const bundles = draft.kind === "opportunity-batch" ? draft.opportunities.map((bundle, index) => ({
		key: bundle.opportunity.clientOpportunityKey,
		milestones: bundle.milestones,
		index
	})) : [{
		key: draft.opportunity.id,
		milestones: draft.milestones,
		index: 0
	}];
	for (const { key, milestones, index } of bundles) {
		if (draft.kind === "opportunity-batch" && opportunityKeys.has(key)) context.addIssue({
			code: "custom",
			path: [
				"opportunities",
				index,
				"opportunity",
				"clientOpportunityKey"
			],
			message: "Opportunity keys must be unique."
		});
		opportunityKeys.add(key);
		for (const [milestoneIndex, milestone] of milestones.entries()) {
			if (milestoneKeys.has(milestone.clientMilestoneKey)) context.addIssue({
				code: "custom",
				path: draft.kind === "opportunity-batch" ? [
					"opportunities",
					index,
					"milestones",
					milestoneIndex
				] : ["milestones", milestoneIndex],
				message: "Milestone keys must be unique."
			});
			milestoneKeys.add(milestone.clientMilestoneKey);
		}
	}
});
var creationChoicesSchema = z.object({
	intent: z.array(choiceRefSchema),
	category: z.array(choiceRefSchema),
	status: z.array(choiceRefSchema),
	commitment: z.array(choiceRefSchema),
	customerBudgetApproved: z.array(choiceRefSchema),
	solutionArea: z.array(choiceRefSchema),
	technicalCapability: z.array(choiceRefSchema)
}).strict();
var recordCreationCatalogSchema = z.object({
	contractVersion: z.literal("1.2"),
	target: z.enum(["sqlite", "draft"]),
	revision: z.string().min(1),
	account: lookupRefSchema,
	opportunities: z.array(lookupRefSchema.extend({ currency: currencyRefSchema.optional() })),
	priceLists: z.array(lookupRefSchema),
	currencies: z.array(currencyRefSchema),
	workloads: z.array(lookupRefSchema),
	owners: z.array(lookupRefSchema),
	defaults: z.object({
		owner: lookupRefSchema,
		priceList: lookupRefSchema.optional(),
		currency: currencyRefSchema.optional()
	}).strict(),
	choices: creationChoicesSchema,
	maxMutations: z.number().int().positive().max(999)
}).strict();
var recordCreationCatalogRequestSchema = z.object({
	contractVersion: z.literal("1.2"),
	accountId: z.string().trim().min(1).max(200)
}).strict();
var recordCreationPreviewRequestSchema = z.object({
	contractVersion: z.literal("1.2"),
	target: recordCreationTargetSchema,
	draft: recordCreationDraftSchema
}).strict();
var recordCreationPreviewSchema = z.object({
	contractVersion: z.literal("1.2"),
	batchId: z.string().min(1),
	digest: z.string().regex(/^[a-f0-9]{64}$/),
	target: z.enum(["sqlite", "draft"]),
	catalogRevision: z.string().min(1),
	normalizedDraft: recordCreationDraftSchema,
	mutationCount: z.number().int().positive(),
	warnings: z.array(z.string().min(1)),
	expiresAt: z.string().datetime()
}).strict();
var recordCreationCommitRequestSchema = z.object({
	contractVersion: z.literal("1.2"),
	preview: recordCreationPreviewSchema,
	expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
	confirmed: z.literal(true)
}).strict();
var recordCreationItemResultSchema = z.object({
	clientKey: z.string().min(1),
	kind: z.enum([
		"opportunity",
		"milestone",
		"deal-team"
	]),
	recordId: z.string().min(1).optional(),
	parentRecordId: z.string().min(1).optional()
}).strict();
var recordCreationResultSchema = z.object({
	contractVersion: z.literal("1.2"),
	batchId: z.string().min(1),
	target: z.enum(["sqlite", "draft"]),
	state: z.enum([
		"committed",
		"drafted",
		"rolled-back",
		"reconciled"
	]),
	created: z.array(recordCreationItemResultSchema),
	audit: z.object({
		correlationId: z.string().min(1),
		opportunityCount: z.number().int().nonnegative(),
		milestoneCount: z.number().int().nonnegative(),
		committedAt: z.string().datetime().optional()
	}).strict(),
	message: z.string().min(1)
}).strict().superRefine((result, context) => {
	if (result.target === "draft") {
		if (result.state !== "drafted" || result.created.length > 0 || result.audit.committedAt) context.addIssue({
			code: "custom",
			path: ["state"],
			message: "Drafts cannot claim committed records or a commit time."
		});
	} else if (result.state === "drafted") context.addIssue({
		code: "custom",
		path: ["state"],
		message: "A SQLite result cannot be a draft."
	});
	if (result.state === "committed") {
		const count = (kind) => result.created.filter((item) => item.kind === kind).length;
		if (!result.audit.committedAt || count("opportunity") !== result.audit.opportunityCount || count("deal-team") !== result.audit.opportunityCount || count("milestone") !== result.audit.milestoneCount) context.addIssue({
			code: "custom",
			path: ["created"],
			message: "A commit receipt must match its created-record counts and commit time."
		});
	}
});
var recordCreationDraftResultSchema = z.object({
	contractVersion: z.literal("1.2"),
	result: recordCreationResultSchema,
	files: z.array(z.object({
		name: z.string().min(1),
		content: z.string(),
		mimeType: z.string().min(1)
	}).strict()).min(1)
}).strict();
z.object({
	code: z.enum([
		"validation-failed",
		"parent-unavailable",
		"reference-unavailable",
		"catalog-changed",
		"stale-preview",
		"batch-too-large",
		"target-disabled",
		"already-committed",
		"transaction-failed",
		"ambiguous-outcome"
	]),
	message: z.string().min(1),
	path: z.array(z.union([z.string(), z.number()])).optional()
}).strict();
//#endregion
//#region ../../packages/common/contracts/index.ts
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
	opportunityIntent: z.array(z.string().trim().min(1)).max(10).optional(),
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
/**
* Result of adding the signed-in user to a milestone team. Mirrors the
* opportunity Deal Team join result but is scoped to a single milestone and is
* fully independent of Deal Team membership.
*/
var milestoneTeamJoinResultSchema = z.object({
	opportunityId: z.string().min(1),
	milestoneId: z.string().min(1),
	onMilestoneTeam: z.literal(true),
	alreadyMember: z.boolean()
}).strict();
/** Result of removing only the signed-in user from a milestone team. */
var milestoneTeamLeaveResultSchema = z.object({
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
/** An Activity (Task) associated with a milestone via the activity's `regardingobjectid`. */
var milestoneActivitySchema = z.object({
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
	contractVersion: z.literal("1.2"),
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
	contractVersion: z.literal("1.2"),
	accountId: z.string().min(1),
	opportunityId: z.string().min(1),
	prompt: z.string().min(3).max(1e3)
});
var agentCapabilitySchema = z.enum(workflowAgentCapabilityValues);
var agentTaskRequestSchema = z.object({
	contractVersion: z.literal("1.2"),
	capability: agentCapabilitySchema,
	accountId: z.string().min(1),
	opportunityId: z.string().min(1),
	prompt: z.string().min(3).max(1e3)
});
var agentTaskResponseSchema = z.object({
	contractVersion: z.literal("1.2"),
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
	contractVersion: z.literal("1.2"),
	recipients: z.array(z.string().email()).min(1).max(20),
	subject: z.string().trim().min(1).max(255),
	responseTitle: z.string().trim().min(1).max(255),
	responseMarkdown: z.string().min(1).max(2e5)
}).strict();
z.object({ state: z.literal("opened") }).strict();
var exportResponseRequestSchema = z.object({
	contractVersion: z.literal("1.2"),
	responseTitle: z.string().trim().min(1).max(255),
	responseMarkdown: z.string().min(1).max(2e5),
	generatedAt: z.string().datetime()
}).strict();
z.discriminatedUnion("state", [z.object({
	state: z.literal("saved"),
	filePath: z.string().min(1)
}).strict(), z.object({ state: z.literal("cancelled") }).strict()]);
var mcemResponseSchema = z.object({
	contractVersion: z.literal("1.2"),
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
//#region ../../packages/documents/outlook-compose.ts
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
//#region ../../packages/documents/response-document.ts
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
//#region ../../packages/common/contracts/workflow-output.ts
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
var workflowRunViewSchema = z.object({
	run: workflowRunSchema,
	output: initialWorkflowOutputSchema.optional()
}).strict();
//#endregion
//#region ../../packages/orchestrator/workflows/cohort.ts
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
//#region ../../packages/common/configuration/dataverse-entity-map.ts
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
//#region ../../packages/common/configuration/mcp-servers.ts
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
//#region ../../packages/common/configuration/mcp-tool-policy.ts
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
//#region ../../packages/common/configuration/workflow-descriptions.ts
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
//#region ../../packages/common/sharing/opportunity-link.ts
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
//#region ../../packages/common/telemetry/performance.ts
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
//#region ../../packages/common/fixtures/additional-sample-portfolio.ts
var additionalSampleAccounts = Object.freeze([
	accountSchema$1.parse({
		id: "account-fourth-coffee",
		name: "Fourth Coffee",
		segment: "Enterprise",
		tpid: "1000006"
	}),
	accountSchema$1.parse({
		id: "account-tailspin-toys",
		name: "Tailspin Toys",
		segment: "Corporate",
		tpid: "1000007"
	}),
	accountSchema$1.parse({
		id: "account-wide-world-importers",
		name: "Wide World Importers",
		segment: "Strategic",
		tpid: "1000008"
	}),
	accountSchema$1.parse({
		id: "account-woodgrove-bank",
		name: "Woodgrove Bank",
		segment: "Strategic",
		tpid: "1000009"
	})
]);
var additionalSampleOpportunities = Object.freeze([
	opportunitySchema.parse({
		id: "opp-fourth-coffee-loyalty",
		accountId: "account-fourth-coffee",
		name: "Customer loyalty Copilot",
		owner: "Priya Shah",
		recordedStage: 2,
		value: 215e4,
		currency: "USD",
		closeDate: "2027-02-19"
	}),
	opportunitySchema.parse({
		id: "opp-fourth-coffee-analytics",
		accountId: "account-fourth-coffee",
		name: "Store analytics modernization - ready to advance",
		owner: "Marcus Chen",
		recordedStage: 4,
		value: 54e5,
		currency: "USD",
		closeDate: "2026-12-18"
	}),
	opportunitySchema.parse({
		id: "opp-tailspin-ecommerce",
		accountId: "account-tailspin-toys",
		name: "Global ecommerce expansion",
		recordedStage: 1,
		value: 13e5,
		currency: "USD",
		closeDate: "2027-06-11"
	}),
	opportunitySchema.parse({
		id: "opp-tailspin-forecasting",
		accountId: "account-tailspin-toys",
		name: "Demand forecasting platform",
		owner: "Elena Ruiz",
		recordedStage: 3,
		value: 375e4,
		currency: "USD",
		closeDate: "2027-01-22"
	}),
	opportunitySchema.parse({
		id: "opp-wwi-control-tower",
		accountId: "account-wide-world-importers",
		name: "Supply chain control tower - ready to advance",
		owner: "Noah Williams",
		recordedStage: 3,
		value: 62e5,
		currency: "USD",
		closeDate: "2026-11-27"
	}),
	opportunitySchema.parse({
		id: "opp-wwi-warehouse-edge",
		accountId: "account-wide-world-importers",
		name: "Warehouse edge modernization",
		owner: "Aisha Khan",
		recordedStage: 2,
		value: 28e5,
		currency: "USD",
		closeDate: "2027-04-16"
	}),
	opportunitySchema.parse({
		id: "opp-woodgrove-fraud-ai",
		accountId: "account-woodgrove-bank",
		name: "AI fraud prevention expansion",
		owner: "Daniel Kim",
		recordedStage: 4,
		value: 78e5,
		currency: "USD",
		closeDate: "2026-12-04"
	}),
	opportunitySchema.parse({
		id: "opp-woodgrove-regulatory-data",
		accountId: "account-woodgrove-bank",
		name: "Regulatory data estate",
		recordedStage: 1,
		value: 41e5,
		currency: "USD",
		closeDate: "2027-05-14"
	})
]);
var additionalSampleMilestones = Object.freeze([
	milestoneSchema.parse({
		id: "ms-fourth-loyalty-outcome",
		opportunityId: "opp-fourth-coffee-loyalty",
		name: "Loyalty outcome validation",
		status: "Completed",
		targetDate: "2026-11-06",
		estimatedMonthlyUsage: 95e3,
		owner: "Priya Shah",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-fourth-loyalty-data",
		opportunityId: "opp-fourth-coffee-loyalty",
		name: "Customer data readiness",
		status: "At Risk",
		targetDate: "2026-12-04",
		estimatedMonthlyUsage: 14e4,
		owner: "Solution Engineer",
		commitment: "Uncommitted",
		riskDetails: "Consent and identity-resolution ownership are not confirmed."
	}),
	milestoneSchema.parse({
		id: "ms-fourth-loyalty-pilot",
		opportunityId: "opp-fourth-coffee-loyalty",
		name: "Copilot pilot decision",
		status: "On Track",
		targetDate: "2027-01-15",
		estimatedMonthlyUsage: 18e4,
		owner: "Priya Shah",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-fourth-analytics-scale",
		opportunityId: "opp-fourth-coffee-analytics",
		name: "Store telemetry scale validation",
		status: "Completed",
		targetDate: "2026-09-18",
		estimatedMonthlyUsage: 28e4,
		owner: "Marcus Chen",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-fourth-analytics-funding",
		opportunityId: "opp-fourth-coffee-analytics",
		name: "Production funding approval",
		status: "Completed",
		targetDate: "2026-10-23",
		estimatedMonthlyUsage: 36e4,
		owner: "Finance sponsor",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-fourth-analytics-deploy",
		opportunityId: "opp-fourth-coffee-analytics",
		name: "Wave-one deployment",
		status: "On Track",
		targetDate: "2026-11-20",
		estimatedMonthlyUsage: 45e4,
		owner: "Cloud Solution Architect",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-commerce-discovery",
		opportunityId: "opp-tailspin-ecommerce",
		name: "International market discovery",
		status: "In Progress",
		targetDate: "2027-01-29",
		estimatedMonthlyUsage: 55e3,
		commitment: "Uncommitted"
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-commerce-security",
		opportunityId: "opp-tailspin-ecommerce",
		name: "Payment security review",
		status: "Blocked",
		estimatedMonthlyUsage: 72e3,
		owner: "Security lead",
		commitment: "Uncommitted",
		riskDetails: "The target payment provider and data residency model are undecided."
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-commerce-sponsor",
		opportunityId: "opp-tailspin-ecommerce",
		name: "Executive sponsor confirmation",
		status: "At Risk",
		targetDate: "2027-03-12",
		estimatedMonthlyUsage: 8e4,
		commitment: "Uncommitted",
		riskDetails: "No executive sponsor is recorded."
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-forecast-data",
		opportunityId: "opp-tailspin-forecasting",
		name: "Historical demand data validation",
		status: "Completed",
		targetDate: "2026-09-25",
		estimatedMonthlyUsage: 165e3,
		owner: "Data lead",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-forecast-model",
		opportunityId: "opp-tailspin-forecasting",
		name: "Forecast model acceptance",
		status: "At Risk",
		targetDate: "2026-11-13",
		estimatedMonthlyUsage: 235e3,
		owner: "Elena Ruiz",
		commitment: "Uncommitted",
		riskDetails: "Seasonal accuracy is below the customer threshold in two regions."
	}),
	milestoneSchema.parse({
		id: "ms-tailspin-forecast-business",
		opportunityId: "opp-tailspin-forecasting",
		name: "Inventory benefit sign-off",
		status: "On Track",
		targetDate: "2026-12-11",
		estimatedMonthlyUsage: 31e4,
		owner: "Operations sponsor",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-wwi-control-outcome",
		opportunityId: "opp-wwi-control-tower",
		name: "Control-tower outcomes agreed",
		status: "Completed",
		targetDate: "2026-08-28",
		estimatedMonthlyUsage: 26e4,
		owner: "Noah Williams",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-wwi-control-validation",
		opportunityId: "opp-wwi-control-tower",
		name: "End-to-end technical validation",
		status: "Completed",
		targetDate: "2026-09-25",
		estimatedMonthlyUsage: 39e4,
		owner: "Solution Engineer",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-wwi-control-decision",
		opportunityId: "opp-wwi-control-tower",
		name: "Production decision",
		status: "On Track",
		targetDate: "2026-10-30",
		estimatedMonthlyUsage: 515e3,
		owner: "Executive sponsor",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-wwi-edge-sites",
		opportunityId: "opp-wwi-warehouse-edge",
		name: "Pilot warehouse selection",
		status: "Completed",
		targetDate: "2026-10-09",
		estimatedMonthlyUsage: 9e4,
		owner: "Aisha Khan",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-wwi-edge-network",
		opportunityId: "opp-wwi-warehouse-edge",
		name: "Edge network readiness",
		status: "Blocked",
		targetDate: "2026-12-18",
		estimatedMonthlyUsage: 175e3,
		owner: "Network architect",
		commitment: "Uncommitted",
		riskDetails: "Two pilot sites lack approved resilient connectivity."
	}),
	milestoneSchema.parse({
		id: "ms-wwi-edge-pilot",
		opportunityId: "opp-wwi-warehouse-edge",
		name: "Operational pilot",
		status: "On Track",
		targetDate: "2027-02-12",
		estimatedMonthlyUsage: 235e3,
		owner: "Warehouse operations",
		commitment: "Uncommitted"
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-fraud-model",
		opportunityId: "opp-woodgrove-fraud-ai",
		name: "Fraud model validation",
		status: "Completed",
		targetDate: "2026-08-21",
		estimatedMonthlyUsage: 41e4,
		owner: "Daniel Kim",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-fraud-risk",
		opportunityId: "opp-woodgrove-fraud-ai",
		name: "Model risk approval",
		status: "At Risk",
		targetDate: "2026-10-16",
		estimatedMonthlyUsage: 52e4,
		owner: "Model risk officer",
		commitment: "Committed",
		riskDetails: "Explainability evidence needs one final independent review."
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-fraud-rollout",
		opportunityId: "opp-woodgrove-fraud-ai",
		name: "Regional rollout commitment",
		status: "On Track",
		targetDate: "2026-11-13",
		estimatedMonthlyUsage: 65e4,
		owner: "Fraud operations",
		commitment: "Committed"
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-data-scope",
		opportunityId: "opp-woodgrove-regulatory-data",
		name: "Regulatory scope confirmation",
		status: "In Progress",
		targetDate: "2027-01-08",
		estimatedMonthlyUsage: 12e4,
		owner: "Compliance lead",
		commitment: "Uncommitted"
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-data-owner",
		opportunityId: "opp-woodgrove-regulatory-data",
		name: "Data ownership mapping",
		status: "At Risk",
		targetDate: "2027-02-19",
		estimatedMonthlyUsage: 185e3,
		commitment: "Uncommitted",
		riskDetails: "Ownership is missing for three critical reporting domains."
	}),
	milestoneSchema.parse({
		id: "ms-woodgrove-data-architecture",
		opportunityId: "opp-woodgrove-regulatory-data",
		name: "Target architecture workshop",
		status: "On Track",
		targetDate: "2027-03-26",
		estimatedMonthlyUsage: 26e4,
		owner: "Solution Engineer",
		commitment: "Committed"
	})
]);
var additionalSampleObservationsByOpportunity = Object.freeze({
	"opp-fourth-coffee-loyalty": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "The customer targets a measurable increase in loyalty enrollment and repeat visits."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "Marketing and data owners are engaged; privacy approval remains open."
		},
		{
			criterionId: "technical-validation",
			status: "partial",
			detail: "The pilot architecture is drafted but customer data readiness is at risk."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "A pilot value hypothesis is quantified and owned by marketing."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The pilot decision meeting has a committed date and named attendees."
		}
	],
	"opp-fourth-coffee-analytics": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Store performance and inventory outcomes have approved targets."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Operations, finance, data, security, and procurement stakeholders are aligned."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "Telemetry scale and production architecture have passed validation."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance approved production funding based on pilot results."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "Wave-one deployment has committed owners and dates."
		}
	],
	"opp-tailspin-ecommerce": [
		{
			criterionId: "customer-outcome",
			status: "partial",
			detail: "International growth is stated, but market-level targets are missing."
		},
		{
			criterionId: "decision-team",
			status: "missing",
			detail: "An executive sponsor and payment decision owner are not recorded."
		},
		{
			criterionId: "technical-validation",
			status: "missing",
			detail: "Payment security and data residency decisions block solution validation."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "Revenue potential is estimated without fulfillment and compliance costs."
		},
		{
			criterionId: "next-step",
			status: "partial",
			detail: "Discovery is planned, but customer attendance is unconfirmed."
		}
	],
	"opp-tailspin-forecasting": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Inventory reduction and in-stock targets are agreed."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Supply chain, data, finance, and operations owners are engaged."
		},
		{
			criterionId: "technical-validation",
			status: "partial",
			detail: "Model quality is accepted in most regions, with two seasonal gaps."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "Benefits are quantified but await final operations sign-off."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The acceptance review has named customer attendees and a date."
		}
	],
	"opp-wwi-control-tower": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Lead-time, disruption, and inventory outcomes are customer validated."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Executive, operations, finance, security, and procurement owners are aligned."
		},
		{
			criterionId: "technical-validation",
			status: "met",
			detail: "End-to-end control-tower validation met acceptance criteria."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance validated the scale business case using pilot evidence."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The production decision is committed with named attendees."
		}
	],
	"opp-wwi-warehouse-edge": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Warehouse latency and availability targets are documented."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "Operations and architecture are engaged; the network approver is missing."
		},
		{
			criterionId: "technical-validation",
			status: "missing",
			detail: "Resilient connectivity is blocked at two pilot warehouses."
		},
		{
			criterionId: "business-case",
			status: "partial",
			detail: "The pilot cost is known but rollout economics are incomplete."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "The pilot plan has named site and Microsoft owners."
		}
	],
	"opp-woodgrove-fraud-ai": [
		{
			criterionId: "customer-outcome",
			status: "met",
			detail: "Fraud-loss and false-positive targets are agreed."
		},
		{
			criterionId: "decision-team",
			status: "met",
			detail: "Fraud, risk, data, security, and executive stakeholders are engaged."
		},
		{
			criterionId: "technical-validation",
			status: "partial",
			detail: "Model performance passed; final explainability review remains."
		},
		{
			criterionId: "business-case",
			status: "met",
			detail: "Finance validated the expansion case against measured pilot results."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "Regional rollout has committed owners and dates."
		}
	],
	"opp-woodgrove-regulatory-data": [
		{
			criterionId: "customer-outcome",
			status: "partial",
			detail: "Regulatory reporting improvement is stated without baseline cycle times."
		},
		{
			criterionId: "decision-team",
			status: "partial",
			detail: "Compliance is engaged; ownership is missing for three data domains."
		},
		{
			criterionId: "technical-validation",
			status: "missing",
			detail: "The target architecture workshop has not occurred."
		},
		{
			criterionId: "business-case",
			status: "missing",
			detail: "No validated cost or risk-reduction model is attached."
		},
		{
			criterionId: "next-step",
			status: "met",
			detail: "A target architecture workshop is committed."
		}
	]
});
//#endregion
//#region ../../packages/orchestrator/progress/run-history.ts
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
//#region ../../packages/orchestrator/workflows/runtime.ts
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
					const errorCode = getErrorCode$1(error);
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
function getErrorCode$1(error) {
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
//#region ../../packages/orchestrator/workflows/host.ts
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
z.enum([
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
//#endregion
//#region ../../packages/orchestrator/collaboration/principal.ts
function principalPartition(principal) {
	return `${principal.tenantId}:${principal.environmentId}:${principal.userId}`;
}
function requireRole(principal, role) {
	if (principal.localReadOnly === true) {
		if (role === "TLC.Teams.User" && isLocalReadOnlyPrincipal(principal)) return;
		throw new Error("This local source connection is read-only.");
	}
	if (!principal.roles.includes("TLC.Teams.User") || !principal.roles.includes(role)) throw new Error("This operation is not authorized for the current user.");
}
function isLocalReadOnlyPrincipal(principal) {
	return principal.mode === "live" && principal.localReadOnly === true && principal.roles.length === 0;
}
//#endregion
//#region ../../packages/orchestrator/collaboration/reviewed-actions.ts
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
	const json = JSON.stringify(value);
	if (json === void 0) throw new Error("A reviewed value is not serializable.");
	return json;
}
var recordSchema$1 = z.object({
	preview: actionPreviewSchema,
	before: z.unknown(),
	claimed: z.boolean(),
	claimedAt: z.iso.datetime().optional(),
	approval: actionApprovalSchema.optional(),
	receipt: actionReceiptSchema.optional()
}).strict();
var ActionReviewStaleError = class extends Error {
	constructor() {
		super("Source state or policy changed. Refresh the preview.");
		this.name = "ActionReviewStaleError";
	}
};
var ActionDispatchPreventedError = class extends Error {
	constructor() {
		super("Dispatch was prevented before any external effect.");
		this.name = "ActionDispatchPreventedError";
	}
};
var ReviewedActionService = class {
	store;
	options;
	now;
	constructor(store, options) {
		this.store = store;
		this.options = options;
		this.now = options.now ?? Date.now;
	}
	checkRole(principal, operation) {
		requireRole(principal, ["addAccount", "setAccountVisibility"].includes(operation) ? "TLC.Teams.User" : operation === "publishSummary" ? "TLC.Teams.Publisher" : "TLC.Teams.Writer");
	}
	async prepare(principal, operation, input) {
		this.checkRole(principal, operation);
		const before = await this.options.authorize(principal, operation, input);
		const id = randomUUID();
		const expiresAt = new Date(this.now() + 3e5).toISOString();
		const digest = createHash("sha256").update(canonicalJson({
			partition: principalPartition(principal),
			id,
			operation,
			input,
			before,
			expiresAt
		})).digest("hex");
		const preview = actionPreviewSchema.parse({
			contractVersion: "1.0",
			id,
			operation,
			input,
			before,
			digest,
			expiresAt,
			state: "awaiting-approval"
		});
		if (!await this.store.insert(principalPartition(principal), `action:${id}`, {
			preview,
			before,
			claimed: false
		})) throw new Error("The reviewed action could not be persisted.");
		return preview;
	}
	async commit(principal, rawApproval) {
		const approval = actionApprovalSchema.parse(rawApproval);
		const partition = principalPartition(principal);
		const key = `action:${approval.id}`;
		const stored = await this.store.read(partition, key);
		if (!stored) throw new Error("The reviewed action is unavailable for this user.");
		const record = recordSchema$1.parse(stored.value);
		const { preview } = record;
		this.checkRole(principal, preview.operation);
		if (approval.digest !== preview.digest) throw new Error("The review digest changed. Refresh the preview.");
		if (record.receipt) {
			await this.options.authorize(principal, preview.operation, preview.input);
			return record.receipt;
		}
		if (record.claimed) throw new Error("The action outcome is unconfirmed; do not repeat it.");
		if (Date.parse(preview.expiresAt) <= this.now()) throw new Error("The review expired. Refresh the preview.");
		if (canonicalJson(await this.options.authorize(principal, preview.operation, preview.input)) !== canonicalJson(record.before)) throw new ActionReviewStaleError();
		const claimed = {
			...record,
			claimed: true,
			claimedAt: new Date(this.now()).toISOString(),
			approval
		};
		if (!await this.store.replace(partition, key, stored.revision, claimed)) throw new Error("Another request claimed this action. Check Activity instead of repeating it.");
		let receipt;
		try {
			const result = await this.options.execute(principal, preview.operation, preview.input, record.before);
			const uncertainRollback = result !== null && typeof result === "object" && "state" in result && result.state === "rolled-back";
			receipt = actionReceiptSchema.parse({
				contractVersion: "1.0",
				id: preview.id,
				operation: preview.operation,
				state: uncertainRollback ? "effect-unknown" : "confirmed",
				occurredAt: new Date(this.now()).toISOString(),
				...uncertainRollback ? {} : { result }
			});
		} catch (error) {
			receipt = actionReceiptSchema.parse({
				contractVersion: "1.0",
				id: preview.id,
				operation: preview.operation,
				state: error instanceof ActionDispatchPreventedError ? "failed-before-send" : "effect-unknown",
				occurredAt: new Date(this.now()).toISOString()
			});
		}
		if (!await this.store.replace(partition, key, stored.revision + 1, {
			...claimed,
			receipt
		})) throw new Error("The action receipt is unconfirmed. Do not repeat the operation.");
		return receipt;
	}
	async list(principal) {
		return (await this.store.list(principalPartition(principal), "action:", 100)).map((row) => {
			const record = recordSchema$1.parse(row.value);
			if (record.receipt) return record.receipt;
			if (record.claimed) return actionReceiptSchema.parse({
				contractVersion: "1.0",
				id: record.preview.id,
				operation: record.preview.operation,
				state: "effect-unknown",
				occurredAt: record.claimedAt ?? record.preview.expiresAt
			});
			return record.preview;
		});
	}
};
//#endregion
//#region ../../packages/orchestrator/operations.ts
var WorkflowScopeAuthorizationError = class extends Error {
	constructor() {
		super("Workflow source scope is unavailable or changed. Start a fresh workflow after verifying current access.");
		this.name = "WorkflowScopeAuthorizationError";
	}
};
var id = z.string().min(1).max(200);
var opportunity = z.object({ opportunityId: id }).strict();
var milestone = opportunity.extend({ milestoneId: id }).strict();
function operation(input, output, invoke, effect = "read", startsWork = false) {
	return {
		effect,
		startsWork,
		parse: (raw) => input.parse(raw),
		run: async (raw) => output.parse(await invoke(input.parse(raw)))
	};
}
function createApplicationOperations(services) {
	const core = services.orchestrator;
	const workflows = services.workflows;
	const operations = {
		sellerDashboard: operation(sellerDashboardRequestSchema, sellerDashboardResponseSchema, (input) => services.sellerDashboard.invoke(input)),
		listAccounts: operation(accountListOptionsSchema.strict(), z.array(accountSchema$1), (input) => core.listAccounts(input)),
		searchAccounts: operation(accountSearchRequestSchema.strict(), z.array(accountCandidateSchema), (input) => core.searchAccounts(input)),
		addAccount: operation(z.object({ accountId: id }).strict(), accountSchema$1, (input) => core.addAccount(input.accountId), "preference"),
		setAccountVisibility: operation(z.object({
			accountId: id,
			visibility: z.enum(["visible", "hidden"])
		}).strict(), accountSchema$1, (input) => core.setAccountVisibility(input.accountId, input.visibility), "preference"),
		listOpportunities: operation(z.object({ accountId: id }).strict(), z.array(opportunitySchema), (input) => core.listOpportunities(input.accountId)),
		getOpportunityContext: operation(opportunity, z.object({
			account: accountSchema$1,
			opportunity: opportunitySchema,
			milestones: z.array(milestoneSchema),
			revisionTokens: z.record(z.string(), z.string()).optional()
		}).strict(), (input) => core.getOpportunitySnapshot(input.opportunityId)),
		discoverOpportunities: operation(z.object({ domain: seDomainSchema }).strict(), z.array(discoverableOpportunitySchema), (input) => core.discoverOpportunities(input.domain)),
		listMilestones: operation(opportunity, z.array(milestoneSchema), (input) => core.listMilestones(input.opportunityId)),
		listDiscoverableMilestones: operation(opportunity, z.array(milestoneSchema), (input) => core.listDiscoverableMilestones(input.opportunityId)),
		listMilestoneActivities: operation(milestone, z.array(milestoneActivitySchema), (input) => core.listMilestoneActivities(input.opportunityId, input.milestoneId)),
		joinDealTeam: operation(opportunity.extend({ domain: seDomainSchema.optional() }).strict(), dealTeamJoinResultSchema, (input) => core.joinDealTeam(input.opportunityId), "source"),
		leaveDealTeam: operation(opportunity, dealTeamLeaveResultSchema, (input) => core.leaveDealTeam(input.opportunityId), "source"),
		joinMilestoneTeam: operation(milestone.extend({ domain: seDomainSchema.optional() }).strict(), milestoneTeamJoinResultSchema, (input) => core.joinMilestoneTeam(input.opportunityId, input.milestoneId), "source"),
		leaveMilestoneTeam: operation(milestone, milestoneTeamLeaveResultSchema, (input) => core.leaveMilestoneTeam(input.opportunityId, input.milestoneId), "source"),
		updateOpportunity: operation(opportunity.extend({ update: opportunityUpdateSchema.strict() }).strict(), opportunitySchema, (input) => core.updateOpportunity(input.opportunityId, input.update), "source"),
		updateMilestone: operation(milestone.extend({ update: milestoneUpdateSchema }).strict(), milestoneSchema, (input) => core.updateMilestone(input.opportunityId, input.milestoneId, input.update), "source"),
		createMilestoneActivity: operation(milestone.extend({ request: createMilestoneActivityRequestSchema }).strict(), milestoneActivitySchema, (input) => core.createMilestoneActivity(input.opportunityId, input.milestoneId, input.request), "source"),
		transitionOpportunityStage: operation(mcemStageTransitionRequestSchema, mcemStageTransitionResultSchema, (input) => core.transitionOpportunityStage(input), "source"),
		runMcemCoach: operation(mcemRequestSchema.strict(), mcemResponseSchema, (input) => core.runMcemCoach(input), "read", true),
		runAgentTask: operation(agentTaskRequestSchema.strict(), agentTaskResponseSchema, (input) => core.runAgentTask(input), "read", true),
		getRecordCreationCatalog: operation(recordCreationCatalogRequestSchema, recordCreationCatalogSchema, (input) => core.getRecordCreationCatalog(input)),
		previewRecordCreation: operation(recordCreationPreviewRequestSchema, recordCreationPreviewSchema, (input) => core.previewRecordCreation(input)),
		commitRecordCreation: operation(recordCreationCommitRequestSchema, recordCreationResultSchema, (input) => core.commitRecordCreation(input), "source"),
		exportRecordCreationDraft: operation(recordCreationCommitRequestSchema, recordCreationDraftResultSchema, (input) => core.exportRecordCreationDraft(input)),
		applyMeetingChangeSet: operation(z.object({
			proposal: meetingChangeSetProposalSchema,
			approval: meetingChangeSetApprovalSchema
		}).strict(), meetingChangeSetResultSchema, (input) => services.meetings.applyMeetingChangeSet(input), "source"),
		"workflows.list": operation(listWorkflowDefinitionsRequestSchema, z.array(workflowDefinitionSchema), (input) => workflows.listDefinitions(input)),
		"workflows.start": operation(startWorkflowHostRequestSchema, workflowRunSchema, (input) => workflows.start(input), "read", true),
		"workflows.get": operation(workflowRunRequestSchema, workflowRunViewSchema, (input) => workflows.get(input)),
		"workflows.cancel": operation(workflowRunRequestSchema, workflowRunSchema, (input) => workflows.cancel(input)),
		"workflows.history": operation(listWorkflowRunsRequestSchema, z.array(workflowRunSchema), (input) => workflows.listRuns(input)),
		"workflows.guidance": operation(workflowGuidanceRequestSchema, workflowGuidanceHandoffSchema, (input) => workflows.prepareGuidance(input), "read", true)
	};
	function describe(name) {
		if (!Object.hasOwn(operations, name)) throw new Error("Unknown application operation.");
		return operations[name];
	}
	async function workingSet() {
		const accounts = await core.listAccounts();
		const opportunities = (await Promise.all(accounts.map((account) => core.listOpportunities(account.id)))).flat();
		return {
			accountIds: accounts.map((account) => account.id).sort(),
			opportunityIds: opportunities.map((opportunity) => opportunity.id).sort()
		};
	}
	async function verifyWorkflow(runId) {
		const captured = services.workflowScopes.get(runId);
		if (!captured || canonicalJson(captured) !== canonicalJson(await workingSet())) throw new WorkflowScopeAuthorizationError();
		if (workflows.get({
			contractVersion: "1.0",
			runId
		}).output?.queueItems.some((item) => item.accountId && !captured.accountIds.includes(item.accountId) || item.opportunityId && !captured.opportunityIds.includes(item.opportunityId))) throw new WorkflowScopeAuthorizationError();
	}
	return {
		describe,
		names: () => Object.keys(operations),
		async invoke(name, input) {
			services.refreshSource();
			const entry = describe(name);
			if (name === "workflows.start") {
				const captured = await workingSet();
				const run = workflowRunSchema.parse(await entry.run(input));
				if (services.workflowScopes.size >= 100) services.workflowScopes.delete(services.workflowScopes.keys().next().value);
				services.workflowScopes.set(run.runId, captured);
				return run;
			}
			if (name === "workflows.get" || name === "workflows.guidance") {
				const request = entry.parse(input);
				await verifyWorkflow(String(request["runId"]));
			}
			return entry.run(input);
		},
		async snapshot(name, input) {
			services.refreshSource();
			const parsed = describe(name).parse(input);
			if (["joinDealTeam", "joinMilestoneTeam"].includes(name) && parsed["domain"]) {
				const domain = seDomainSchema.parse(parsed["domain"]);
				const candidate = (await core.discoverOpportunities(domain)).find((entry) => entry.id === parsed["opportunityId"]);
				if (!candidate) throw new Error("The opportunity is outside the current Discovery scope.");
				const milestones = await core.listDiscoverableMilestones(candidate.id);
				if (parsed["milestoneId"] && !milestones.some((entry) => entry.id === parsed["milestoneId"])) throw new Error("The milestone is outside the selected opportunity.");
				return {
					opportunity: candidate,
					milestones
				};
			}
			if (typeof parsed["opportunityId"] === "string") return core.getOpportunitySnapshot(parsed["opportunityId"]);
			if (name === "applyMeetingChangeSet") {
				const proposal = meetingChangeSetProposalSchema.parse(parsed["proposal"]);
				return core.getOpportunitySnapshot(proposal.opportunityId);
			}
			return core.listAccounts({ includeHidden: true });
		}
	};
}
//#endregion
//#region ../../packages/orchestrator/collaboration/contexts.ts
var bindInput = z.object({
	kind: z.enum([
		"channel",
		"chat",
		"meeting"
	]),
	contextId: z.string().min(1).max(500),
	accountId: z.string().min(1).max(200),
	opportunityId: z.string().min(1).max(200).optional()
}).strict();
var CollaborationService = class {
	store;
	authority;
	readAccount;
	constructor(store, authority, readAccount) {
		this.store = store;
		this.authority = authority;
		this.readAccount = readAccount;
	}
	partition(principal) {
		return `${principal.tenantId}:${principal.environmentId}:bindings`;
	}
	async bind(principal, raw) {
		requireRole(principal, "TLC.Teams.ContextAdmin");
		const input = bindInput.parse(raw);
		if (!(await this.authority.verify(principal, input)).canConfigure) throw new Error("Configuring this context is not authorized.");
		await this.readAccount(principal, input.accountId, input.opportunityId);
		const binding = contextBindingSchema.parse({
			contractVersion: "1.0",
			id: randomUUID(),
			...input,
			revision: 1
		});
		if (!await this.store.insert(this.partition(principal), `binding:${binding.id}`, binding)) throw new Error("The context binding could not be saved.");
		return binding;
	}
	async load(principal, id) {
		const row = await this.store.read(this.partition(principal), `binding:${id}`);
		if (!row) throw new Error("The context binding is unavailable.");
		return contextBindingSchema.parse(row.value);
	}
	async get(principal, id) {
		requireRole(principal, "TLC.Teams.User");
		const binding = await this.load(principal, id);
		await this.authority.verify(principal, binding);
		await this.readAccount(principal, binding.accountId, binding.opportunityId);
		return binding;
	}
	async admitPublication(principal, id) {
		requireRole(principal, "TLC.Teams.Publisher");
		const binding = await this.load(principal, id);
		const access = await this.authority.verify(principal, binding);
		if (!access.canPublish) throw new Error("Publishing to this context is not authorized.");
		if (!access.audienceEligible) throw new Error("The shared audience is not approved for internal business information.");
		await this.readAccount(principal, binding.accountId, binding.opportunityId);
		return {
			binding,
			policyRevision: access.revision
		};
	}
	async admitSharedView(principal, id) {
		requireRole(principal, "TLC.Teams.User");
		const binding = await this.load(principal, id);
		const access = await this.authority.verify(principal, binding);
		if (!access.audienceEligible) throw new Error("The shared audience is no longer approved.");
		return {
			binding,
			policyRevision: access.revision
		};
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/lifecycle.ts
var storedSchema = z.object({
	state: z.enum([
		"active",
		"paused",
		"retired"
	]),
	changedAt: z.iso.datetime()
}).strict();
var key = "collaboration-admission";
var CollaborationAdmissionError = class extends Error {
	code;
	constructor(code) {
		super(code.replaceAll("_", " "));
		this.code = code;
		this.name = "CollaborationAdmissionError";
	}
};
var CollaborationLifecycle = class {
	store;
	acceptNewWork;
	constructor(store, acceptNewWork = true) {
		this.store = store;
		this.acceptNewWork = acceptNewWork;
	}
	async readIdentity(identity) {
		const row = await this.store.read(principalPartition(identity), key);
		const state = row ? storedSchema.parse(row.value).state : "active";
		return collaborationLifecycleSchema.parse({
			contractVersion: "1.0",
			state,
			generation: row?.revision ?? 0,
			acceptingNewWork: this.acceptNewWork && state === "active"
		});
	}
	async status(principal) {
		requireRole(principal, "TLC.Teams.User");
		return this.readIdentity(principal);
	}
	async assertReadable(principal) {
		if ((await this.status(principal)).state === "retired") throw new CollaborationAdmissionError("collaboration_retired");
	}
	async assertGeneration(principal, generation) {
		const status = await this.status(principal);
		if (status.state === "retired") throw new CollaborationAdmissionError("collaboration_retired");
		if (status.generation !== generation) throw new CollaborationAdmissionError("collaboration_context_changed");
	}
	async assertActive(principal) {
		const status = await this.status(principal);
		if (status.state !== "active") throw new CollaborationAdmissionError(status.state === "paused" ? "collaboration_paused" : "collaboration_retired");
		if (!status.acceptingNewWork) throw new CollaborationAdmissionError("new_work_disabled");
		return status;
	}
	async set(principal, rawCommand) {
		requireRole(principal, "TLC.Teams.User");
		const command = collaborationLifecycleCommandSchema.shape.command.parse(rawCommand);
		await this.change(principal, command === "resume" ? "active" : command === "retire" ? "retired" : "paused");
		return this.status(principal);
	}
	async deactivate(identity) {
		await this.change(identity, "retired");
	}
	async change(identity, state) {
		const partition = principalPartition(identity);
		for (let attempt = 0; attempt < 5; attempt++) {
			const row = await this.store.read(partition, key);
			const previous = row ? storedSchema.parse(row.value).state : "active";
			if (previous === state || previous === "retired" && state === "paused") return;
			const changedAt = (/* @__PURE__ */ new Date()).toISOString();
			const value = {
				state,
				changedAt
			};
			if (!(row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value))) continue;
			if (!await this.store.insert(partition, `lifecycle-event:${changedAt}:${randomUUID()}`, {
				state,
				generation: (row?.revision ?? 0) + 1,
				occurredAt: changedAt
			})) throw new Error("The admission change was applied but its audit confirmation is unavailable.");
			return;
		}
		throw new Error("Collaboration admission changed concurrently. Refresh its current status.");
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/notifications.ts
var notificationSchema = z.object({
	id: z.string().min(1).max(200),
	title: z.string().min(1).max(100),
	reference: z.string().min(1).max(500),
	state: z.enum([
		"pending",
		"sending",
		"delivered",
		"delivery-unknown",
		"cancelled"
	]),
	generation: z.number().int().nonnegative().default(0),
	occurredAt: z.iso.datetime()
}).strict();
var NotificationOutbox = class {
	store;
	constructor(store) {
		this.store = store;
	}
	async enqueueAcquisition(principal, result) {
		requireRole(principal, "TLC.Teams.User");
		const status = acquisitionSchema.parse(result.status);
		if (status.state === "waiting") return;
		const version = status.state === "ready" ? z.string().regex(/^[a-f0-9]{64}$/).parse(result.evidenceVersion) : "status";
		await this.enqueue(principal, `meeting:${status.id}:${status.state}:${version}`, status.state === "ready" ? "Meeting review ready" : "Meeting acquisition needs attention", status.id);
	}
	async enqueue(principal, eventId, title, reference) {
		requireRole(principal, "TLC.Teams.User");
		const admission = await new CollaborationLifecycle(this.store).status(principal);
		const notification = notificationSchema.parse({
			id: eventId,
			title,
			reference,
			state: admission.acceptingNewWork ? "pending" : "cancelled",
			generation: admission.generation,
			occurredAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		await this.store.insert(principalPartition(principal), `notification:${eventId}`, notification);
	}
	async list(principal) {
		requireRole(principal, "TLC.Teams.User");
		const admission = await new CollaborationLifecycle(this.store).status(principal);
		return (await this.store.list(principalPartition(principal), "notification:", 100)).map((row) => {
			const notification = notificationSchema.parse(row.value);
			return notification.state === "pending" && notification.generation !== admission.generation ? {
				...notification,
				state: "cancelled"
			} : notification;
		});
	}
	async deliver(principal, send) {
		requireRole(principal, "TLC.Teams.User");
		const partition = principalPartition(principal);
		const lifecycle = new CollaborationLifecycle(this.store);
		if (!(await lifecycle.status(principal)).acceptingNewWork) return;
		for (const row of await this.store.list(partition, "notification:", 100)) {
			const notification = notificationSchema.parse(row.value);
			if (notification.state !== "pending") continue;
			const admission = await lifecycle.status(principal);
			if (!admission.acceptingNewWork || admission.generation !== notification.generation) {
				if (!await this.store.replace(partition, row.key, row.revision, {
					...notification,
					state: "cancelled"
				})) throw new Error("Pending notification cancellation changed concurrently.");
				continue;
			}
			if (!await this.store.replace(partition, row.key, row.revision, {
				...notification,
				state: "sending"
			})) continue;
			let state;
			try {
				if ((await lifecycle.assertActive(principal)).generation !== notification.generation) throw new CollaborationAdmissionError("collaboration_paused");
				await send(notification);
				state = "delivered";
			} catch (error) {
				state = error instanceof CollaborationAdmissionError ? "cancelled" : "delivery-unknown";
			}
			if (!await this.store.replace(partition, row.key, row.revision + 1, {
				...notification,
				state
			})) throw new Error("Notification delivery is unconfirmed. Do not repeat it automatically.");
		}
	}
};
//#endregion
//#region ../../packages/agents/meeting-signal-extractor/src/transcript-parse.ts
/**
* Transcript parsing for *actual* meeting recordings.
*
* Phase 1 testing uses a real recording's transcript (uploaded or pasted) against the
* SQLite opportunity/milestone store. This converts WebVTT (what Microsoft Graph returns
* for Teams meeting transcripts) or a simple `Speaker: text` paste into the canonical
* `MeetingTranscript` the extractor consumes. Phase 2 (live Graph) reuses the same shape.
*/
function parseTimestampMs(stamp) {
	const m = stamp.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
	if (!m || m[2] === void 0 || m[3] === void 0) return void 0;
	const hours = m[1] ? Number(m[1]) : 0;
	const minutes = Number(m[2]);
	const seconds = Number(m[3]);
	const millis = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
	return ((hours * 60 + minutes) * 60 + seconds) * 1e3 + millis;
}
/** Strips WebVTT speaker voice tags: `<v Priya Nair>text</v>` -> `{ speaker, text }`. */
function extractVoiceTag(line, attributionAllowed = true) {
	if (!attributionAllowed) return { text: line.replace(/<\/?v(?:\s+[^>]*)?>/gi, "").trim() };
	const voice = line.match(/^<v\s+([^>]+)>(.*)$/i);
	if (voice && voice[1] !== void 0) return {
		speaker: voice[1].trim(),
		text: (voice[2] ?? "").replace(/<\/v>\s*$/i, "").trim()
	};
	const colon = line.match(/^([A-Z][\w .'-]{1,60}?):\s+(.*)$/);
	if (colon && colon[1] !== void 0) return {
		speaker: colon[1].trim(),
		text: (colon[2] ?? "").trim()
	};
	return { text: line.trim() };
}
function parseVtt(raw, attributionAllowed) {
	const lines = raw.replace(/\r/g, "").split("\n");
	const segments = [];
	let startMs;
	let endMs;
	let buffer = [];
	const flush = () => {
		if (buffer.length === 0) return;
		const joined = buffer.join(" ").trim();
		if (joined) {
			const { speaker, text } = extractVoiceTag(joined, attributionAllowed);
			if (text) segments.push({
				text,
				...startMs !== void 0 ? { startMs } : {},
				...endMs !== void 0 ? { endMs } : {},
				...speaker ? { speaker } : {}
			});
		}
		buffer = [];
		startMs = void 0;
		endMs = void 0;
	};
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "") {
			flush();
			continue;
		}
		if (/^WEBVTT/i.test(trimmed) || /^NOTE\b/i.test(trimmed)) continue;
		const cue = trimmed.match(/^([\d:.]+)\s*-->\s*([\d:.]+)/);
		if (cue && cue[1] !== void 0 && cue[2] !== void 0) {
			flush();
			startMs = parseTimestampMs(cue[1]);
			endMs = parseTimestampMs(cue[2]);
			continue;
		}
		if (buffer.length === 0 && startMs === void 0 && /^[\w-]+$/.test(trimmed) && !/\s/.test(trimmed)) continue;
		buffer.push(trimmed);
	}
	flush();
	return segments;
}
function parsePlainText(raw, attributionAllowed) {
	return raw.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => {
		const { speaker, text } = extractVoiceTag(line, attributionAllowed);
		return {
			text,
			...speaker ? { speaker } : {}
		};
	}).filter((seg) => seg.text.length > 0);
}
/** Parses a raw transcript (WebVTT or `Speaker: text`) into a validated `MeetingTranscript`. */
function parseTranscriptContent(raw, options = {}) {
	const looksLikeVtt = options.format === "vtt" || options.format !== "text" && (/^\uFEFF?WEBVTT/i.test(raw.trimStart()) || /-->/.test(raw));
	const attributionAllowed = options.attribution !== "prohibited";
	const segments = (looksLikeVtt ? parseVtt(raw, attributionAllowed) : parsePlainText(raw, attributionAllowed)).map((seg, index) => ({
		segmentId: `seg-${index + 1}`,
		...seg
	}));
	const transcript = {
		id: options.id ?? `upload-${Date.now()}`,
		meetingType: options.meetingType ?? "customer",
		source: options.source ?? "upload",
		segments,
		...options.opportunityId ? { opportunityId: options.opportunityId } : {},
		...options.title ? { title: options.title } : {}
	};
	return meetingTranscriptSchema.parse(transcript);
}
//#endregion
//#region ../../packages/connectors/common/http-response.ts
var ResponseSizeError = class extends Error {
	constructor() {
		super("The response exceeded its byte budget.");
		this.name = "ResponseSizeError";
	}
};
async function readBoundedText(response, maximumBytes) {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		bytes += chunk.value.byteLength;
		if (bytes > maximumBytes) {
			await reader.cancel();
			throw new ResponseSizeError();
		}
		chunks.push(chunk.value);
	}
	return Buffer.concat(chunks).toString("utf8");
}
//#endregion
//#region ../../packages/connectors/graph/meetings.ts
var GraphMeetingError = class extends Error {
	state;
	code;
	constructor(state, code) {
		super(`Meeting transcript acquisition is ${state} (${code}).`);
		this.state = state;
		this.code = code;
		this.name = "GraphMeetingError";
	}
};
var graphRoot = "https://graph.microsoft.com/v1.0";
var transcriptPage = z.object({
	value: z.array(z.object({ id: z.string().min(1).max(500) })),
	"@odata.nextLink": z.url().optional()
});
var GraphMeetingConnector = class {
	getAccessToken;
	fetcher;
	maximumBytes;
	constructor(getAccessToken, fetcher = fetch, options = {}) {
		this.getAccessToken = getAccessToken;
		this.fetcher = fetcher;
		this.maximumBytes = options.maximumBytes ?? 512e3;
		if (!Number.isSafeInteger(this.maximumBytes) || this.maximumBytes < 1) throw new Error("A positive transcript byte budget is required.");
	}
	async resolveMeeting(joinUrl) {
		const url = new URL(joinUrl);
		if (url.protocol !== "https:" || !["teams.microsoft.com", "teams.cloud.microsoft"].includes(url.hostname) || url.username || url.password) throw new GraphMeetingError("unsupported", "invalid_meeting_link");
		const endpoint = new URL(`${graphRoot}/me/onlineMeetings`);
		endpoint.searchParams.set("$filter", `JoinWebUrl eq '${joinUrl.replaceAll("'", "''")}'`);
		const response = await this.request(endpoint);
		const value = z.object({ value: z.array(z.object({ id: z.string().min(1) })).max(1) }).parse(JSON.parse(await this.read(response)));
		if (!value.value[0]) throw new GraphMeetingError("denied", "meeting_unavailable");
		return value.value[0].id;
	}
	async acquire(input) {
		if (!input.meetingId || input.meetingId.length > 500 || /[/:\\?#\r\n]/.test(input.meetingId)) throw new GraphMeetingError("unsupported", "invalid_meeting_id");
		const meetingPath = `${graphRoot}/me/onlineMeetings/${encodeURIComponent(input.meetingId)}`;
		let requests = 0;
		const get = async (url, accept = "application/json") => {
			if (++requests > 30) throw new GraphMeetingError("paused", "request_budget_exhausted");
			const target = new URL(url);
			if (target.origin !== "https://graph.microsoft.com" || !target.pathname.startsWith(new URL(meetingPath).pathname) || target.username || target.password || target.hash) throw new GraphMeetingError("unsupported", "invalid_graph_continuation");
			return this.request(target, accept);
		};
		const meeting = z.object({
			id: z.string().min(1),
			subject: z.string().optional()
		}).parse(JSON.parse(await this.read(await get(meetingPath))));
		if (meeting.id !== input.meetingId) throw new GraphMeetingError("denied", "meeting_identity_mismatch");
		const ids = [];
		let next = `${meetingPath}/transcripts`;
		const visited = /* @__PURE__ */ new Set();
		while (next) {
			if (visited.has(next)) throw new GraphMeetingError("paused", "repeated_page");
			visited.add(next);
			const page = transcriptPage.parse(JSON.parse(await this.read(await get(next))));
			for (const row of page.value) if (!ids.includes(row.id)) ids.push(row.id);
			if (ids.length > 20) throw new GraphMeetingError("paused", "transcript_count_exceeded");
			next = page["@odata.nextLink"];
		}
		const transcripts = [];
		const contentVersions = {};
		let unattributed = false;
		let totalBytes = 0;
		for (const id of ids) {
			const endpoint = `${meetingPath}/transcripts/${encodeURIComponent(id)}/content`;
			let response;
			let prohibited = false;
			try {
				response = await get(endpoint, "text/vtt");
			} catch (error) {
				if (!(error instanceof GraphMeetingError) || error.code !== "SpeakerAttributionNotAllowed") throw error;
				response = await get(endpoint, "application/vnd.microsoft.graph.transcript+text");
				prohibited = true;
				unattributed = true;
			}
			const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
			if (contentType && ![
				"text/vtt",
				"text/plain",
				"application/vnd.microsoft.graph.transcript+text"
			].includes(contentType)) throw new GraphMeetingError("unsupported", "unexpected_content_type");
			if (contentType === "application/vnd.microsoft.graph.transcript+text") {
				prohibited = true;
				unattributed = true;
			}
			const content = await this.read(response);
			totalBytes += Buffer.byteLength(content);
			if (totalBytes > this.maximumBytes || content.length > 15e4) throw new GraphMeetingError("paused", "content_budget_exceeded");
			const transcript = parseTranscriptContent(content, {
				id,
				source: "teams",
				meetingType: input.meetingType,
				opportunityId: input.opportunityId,
				attribution: prohibited ? "prohibited" : "allowed",
				...meeting.subject ? { title: meeting.subject } : {}
			});
			if (!transcript.segments.length || transcript.segments.length > 2e3) throw new GraphMeetingError("unsupported", "invalid_transcript_segments");
			transcripts.push(transcript);
			contentVersions[id] = createHash("sha256").update(content).digest("hex");
		}
		return {
			state: transcripts.length ? "ready" : "waiting",
			meetingId: input.meetingId,
			transcripts,
			attribution: transcripts.length ? unattributed ? "unattributed" : "attributed" : "unknown",
			contentVersions
		};
	}
	async request(url, accept = "application/json") {
		let token;
		try {
			token = await this.getAccessToken();
		} catch (error) {
			if (error instanceof Error && error.name === "TeamsAuthorizationError") throw error;
			throw new GraphMeetingError("auth-required", "delegated_session_unavailable");
		}
		if (!token) throw new GraphMeetingError("auth-required", "missing_delegated_token");
		let response;
		try {
			response = await this.fetcher(url, {
				method: "GET",
				redirect: "error",
				signal: AbortSignal.timeout(3e4),
				headers: {
					authorization: `Bearer ${token}`,
					accept
				}
			});
		} catch {
			throw new GraphMeetingError("paused", "graph_transport");
		}
		if (response.ok) return response;
		let code = `http_${response.status}`;
		const text = await this.read(response);
		try {
			const error = z.object({ error: z.object({
				code: z.string().optional(),
				innerError: z.object({ code: z.string().optional() }).optional()
			}) }).parse(JSON.parse(text));
			const candidate = error.error.innerError?.code ?? error.error.code;
			if (candidate && /^[A-Za-z0-9_]{1,100}$/.test(candidate)) code = candidate;
		} catch {
			throw new GraphMeetingError(response.status === 401 ? "auth-required" : response.status === 403 ? "denied" : "paused", code);
		}
		throw new GraphMeetingError(code === "GraphAccessToTranscriptsDisabled" ? "admin-blocked" : response.status === 401 ? "auth-required" : response.status === 403 ? "denied" : response.status === 404 ? "unsupported" : "paused", code);
	}
	async read(response) {
		try {
			return await readBoundedText(response, this.maximumBytes);
		} catch (error) {
			if (error instanceof ResponseSizeError) throw new GraphMeetingError("paused", "content_budget_exceeded");
			throw error;
		}
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/request-budget.ts
var RequestQuotaError = class extends Error {
	constructor() {
		super("The per-user request quota is exhausted. Retry after the current window.");
		this.name = "RequestQuotaError";
	}
};
var counterSchema = z.object({
	window: z.number().int(),
	count: z.number().int().nonnegative()
}).strict();
var UserRequestBudget = class {
	store;
	now;
	constructor(store, now = Date.now) {
		this.store = store;
		this.now = now;
	}
	async consume(principal, category, limit) {
		requireRole(principal, "TLC.Teams.User");
		if (!Number.isInteger(limit) || limit < 1 || limit > 1e3 || !/^[a-z-]{1,30}$/.test(category)) throw new Error("The request quota configuration is invalid.");
		const partition = principalPartition(principal);
		const key = `quota:${category}`;
		const window = Math.floor(this.now() / 6e4);
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.store.read(partition, key);
			const old = row ? counterSchema.parse(row.value) : {
				window,
				count: 0
			};
			const count = old.window === window ? old.count : 0;
			if (count >= limit) throw new RequestQuotaError();
			const value = {
				window,
				count: count + 1
			};
			if (row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value)) return;
		}
		throw new RequestQuotaError();
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/meeting-acquisition.ts
var meetingAcquisitionRequestSchema = z.object({
	meetingId: z.string().min(1).max(500),
	opportunityId: z.string().min(1).max(200),
	meetingType: z.enum(["customer", "internal"])
}).strict();
var recordSchema = z.object({
	request: meetingAcquisitionRequestSchema,
	attempts: z.number().int().nonnegative(),
	notificationPasses: z.array(z.string().min(1).max(200)).max(20).default([]),
	claimUntil: z.number(),
	status: acquisitionSchema,
	versions: z.record(z.string(), z.string()),
	proposals: z.array(meetingChangeSetProposalSchema)
}).strict();
var MeetingAcquisitionService = class {
	store;
	options;
	constructor(store, options) {
		this.store = store;
		this.options = options;
	}
	async acquire(principal, raw, notification) {
		requireRole(principal, "TLC.Teams.User");
		const request = meetingAcquisitionRequestSchema.parse(raw);
		const lifecycle = new CollaborationLifecycle(this.store);
		const admission = await lifecycle.assertActive(principal);
		await this.options.readOpportunity(principal, request.opportunityId);
		const id = createHash("sha256").update(canonicalJson(request)).digest("hex");
		const key = `acquisition:${id}`;
		const partition = principalPartition(principal);
		const status = {
			contractVersion: "1.0",
			id,
			meetingId: request.meetingId,
			state: "waiting",
			transcriptIds: [],
			attribution: "unknown",
			detail: "Checking authorized meeting transcripts.",
			checkedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		await this.store.insert(partition, key, {
			request,
			attempts: 0,
			claimUntil: 0,
			status,
			versions: {},
			proposals: []
		});
		const row = await this.store.read(partition, key);
		if (!row) throw new Error("The meeting acquisition could not be persisted.");
		const record = recordSchema.parse(row.value);
		if (record.claimUntil > Date.now()) return {
			status: {
				...record.status,
				state: "waiting",
				detail: "Another request is acquiring this transcript."
			},
			proposals: []
		};
		const notificationId = notification ? z.string().min(1).max(200).parse(notification.notificationId) : void 0;
		const freshNotification = notificationId !== void 0 && !record.notificationPasses.includes(notificationId);
		if (freshNotification && record.notificationPasses.length >= 20) return {
			status: {
				...record.status,
				state: "paused",
				detail: "The bounded notification recovery budget is exhausted. Contact the application owner."
			},
			proposals: []
		};
		const attempts = freshNotification ? 0 : record.attempts;
		if (attempts >= 10) return {
			status: {
				...record.status,
				state: "paused",
				detail: "Foreground discovery is paused. A verified new transcript notification can start another bounded discovery pass."
			},
			proposals: []
		};
		const notificationPasses = freshNotification ? [...record.notificationPasses, notificationId] : record.notificationPasses;
		if (!await this.store.replace(partition, key, row.revision, {
			...record,
			notificationPasses,
			attempts: attempts + 1,
			claimUntil: Date.now() + 18e4
		})) throw new Error("Another request owns this meeting acquisition.");
		let updated = {
			...record,
			notificationPasses,
			attempts: attempts + 1,
			claimUntil: 0
		};
		try {
			await lifecycle.assertGeneration(principal, admission.generation);
			const result = await this.options.getTranscripts(principal, request);
			await lifecycle.assertGeneration(principal, admission.generation);
			const proposals = [];
			if (result.transcripts.length) await new UserRequestBudget(this.store).consume(principal, "agent", principal.mode === "sample" ? 60 : 4);
			for (const transcript of result.transcripts) {
				await lifecycle.assertActive(principal);
				proposals.push(meetingChangeSetProposalSchema.parse(await this.options.propose(principal, request.opportunityId, transcript)));
			}
			await lifecycle.assertGeneration(principal, admission.generation);
			updated = {
				...updated,
				versions: result.contentVersions,
				proposals,
				status: acquisitionSchema.parse({
					...status,
					state: result.state,
					transcriptIds: result.transcripts.map((transcript) => transcript.id),
					attribution: result.attribution,
					checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
					detail: result.state === "ready" ? "Authorized transcripts acquired automatically. Review proposed changes before applying." : "The meeting transcript is not ready."
				})
			};
		} catch (error) {
			if (!(error instanceof GraphMeetingError)) {
				if (!await this.store.replace(partition, key, row.revision + 1, {
					...updated,
					proposals: [],
					status: {
						...status,
						state: "paused",
						detail: "Acquisition stopped. Reconnect or review the operation error before continuing."
					}
				})) throw new Error("The stopped acquisition could not be persisted.", { cause: error });
				throw error;
			}
			updated = {
				...updated,
				proposals: [],
				status: {
					...status,
					state: error.state,
					detail: error.message,
					checkedAt: (/* @__PURE__ */ new Date()).toISOString()
				}
			};
		}
		if (!await this.store.replace(partition, key, row.revision + 1, updated)) throw new Error("The acquisition result could not be persisted. No business changes were applied.");
		return {
			status: updated.status,
			proposals: updated.proposals,
			...updated.status.state === "ready" ? { evidenceVersion: createHash("sha256").update(canonicalJson(updated.versions)).digest("hex") } : {}
		};
	}
	async review(principal, id) {
		requireRole(principal, "TLC.Teams.User");
		await new CollaborationLifecycle(this.store).assertReadable(principal);
		const row = await this.store.read(principalPartition(principal), `acquisition:${id}`);
		if (!row) throw new Error("The acquired meeting draft is unavailable for this user.");
		const record = recordSchema.parse(row.value);
		if (record.status.state !== "ready") throw new Error("The meeting draft is not ready.");
		await this.options.readOpportunity(principal, record.request.opportunityId);
		if (canonicalJson((await this.options.getTranscripts(principal, record.request)).contentVersions) !== canonicalJson(record.versions)) throw new Error("Transcript evidence changed. Acquire and review a new draft.");
		return record.proposals;
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/publications.ts
var sharedProjectionSchema = z.object({
	title: z.string().min(1).max(200),
	text: z.string().min(1).max(4e3),
	sourceRecordIds: z.array(z.string().min(1)).min(1).max(100)
}).strict();
var inputSchema = z.object({
	bindingId: z.string().min(1),
	sharedId: z.uuid(),
	policyRevision: z.string().min(1),
	bindingRevision: z.number().int().positive(),
	checkedAt: z.iso.datetime(),
	projection: sharedProjectionSchema
}).strict();
var PublicationService = class {
	store;
	contexts;
	readProjection;
	deliver;
	constructor(store, contexts, readProjection, deliver) {
		this.store = store;
		this.contexts = contexts;
		this.readProjection = readProjection;
		this.deliver = deliver;
	}
	partition(principal) {
		return `${principal.tenantId}:${principal.environmentId}:shared`;
	}
	async prepareInput(principal, bindingId) {
		const admission = await this.contexts.admitPublication(principal, bindingId);
		const projection = sharedProjectionSchema.parse(await this.readProjection(principal, admission.binding));
		return inputSchema.parse({
			bindingId,
			sharedId: randomUUID(),
			policyRevision: admission.policyRevision,
			bindingRevision: admission.binding.revision,
			checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
			projection
		});
	}
	async authorize(principal, raw) {
		const input = inputSchema.parse(raw);
		const admission = await this.contexts.admitPublication(principal, input.bindingId);
		if (admission.policyRevision !== input.policyRevision || admission.binding.revision !== input.bindingRevision) throw new Error("The disclosure policy or binding changed. Refresh the shared preview.");
		const current = sharedProjectionSchema.parse(await this.readProjection(principal, admission.binding));
		if (canonicalJson(current) !== canonicalJson(input.projection)) throw new Error("The source summary changed. Refresh the shared preview.");
		return {
			policyRevision: admission.policyRevision,
			binding: admission.binding,
			projection: current
		};
	}
	async execute(principal, raw) {
		const input = inputSchema.parse(raw);
		const admission = await this.authorize(principal, input);
		const artifact = {
			bindingId: input.bindingId,
			projection: input.projection,
			checkedAt: input.checkedAt,
			policyRevision: input.policyRevision
		};
		if (!await this.store.insert(this.partition(principal), `shared:${input.sharedId}`, artifact)) throw new Error("The shared artifact already exists. Do not repeat publication.");
		const delivery = await this.deliver(principal, admission.binding, input.projection);
		return {
			sharedId: input.sharedId,
			delivery
		};
	}
	async readShared(principal, sharedId, options = {}) {
		const row = await this.store.read(this.partition(principal), `shared:${sharedId}`);
		if (!row) throw new Error("The approved shared artifact is unavailable.");
		const artifact = z.object({
			bindingId: z.string(),
			projection: sharedProjectionSchema,
			checkedAt: z.iso.datetime(),
			policyRevision: z.string()
		}).strict().parse(row.value);
		const admission = await this.contexts.admitSharedView(principal, artifact.bindingId);
		if (options.stage && admission.binding.kind !== "meeting") throw new Error("A channel audience does not authorize the current meeting audience.");
		if (admission.policyRevision !== artifact.policyRevision) throw new Error("The shared disclosure policy changed.");
		return {
			...artifact.projection,
			checkedAt: artifact.checkedAt
		};
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/activity.ts
var summarySchema = z.object({
	runId: z.uuid(),
	workflowId: z.string(),
	status: z.enum([
		"queued",
		"running",
		"completed",
		"failed",
		"cancelled"
	]),
	state: z.enum([
		"complete",
		"partial",
		"unauthorized"
	]).optional(),
	updatedAt: z.iso.datetime()
}).strict();
var WorkflowActivityStore = class {
	store;
	constructor(store) {
		this.store = store;
	}
	async record(principal, input) {
		const run = workflowRunSchema.parse(input);
		const key = `workflow:${run.runId}`;
		const partition = principalPartition(principal);
		const value = summarySchema.parse({
			runId: run.runId,
			workflowId: run.workflowId,
			status: run.status,
			...run.state ? { state: run.state } : {},
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.store.read(partition, key);
			if (row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value)) return;
		}
		throw new Error("The workflow activity record changed concurrently.");
	}
	async list(principal, available) {
		requireRole(principal, "TLC.Teams.User");
		return (await this.store.list(principalPartition(principal), "workflow:", 100)).map((row) => {
			const value = summarySchema.parse(row.value);
			return ["queued", "running"].includes(value.status) && !available(value.runId) ? {
				...value,
				status: "interrupted",
				detail: "The run is unavailable on this host. No transparent resume is claimed; check the execution owner before starting another run."
			} : value;
		});
	}
};
//#endregion
//#region src/authentication.ts
var TeamsAuthorizationError = class extends Error {
	code;
	claims;
	constructor(code = "authorization_required", claims) {
		super(code === "fte_ineligible" ? "This account is not eligible for TLC Teams." : "Delegated authorization is required.");
		this.code = code;
		this.claims = claims;
		this.name = "TeamsAuthorizationError";
	}
};
function createTeamsAuthenticator(configuration, resolveKey) {
	if (configuration.mode !== "live" || isLocalConfiguration(configuration)) throw new Error("Hosted live token validation requires hosted configuration.");
	const issuer = `https://login.microsoftonline.com/${configuration.tenantId}/v2.0`;
	const key = resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`));
	return async (token) => {
		let payload;
		try {
			({payload} = await jwtVerify(token, key, {
				algorithms: ["RS256"],
				issuer,
				audience: configuration.apiClientId,
				requiredClaims: [
					"exp",
					"tid",
					"oid",
					"azp",
					"scp",
					"ver"
				]
			}));
		} catch {
			throw new TeamsAuthorizationError();
		}
		if (payload["tid"] !== configuration.tenantId || payload["ver"] !== "2.0" || payload["idtyp"] === "app" || typeof payload["oid"] !== "string" || !/^[0-9a-f-]{36}$/i.test(payload["oid"]) || ![configuration.spaClientId, configuration.botClientId].includes(String(payload["azp"])) || typeof payload["scp"] !== "string" || !payload["scp"].split(" ").includes("access_as_user")) throw new TeamsAuthorizationError();
		const roles = payload["roles"];
		if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string") || !roles.includes("TLC.Teams.User")) throw new TeamsAuthorizationError("fte_ineligible");
		return {
			key: `${configuration.tenantId}:${payload["oid"]}`,
			tenantId: configuration.tenantId,
			userId: payload["oid"],
			environmentId: configuration.environmentId,
			roles,
			mode: "live",
			expiresAt: Number(payload.exp) * 1e3
		};
	};
}
function createDelegatedTokenProvider(configuration, assertion, acquire, expiresAt = Number.POSITIVE_INFINITY) {
	if (configuration.mode !== "live" || isLocalConfiguration(configuration)) throw new Error("OBO source tokens require hosted live configuration.");
	const resources = {
		msx: `${configuration.msxResource}/.default`,
		mcp: configuration.mcpScope,
		graph: "https://graph.microsoft.com/.default"
	};
	return { async getToken(resource) {
		if (Date.now() >= expiresAt) throw new TeamsAuthorizationError();
		const scope = resources[resource];
		if (!scope) throw new TeamsAuthorizationError();
		let result;
		try {
			result = await acquire({
				oboAssertion: assertion,
				scopes: [scope]
			});
		} catch (error) {
			let claims;
			if (error !== null && typeof error === "object" && "claims" in error && typeof error.claims === "string" && error.claims.length <= 8192) try {
				const parsed = JSON.parse(error.claims);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && "access_token" in parsed && parsed.access_token !== null && typeof parsed.access_token === "object" && !Array.isArray(parsed.access_token)) claims = JSON.stringify(parsed);
			} catch {
				throw new TeamsAuthorizationError();
			}
			throw new TeamsAuthorizationError("authorization_required", claims);
		}
		if (!result?.accessToken || result.accessToken === assertion) throw new TeamsAuthorizationError();
		return result.accessToken;
	} };
}
//#endregion
//#region src/local-pairing.ts
var LocalPairingError = class extends Error {
	status;
	code;
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
		this.name = "LocalPairingError";
	}
};
var hash = (value) => createHash("sha256").update(value).digest("base64url");
var binding = (identity) => ({
	partition: principalPartition(identity.principal),
	generation: identity.generation
});
var matches = (expected, identity) => expected.partition === principalPartition(identity.principal) && expected.generation === identity.generation;
var LocalPairingAuthority = class {
	origin;
	getIdentity;
	instanceId = randomUUID();
	requests = /* @__PURE__ */ new Map();
	sessions = /* @__PURE__ */ new Map();
	now;
	allowLocalReadOnly;
	constructor(origin, getIdentity, options = {}) {
		this.origin = origin;
		this.getIdentity = getIdentity;
		this.now = options.now ?? Date.now;
		this.allowLocalReadOnly = options.allowLocalReadOnly === true;
	}
	checkOrigin(origin) {
		if (origin !== this.origin) throw new LocalPairingError(403, "local_origin_denied");
	}
	current() {
		const identity = this.getIdentity();
		if (!identity || !this.eligible(identity) || (identity.principal.expiresAt ?? 0) <= this.now()) throw new LocalPairingError(401, "native_sign_in_required");
		return identity;
	}
	eligible(identity) {
		return identity.principal.mode === "live" && (identity.principal.roles.includes("TLC.Teams.User") || this.allowLocalReadOnly && isLocalReadOnlyPrincipal(identity.principal));
	}
	prune() {
		const candidate = this.getIdentity();
		const identity = candidate && this.eligible(candidate) && (candidate.principal.expiresAt ?? 0) > this.now() ? candidate : void 0;
		for (const [id, request] of this.requests) if (request.expiresAt <= this.now() || request.ownerAtRequest && identity && !matches(request.ownerAtRequest, identity)) this.requests.delete(id);
		for (const [id, session] of this.sessions) if (session.expiresAt <= this.now() || !identity || !matches(session.binding, identity)) this.sessions.delete(id);
	}
	begin(value, origin) {
		this.checkOrigin(origin);
		const input = localPairRequestSchema.parse(value);
		this.prune();
		if (this.requests.size >= 3) throw new LocalPairingError(429, "local_pairing_capacity");
		let userCode;
		do
			userCode = randomBytes(4).toString("hex").toUpperCase();
		while ([...this.requests.values()].some((request) => request.userCode === userCode));
		const requestId = randomUUID();
		const expiresAt = this.now() + 3e5;
		const identity = this.getIdentity();
		this.requests.set(requestId, {
			challenge: input.challenge,
			expiresAt,
			userCode,
			attempts: 0,
			...input.contextTenantId ? { contextTenantId: input.contextTenantId.toLowerCase() } : {},
			...input.contextUserId ? { contextUserId: input.contextUserId.toLowerCase() } : {},
			...identity ? { ownerAtRequest: binding(identity) } : {}
		});
		return {
			contractVersion: "1.0",
			requestId,
			userCode,
			expiresAt: new Date(expiresAt).toISOString(),
			state: "pending-owner-approval"
		};
	}
	pending() {
		this.prune();
		return [...this.requests.values()].map((request) => ({
			userCode: request.userCode,
			expiresAt: new Date(request.expiresAt).toISOString(),
			approved: !!request.approved
		}));
	}
	reviewGeneration() {
		return `${this.instanceId}:${this.current().generation}`;
	}
	approve(userCode) {
		this.prune();
		const identity = this.current();
		const pending = [...this.requests.values()].find((request) => request.userCode === userCode);
		if (!pending) throw new LocalPairingError(410, "local_pairing_expired");
		if (pending.ownerAtRequest && !matches(pending.ownerAtRequest, identity) || pending.contextTenantId && pending.contextTenantId !== identity.principal.tenantId.toLowerCase() || pending.contextUserId && pending.contextUserId !== identity.principal.userId.toLowerCase()) throw new LocalPairingError(403, "local_identity_mismatch");
		pending.approved = binding(identity);
	}
	exchange(value, origin) {
		this.checkOrigin(origin);
		const input = localPairExchangeSchema.parse(value);
		this.prune();
		const pending = this.requests.get(input.requestId);
		if (!pending) throw new LocalPairingError(410, "local_pairing_expired");
		if (!timingSafeEqual(Buffer.from(hash(input.verifier)), Buffer.from(pending.challenge))) {
			if (++pending.attempts >= 5) this.requests.delete(input.requestId);
			throw new LocalPairingError(403, "local_verifier_rejected");
		}
		if (!pending.approved) return {
			contractVersion: "1.0",
			state: "pending-owner-approval",
			expiresAt: new Date(pending.expiresAt).toISOString()
		};
		const identity = this.current();
		if (!matches(pending.approved, identity)) {
			this.requests.delete(input.requestId);
			throw new LocalPairingError(401, "local_connection_changed");
		}
		if (this.sessions.size >= 8) throw new LocalPairingError(429, "local_session_capacity");
		const token = randomBytes(32).toString("base64url");
		const expiresAt = Math.min(this.now() + 9e5, identity.principal.expiresAt ?? this.now());
		this.sessions.set(hash(token), {
			binding: pending.approved,
			expiresAt
		});
		this.requests.delete(input.requestId);
		return {
			contractVersion: "1.0",
			state: "paired",
			token,
			expiresAt: new Date(expiresAt).toISOString()
		};
	}
	authenticate(token) {
		this.prune();
		if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LocalPairingError(401, "local_session_required");
		const key = hash(token);
		const session = this.sessions.get(key);
		const identity = this.current();
		if (!session || !matches(session.binding, identity)) {
			this.sessions.delete(key);
			throw new LocalPairingError(401, "local_session_required");
		}
		return {
			...identity.principal,
			expiresAt: Math.min(session.expiresAt, identity.principal.expiresAt ?? 0)
		};
	}
	revoke(token) {
		this.authenticate(token);
		this.sessions.delete(hash(token));
	}
	invalidate() {
		this.requests.clear();
		this.sessions.clear();
	}
};
//#endregion
//#region src/native-identity.ts
var NativeConnectionError = class extends Error {
	code;
	constructor(code) {
		super(code.replaceAll("_", " "));
		this.code = code;
		this.name = "NativeConnectionError";
	}
};
var knownRoles = [
	"TLC.Teams.User",
	"TLC.Teams.Writer",
	"TLC.Teams.Publisher",
	"TLC.Teams.ContextAdmin"
];
function createNativeAuthenticationClient(configuration) {
	const client = new PublicClientApplication({ auth: {
		clientId: configuration.nativeClientId,
		authority: `https://login.microsoftonline.com/${configuration.tenantId}`
	} });
	return {
		interactive: (scopes) => client.acquireTokenInteractive({
			scopes,
			...new URL(configuration.nativeRedirectUri).port ? { preferredPort: Number(new URL(configuration.nativeRedirectUri).port) } : {},
			openBrowser: async (value) => {
				const url = new URL(value);
				if (process.platform !== "win32" || url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com") throw new NativeConnectionError("native_identity_rejected");
				const browserEnvironment = { TLC_NATIVE_AUTH_URL: url.href };
				for (const name of [
					"SystemRoot",
					"WINDIR",
					"ComSpec",
					"PATH",
					"PATHEXT",
					"TEMP",
					"TMP",
					"USERPROFILE",
					"LOCALAPPDATA",
					"APPDATA",
					"HOMEDRIVE",
					"HOMEPATH"
				]) if (process.env[name] !== void 0) browserEnvironment[name] = process.env[name];
				await promisify(execFile)("pwsh", [
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"$ErrorActionPreference='Stop'; Start-Process -FilePath $env:TLC_NATIVE_AUTH_URL"
				], {
					env: browserEnvironment,
					timeout: 3e4
				});
			}
		}),
		silent: (scopes, account) => client.acquireTokenSilent({
			scopes,
			account
		}),
		clear: async () => {
			const cache = client.getTokenCache();
			for (const account of await cache.getAllAccounts()) await cache.removeAccount(account);
		}
	};
}
var NativeIdentityProvider = class {
	configuration;
	client;
	options;
	generation = 0;
	current;
	tokens = /* @__PURE__ */ new Map();
	states = /* @__PURE__ */ new Map();
	connecting = false;
	blocked = false;
	resolveKey;
	now;
	constructor(configuration, client, options) {
		this.configuration = configuration;
		this.client = client;
		this.options = options;
		this.now = options.now ?? Date.now;
		this.resolveKey = options.resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`));
	}
	identity() {
		return this.current && (this.current.identity.principal.expiresAt ?? 0) > this.now() ? this.current.identity : void 0;
	}
	scopes(resource) {
		if (resource === "msx") return [`${this.configuration.msxResource}/.default`];
		if (resource === "mcp") return [this.configuration.mcpScope];
		if (!this.configuration.graphScopes.length) throw new NativeConnectionError("native_resource_unavailable");
		return this.configuration.graphScopes;
	}
	sameAuthority(first, second) {
		return first.principal.userId === second.principal.userId && first.principal.roles.length === second.principal.roles.length && first.principal.roles.every((role) => second.principal.roles.includes(role));
	}
	async validate(result) {
		try {
			const { payload } = await jwtVerify(result.idToken, this.resolveKey, {
				issuer: `https://login.microsoftonline.com/${this.configuration.tenantId}/v2.0`,
				audience: this.configuration.nativeClientId,
				algorithms: ["RS256"],
				requiredClaims: [
					"exp",
					"tid",
					"oid",
					"roles",
					"ver"
				],
				currentDate: new Date(this.now())
			});
			const oid = z.uuid().parse(payload["oid"]).toLowerCase();
			const roles = z.array(z.string()).parse(payload["roles"]).filter((role) => knownRoles.includes(role));
			if (payload["tid"] !== this.configuration.tenantId || payload["ver"] !== "2.0" || payload["idtyp"] === "app" || !roles.includes("TLC.Teams.User") || !result.accessToken || !result.account || !result.expiresOn || !Number.isFinite(result.expiresOn.getTime()) || result.expiresOn.getTime() <= this.now() || result.account.tenantId.toLowerCase() !== this.configuration.tenantId || result.account.localAccountId.toLowerCase() !== oid.toLowerCase()) throw new Error("Invalid native identity.");
			return {
				account: result.account,
				tokenExpiresAt: result.expiresOn.getTime(),
				identity: {
					generation: this.generation,
					account: result.account.username,
					principal: {
						key: `${this.configuration.tenantId}:${oid}`,
						tenantId: this.configuration.tenantId,
						userId: oid,
						environmentId: this.configuration.environmentId,
						mode: "live",
						roles,
						expiresAt: Math.min(Number(payload.exp) * 1e3, result.expiresOn.getTime())
					}
				}
			};
		} catch {
			throw new NativeConnectionError("native_identity_rejected");
		}
	}
	failure(resource, error) {
		const code = error !== null && typeof error === "object" && "errorCode" in error && typeof error.errorCode === "string" ? error.errorCode : "";
		const failure = error instanceof NativeConnectionError ? error : new NativeConnectionError(/consent|interaction|login_required/.test(code) ? "native_consent_required" : "native_source_denied");
		this.states.set(resource, {
			state: failure.code === "native_consent_required" ? "consent-required" : "denied",
			detail: failure.message
		});
		return failure;
	}
	async connect(resource) {
		if (this.connecting) throw new NativeConnectionError("native_sign_in_in_progress");
		const scopes = this.scopes(resource);
		const previous = this.identity();
		if (resource !== "msx" && !previous) throw new NativeConnectionError("native_sign_in_required");
		if (resource === "msx") {
			this.current = void 0;
			this.tokens.clear();
			this.states.clear();
			this.generation++;
		}
		const generation = this.generation;
		this.connecting = true;
		this.blocked = false;
		try {
			const result = await this.client.interactive(scopes);
			const verified = await this.validate(result);
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			if (previous && resource !== "msx" && !this.sameAuthority(verified.identity, previous)) {
				await this.disconnect();
				throw new NativeConnectionError("native_connection_changed");
			}
			if (resource === "msx") await this.options.probeMsxIdentity(result.accessToken, verified.identity.principal);
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			this.current = verified;
			this.tokens.set(resource, {
				token: result.accessToken,
				expiresAt: verified.tokenExpiresAt
			});
			this.states.set(resource, {
				state: "connected",
				detail: resource === "msx" ? "Native identity and own Dataverse mapping verified." : "Resource token acquired; source operation authorization remains independent."
			});
		} catch (error) {
			if (generation === this.generation && error instanceof NativeConnectionError && error.code === "native_identity_rejected") await this.disconnect();
			this.blocked = !this.identity();
			throw this.failure(resource, error);
		} finally {
			this.connecting = false;
		}
	}
	async getToken(resource) {
		const identity = this.identity();
		if (!identity || !this.current) throw new NativeConnectionError("native_sign_in_required");
		const scopes = this.scopes(resource);
		const cached = this.tokens.get(resource);
		if (cached && cached.expiresAt > this.now() + 3e4) return cached.token;
		const generation = this.generation;
		try {
			const result = await this.client.silent(scopes, this.current.account);
			const verified = await this.validate(result);
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			if (!this.sameAuthority(verified.identity, identity)) {
				await this.disconnect();
				throw new NativeConnectionError("native_connection_changed");
			}
			this.current = verified;
			this.tokens.set(resource, {
				token: result.accessToken,
				expiresAt: verified.tokenExpiresAt
			});
			this.states.set(resource, {
				state: "connected",
				detail: "Native resource token acquired silently for the same owner."
			});
			return result.accessToken;
		} catch (error) {
			if (generation === this.generation && error instanceof NativeConnectionError && error.code === "native_identity_rejected") await this.disconnect();
			throw this.failure(resource, error);
		}
	}
	async disconnect() {
		this.generation++;
		this.current = void 0;
		this.tokens.clear();
		this.states.clear();
		this.blocked = false;
		await this.client.clear();
	}
	status() {
		const identity = this.identity();
		return {
			contractVersion: "1.0",
			state: this.connecting ? "connecting" : identity ? "connected" : this.blocked ? "blocked" : "sign-in-required",
			detail: identity ? "Connected through the local owner’s native identity; feature/source grants remain separate." : "Use the protected local owner command to sign in. HTTP requests never open sign-in.",
			...identity ? { account: identity.account } : {},
			resources: [
				"msx",
				"mcp",
				"graph"
			].map((resource) => {
				const state = this.states.get(resource);
				return {
					resource,
					...state && (identity || state.state !== "connected") ? state : {
						state: resource === "graph" && !this.configuration.graphScopes.length ? "unavailable" : "not-connected",
						detail: "This resource has not been connected."
					}
				};
			}),
			capabilities: nativeCapabilities.map((capability) => capability.id === "msx" && identity ? {
				...capability,
				state: "available",
				detail: "Own native identity and Dataverse user mapping verified. Record-level source authorization still applies."
			} : capability.id === "graph" && !this.configuration.graphScopes.length ? {
				...capability,
				state: "requires-configuration",
				detail: "Optional Graph delegated scopes are not configured. No transcript sign-in or cloud subscription is started."
			} : capability.id === "guidance" && this.configuration.guidanceMode === "foundry" ? {
				...capability,
				state: "requires-source-grant",
				detail: "Foundry guidance explicitly selected. Its separate configured workload identity and deployed agents must be authorized."
			} : { ...capability })
		};
	}
};
//#endregion
//#region src/app.ts
var TeamsHttpError = class extends Error {
	status;
	code;
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
};
var bodyLimit = 1048576;
var previewRequest = z.object({
	operation: z.string().min(1).max(100),
	input: z.record(z.string(), z.unknown())
}).strict();
var samplePrincipal = {
	key: "sample:sample-user",
	tenantId: "sample",
	userId: "sample-user",
	environmentId: "sample",
	mode: "sample",
	roles: [
		"TLC.Teams.User",
		"TLC.Teams.Writer",
		"TLC.Teams.ContextAdmin",
		"TLC.Teams.Publisher"
	]
};
function assertNativeHttpRequest(request, origin) {
	const target = new URL(request.url ?? "/", origin);
	const publicNavigation = request.method === "GET" && target.origin === origin && target.pathname === "/" && request.headers["sec-fetch-mode"] === "navigate" && ["iframe", "document"].includes(String(request.headers["sec-fetch-dest"]));
	if (request.headers.host?.toLowerCase() !== new URL(origin).host.toLowerCase() || request.headers["x-forwarded-host"] || request.headers["x-forwarded-proto"] || request.headers.origin && request.headers.origin !== origin || request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"])) && !publicNavigation || [
		"POST",
		"PUT",
		"PATCH",
		"DELETE"
	].includes(request.method ?? "") && request.headers.origin !== origin) throw new LocalPairingError(403, "local_origin_denied");
}
function createTeamsHandler(options) {
	const local = isLocalConfiguration(options.configuration) ? options.localConnection : void 0;
	if (isLocalConfiguration(options.configuration) && !local) throw new Error("Local HTTP requires the protected local pairing authority.");
	const authenticate = options.authenticate ?? (local ? async (assertion) => local.pairing.authenticate(assertion) : options.configuration.mode === "sample" ? async () => samplePrincipal : createTeamsAuthenticator(options.configuration));
	return async (request, response) => {
		const url = new URL(request.url ?? "/", options.configuration.origin);
		if (!url.pathname.startsWith("/api/teams/") && url.pathname !== "/api/health") return false;
		const correlationId = randomUUID();
		response.setHeader("x-correlation-id", correlationId);
		response.setHeader("cache-control", "no-store");
		let authenticatedAssertion;
		const assertCurrentCaller = () => {
			if (local && authenticatedAssertion !== void 0) local.pairing.authenticate(authenticatedAssertion);
		};
		const json = (status, value) => {
			if (status >= 200 && status < 300) assertCurrentCaller();
			response.statusCode = status;
			response.setHeader("content-type", "application/json; charset=utf-8");
			response.end(JSON.stringify(value));
		};
		try {
			if (local) assertNativeHttpRequest(request, options.configuration.origin);
			if (url.pathname === "/api/health" && request.method === "GET") {
				json(200, {
					status: "ready",
					surface: "teams",
					mode: options.configuration.mode
				});
				return true;
			}
			if (url.pathname === "/api/teams/config" && request.method === "GET") {
				if (isLocalConfiguration(options.configuration)) {
					const cli = isCliConfiguration(options.configuration);
					json(200, {
						contractVersion: cli ? "1.1" : "1.0",
						mode: "live",
						authentication: options.configuration.authentication,
						capabilities: cli ? cliCapabilities : nativeCapabilities
					});
					return true;
				}
				json(200, options.configuration.mode === "sample" ? { mode: "sample" } : {
					mode: "live",
					tenantId: options.configuration.tenantId,
					spaClientId: options.configuration.spaClientId,
					apiScope: `api://${options.configuration.apiClientId}/access_as_user`
				});
				return true;
			}
			if (url.pathname === "/api/teams/graph/notifications" && request.method === "POST") {
				if (!options.transcriptEvents) throw new TeamsHttpError(404, "graph_notifications_disabled");
				const validation = url.searchParams.get("validationToken");
				if (validation !== null) {
					if (validation.length > 1e3) throw new TeamsHttpError(400, "invalid_validation_token");
					response.statusCode = 200;
					response.setHeader("content-type", "text/plain; charset=utf-8");
					response.end(validation);
					return true;
				}
				try {
					await options.transcriptEvents.receive(await readBody(request));
				} catch {
					throw new TeamsHttpError(403, "graph_notification_rejected");
				}
				json(202, { state: "queued" });
				return true;
			}
			if ([
				"POST",
				"PUT",
				"PATCH",
				"DELETE"
			].includes(request.method ?? "")) {
				const origin = request.headers.origin;
				const site = request.headers["sec-fetch-site"];
				if (origin && origin !== options.configuration.origin || site && !["same-origin", "none"].includes(String(site))) throw new TeamsHttpError(403, "cross_origin_denied");
			}
			if (local && request.method === "POST" && url.pathname === "/api/teams/local/requests") {
				json(201, local.pairing.begin(await readBody(request), request.headers.origin ?? ""));
				return true;
			}
			if (local && request.method === "POST" && url.pathname === "/api/teams/local/exchange") {
				json(200, local.pairing.exchange(await readBody(request), request.headers.origin ?? ""));
				return true;
			}
			const authorization = request.headers.authorization;
			const assertion = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
			let principal;
			try {
				principal = await authenticate(assertion);
			} catch (error) {
				if (error instanceof TeamsAuthorizationError) throw error;
				throw new TeamsHttpError(401, "authorization_required");
			}
			authenticatedAssertion = assertion;
			if (local && request.method === "POST" && url.pathname === "/api/teams/local/revoke") {
				localRevokeRequestSchema.parse(await readBody(request));
				local.pairing.revoke(assertion);
				authenticatedAssertion = void 0;
				json(200, {
					contractVersion: "1.0",
					state: "disconnected"
				});
				return true;
			}
			if (local && request.method === "GET" && url.pathname === "/api/teams/local/status") {
				json(200, nativeConnectionStatusSchema.parse(local.status()));
				return true;
			}
			if (local && /^\/api\/teams\/(?:contexts|publications|shared)(?:\/|$)/.test(url.pathname)) throw new TeamsHttpError(409, "local_collaboration_distribution_required");
			if (request.method === "GET" && url.pathname === "/api/teams/session") {
				json(200, {
					contractVersion: "1.0",
					mode: principal.mode,
					roles: principal.roles,
					displayName: principal.mode === "sample" ? "Sample user" : isLocalReadOnlyPrincipal(principal) ? "Verified local MSX user (read-only)" : "Authorized Microsoft FTE"
				});
				return true;
			}
			if (isCliConfiguration(options.configuration) && /^\/api\/teams\/actions(?:\/|$)/.test(url.pathname)) throw new TeamsHttpError(403, "local_read_only");
			const lifecycle = new CollaborationLifecycle(options.store, options.acceptNewWork ?? true);
			if (url.pathname === "/api/teams/lifecycle" && request.method === "GET") {
				json(200, await lifecycle.status(principal));
				return true;
			}
			if (url.pathname === "/api/teams/lifecycle" && request.method === "POST") {
				const input = collaborationLifecycleCommandSchema.parse(await readBody(request));
				const status = await lifecycle.set(principal, input.command);
				if (input.command !== "resume") await options.onDeactivate?.(principal);
				json(200, status);
				return true;
			}
			await lifecycle.assertReadable(principal);
			await new UserRequestBudget(options.store).consume(principal, "requests", principal.mode === "sample" ? 600 : 60);
			const services = await options.resolveServices(principal, assertion);
			const operations = createApplicationOperations(services);
			const notifications = new NotificationOutbox(options.store);
			const activity = new WorkflowActivityStore(options.store);
			const acquisition = new MeetingAcquisitionService(options.store, {
				readOpportunity: async (_actor, opportunityId) => {
					await services.orchestrator.getOpportunitySnapshot(opportunityId);
				},
				getTranscripts: (_actor, input) => services.acquireTranscripts(input),
				propose: (_actor, opportunityId, transcript) => services.proposeTranscript(opportunityId, transcript)
			});
			const actions = new ReviewedActionService(options.store, {
				authorize: async (_actor, name, input) => {
					const admission = await lifecycle.assertActive(principal);
					const localGeneration = local?.pairing.reviewGeneration();
					if (name === "publishSummary") {
						if (local) throw new TeamsHttpError(409, "local_collaboration_distribution_required");
						if (principal.mode === "live" && !options.deliverPublication) throw new TeamsHttpError(503, "publication_delivery_unavailable");
						return {
							source: await publications.authorize(principal, input),
							admissionGeneration: admission.generation
						};
					}
					if (operations.describe(name).effect === "read") throw new TeamsHttpError(400, "not_a_mutation");
					const source = await operations.snapshot(name, input);
					assertCurrentCaller();
					if (local && localGeneration !== local.pairing.reviewGeneration()) throw new NativeConnectionError("native_connection_changed");
					return {
						source,
						admissionGeneration: admission.generation,
						...localGeneration ? { localGeneration } : {}
					};
				},
				execute: async (_actor, name, input, before) => {
					const reviewed = z.object({
						source: z.unknown(),
						admissionGeneration: z.number().int().nonnegative(),
						localGeneration: z.string().optional()
					}).strict().parse(before);
					const admission = await lifecycle.status(principal);
					if (!admission.acceptingNewWork || admission.generation !== reviewed.admissionGeneration) throw new ActionDispatchPreventedError();
					if (local) try {
						assertCurrentCaller();
						if (local.pairing.reviewGeneration() !== reviewed.localGeneration) throw new ActionDispatchPreventedError();
					} catch (error) {
						if (error instanceof LocalPairingError) throw new ActionDispatchPreventedError();
						throw error;
					}
					return name === "publishSummary" ? publications.execute(principal, input) : services.withReviewedVersions(reviewed.source, () => operations.invoke(name, input));
				}
			});
			const contexts = new CollaborationService(options.store, options.authority, async (_actor, accountId, opportunityId) => {
				if (!(await services.orchestrator.listAccounts()).some((account) => account.id === accountId)) throw new TeamsHttpError(403, "source_access_denied");
				if (opportunityId) {
					if ((await services.orchestrator.getOpportunitySnapshot(opportunityId)).account.id !== accountId) throw new TeamsHttpError(403, "binding_target_mismatch");
				}
			});
			const publications = new PublicationService(options.store, contexts, async (_actor, binding) => {
				const account = (await services.orchestrator.listAccounts()).find((entry) => entry.id === binding.accountId);
				if (!account) throw new TeamsHttpError(403, "source_access_denied");
				if (binding.opportunityId) {
					const snapshot = await services.orchestrator.getOpportunitySnapshot(binding.opportunityId);
					return {
						title: snapshot.opportunity.name,
						text: `${account.name}. Recorded MCEM stage ${snapshot.opportunity.recordedStage}. ${snapshot.milestones.length} visible milestones.`,
						sourceRecordIds: [snapshot.opportunity.id]
					};
				}
				const opportunities = await services.orchestrator.listOpportunities(account.id);
				return {
					title: account.name,
					text: `${opportunities.length} opportunities visible to the publisher at review.`,
					sourceRecordIds: [account.id]
				};
			}, async (actor, binding, projection) => {
				if (options.deliverPublication) return options.deliverPublication(actor, binding, projection);
				if (actor.mode !== "sample") throw new TeamsHttpError(503, "publication_delivery_unavailable");
				return {
					state: "sample-only",
					detail: "Approved sample artifact saved. No Teams message was sent."
				};
			});
			if (request.method === "GET" && url.pathname === "/api/teams/activity") {
				json(200, {
					contractVersion: "1.0",
					actions: (await actions.list(principal)).map((item) => ({
						id: item.id,
						operation: item.operation,
						state: item.state
					})),
					notifications: (await notifications.list(principal)).map((item) => ({
						id: item.id,
						title: item.title,
						reference: item.reference,
						state: item.state,
						occurredAt: item.occurredAt
					})),
					workflows: await activity.list(principal, (runId) => {
						try {
							services.workflows.get({
								contractVersion: "1.0",
								runId
							});
							return true;
						} catch (error) {
							if (error instanceof WorkflowRuntimeError && error.code === "run_not_found") return false;
							throw error;
						}
					})
				});
				return true;
			}
			if (request.method === "GET" && url.pathname.startsWith("/api/teams/references/")) {
				const id = decodeURIComponent(url.pathname.slice(22));
				const row = await options.store.read(principalPartition(principal), `reference:${id}`);
				if (!row) throw new TeamsHttpError(403, "private_reference_unavailable");
				const reference = z.object({
					accountId: z.string(),
					query: z.string().min(2).max(100)
				}).strict().parse(row.value);
				const candidate = (await services.orchestrator.searchAccounts({
					query: reference.query,
					matchBy: "name"
				})).find((entry) => entry.id === reference.accountId);
				if (!candidate) throw new TeamsHttpError(403, "source_access_denied");
				json(200, accountCandidateSchema.parse(candidate));
				return true;
			}
			if (request.method === "GET" && url.pathname.startsWith("/api/teams/contexts/")) {
				json(200, await contexts.get(principal, decodeURIComponent(url.pathname.slice(20))));
				return true;
			}
			if (request.method === "GET" && url.pathname.startsWith("/api/teams/shared/")) {
				json(200, await publications.readShared(principal, decodeURIComponent(url.pathname.slice(18)), { stage: principal.mode === "live" }));
				return true;
			}
			if (request.method !== "POST") throw new TeamsHttpError(404, "route_not_found");
			const body = await readBody(request);
			if (!url.pathname.startsWith("/api/teams/operations/") && ![
				"/api/teams/documents/export",
				"/api/teams/documents/email",
				"/api/teams/meetings/sources",
				"/api/teams/meetings/review",
				"/api/teams/meetings/unsubscribe"
			].includes(url.pathname)) await lifecycle.assertActive(principal);
			if (url.pathname === "/api/teams/documents/export") {
				const input = z.object({
					opportunityId: z.string().min(1).max(200),
					document: exportResponseRequestSchema
				}).strict().parse(body);
				await services.orchestrator.getOpportunitySnapshot(input.opportunityId);
				const bytes = await createResponseDocumentBuffer(input.document);
				assertCurrentCaller();
				response.statusCode = 200;
				response.setHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
				response.setHeader("content-disposition", "attachment; filename=\"TLC-response.docx\"");
				response.end(bytes);
			} else if (url.pathname === "/api/teams/documents/email") {
				const input = z.object({
					opportunityId: z.string().min(1).max(200),
					draft: emailComposeRequestSchema
				}).strict().parse(body);
				await services.orchestrator.getOpportunitySnapshot(input.opportunityId);
				assertCurrentCaller();
				response.statusCode = 200;
				response.setHeader("content-type", "message/rfc822");
				response.setHeader("content-disposition", "attachment; filename=\"TLC-reviewed-draft.eml\"");
				response.end(createOutlookDraftMessage(input.draft));
			} else if (url.pathname.startsWith("/api/teams/operations/")) {
				const name = decodeURIComponent(url.pathname.slice(22));
				if (!operations.names().includes(name)) throw new TeamsHttpError(404, "unknown_operation");
				if (operations.describe(name).effect !== "read") throw new TeamsHttpError(403, "review_required");
				if (operations.describe(name).startsWork) await lifecycle.assertActive(principal);
				if (operations.describe(name).startsWork) await new UserRequestBudget(options.store).consume(principal, "agent", principal.mode === "sample" ? 60 : 4);
				const result = await operations.invoke(name, body);
				if (["workflows.start", "workflows.cancel"].includes(name)) await activity.record(principal, workflowRunSchema.parse(result));
				if (name === "workflows.get") await activity.record(principal, z.object({ run: workflowRunSchema }).parse(result).run);
				json(200, result);
			} else if (url.pathname === "/api/teams/actions/preview") {
				const input = previewRequest.parse(body);
				if (input.operation === "applyMeetingChangeSet") throw new TeamsHttpError(403, "server_owned_meeting_draft_required");
				const normalized = operations.describe(input.operation).parse(input.input);
				json(200, await actions.prepare(principal, input.operation, normalized));
			} else if (url.pathname === "/api/teams/actions/commit") {
				const receipt = await actions.commit(principal, body);
				await notifications.enqueue(principal, receipt.id, receipt.state === "confirmed" ? "Reviewed action completed" : "Action outcome needs attention", receipt.id);
				await options.notify?.(principal);
				json(200, receipt);
			} else if (url.pathname === "/api/teams/contexts") json(200, await contexts.bind(principal, body));
			else if (url.pathname === "/api/teams/publications/preview") {
				const input = z.object({ bindingId: z.string().min(1).max(200) }).strict().parse(body);
				json(200, await actions.prepare(principal, "publishSummary", await publications.prepareInput(principal, input.bindingId)));
			} else if (url.pathname === "/api/teams/meetings/resolve") {
				const input = z.object({ joinUrl: z.url() }).strict().parse(body);
				json(200, { meetingId: await services.resolveMeeting(input.joinUrl) });
			} else if (url.pathname === "/api/teams/meetings/sources") {
				const input = z.object({ opportunityId: z.string().min(1).max(200) }).strict().parse(body);
				if (principal.mode !== "sample") throw new TeamsHttpError(400, "live_meeting_binding_required");
				await services.orchestrator.getOpportunitySnapshot(input.opportunityId);
				json(200, await services.listTranscriptSources(input.opportunityId));
			} else if (url.pathname === "/api/teams/meetings/acquire") {
				const result = await acquisition.acquire(principal, body);
				if (result.status.state === "ready") {
					await notifications.enqueueAcquisition(principal, result);
					await options.notify?.(principal);
				}
				const subscription = options.transcriptEvents && ["ready", "waiting"].includes(result.status.state) ? await options.transcriptEvents.ensure(principal, body) : void 0;
				json(200, {
					status: result.status,
					proposals: result.proposals,
					...subscription ? { subscription } : {}
				});
			} else if (url.pathname === "/api/teams/meetings/unsubscribe") {
				if (!options.transcriptEvents) throw new TeamsHttpError(400, "graph_notifications_disabled");
				json(200, await options.transcriptEvents.stop(principal, body));
			} else if (url.pathname === "/api/teams/meetings/review") {
				const input = z.object({ acquisitionId: z.string().min(1).max(200) }).strict().parse(body);
				json(200, await acquisition.review(principal, input.acquisitionId));
			} else if (url.pathname === "/api/teams/meetings/preview-changes") {
				const input = z.object({
					acquisitionId: z.string().min(1).max(200),
					approval: meetingChangeSetApprovalSchema
				}).strict().parse(body);
				const proposal = (await acquisition.review(principal, input.acquisitionId)).find((entry) => entry.changeSetId === input.approval.changeSetId && entry.opportunityId === input.approval.opportunityId);
				if (!proposal) throw new TeamsHttpError(403, "meeting_draft_unavailable");
				if (input.approval.approvedSlotIds.some((id) => !proposal.slots.some((slot) => slot.slotId === id && !slot.blocked)) || input.approval.approvedNewMilestoneTempIds.some((id) => !proposal.newMilestones.some((entry) => entry.tempId === id))) throw new TeamsHttpError(400, "invalid_change_selection");
				json(200, await actions.prepare(principal, "applyMeetingChangeSet", {
					proposal,
					approval: input.approval
				}));
			} else throw new TeamsHttpError(404, "route_not_found");
		} catch (error) {
			const status = error instanceof NativeConnectionError ? error.code === "native_source_denied" ? 403 : error.code === "native_resource_unavailable" ? 409 : 401 : error instanceof LocalPairingError ? error.status : error instanceof CollaborationAdmissionError || error instanceof ActionReviewStaleError ? 409 : error instanceof WorkflowScopeAuthorizationError ? 403 : error instanceof RequestQuotaError ? 429 : error instanceof TeamsAuthorizationError ? 401 : error instanceof TeamsHttpError ? error.status : error instanceof ZodError || error instanceof SyntaxError || error instanceof URIError ? 400 : 500;
			const code = error instanceof NativeConnectionError || error instanceof LocalPairingError ? error.code : error instanceof CollaborationAdmissionError ? error.code : error instanceof ActionReviewStaleError ? "action_review_stale" : error instanceof WorkflowScopeAuthorizationError ? "workflow_source_scope_changed" : error instanceof RequestQuotaError ? "user_quota_exhausted" : error instanceof TeamsAuthorizationError ? error.code : error instanceof TeamsHttpError ? error.code : status === 400 ? "invalid_request" : "operation_failed";
			const method = [
				"GET",
				"POST",
				"PUT",
				"PATCH",
				"DELETE"
			].includes(request.method ?? "") ? request.method : "OTHER";
			const candidate = url.pathname.split("/")[3] ?? "";
			const category = [
				"session",
				"config",
				"local",
				"operations",
				"actions",
				"activity",
				"contexts",
				"meetings",
				"publications",
				"shared",
				"documents",
				"graph",
				"references",
				"lifecycle"
			].includes(candidate) ? candidate : "unknown";
			options.onError?.({
				correlationId,
				code,
				method,
				category
			});
			const claims = error instanceof TeamsAuthorizationError ? error.claims : void 0;
			if (claims && options.configuration.mode === "live") response.setHeader("www-authenticate", `Bearer authorization_uri="https://login.microsoftonline.com/${options.configuration.tenantId}/oauth2/v2.0/authorize", error="insufficient_claims", claims="${Buffer.from(claims).toString("base64")}"`);
			json(status, {
				error: code,
				correlationId,
				...claims ? { claims } : {}
			});
		}
		return true;
	};
}
async function readBody(request) {
	if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new TeamsHttpError(415, "json_required");
	if (Number(request.headers["content-length"]) > bodyLimit) {
		request.resume();
		throw new TeamsHttpError(413, "request_too_large");
	}
	const raw = await new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		request.on("data", (chunk) => {
			size += chunk.length;
			if (size <= bodyLimit) chunks.push(chunk);
		});
		request.on("error", reject);
		request.on("end", () => size > bodyLimit ? reject(new TeamsHttpError(413, "request_too_large")) : resolve(Buffer.concat(chunks).toString("utf8")));
	});
	return JSON.parse(raw);
}
//#endregion
//#region ../../packages/connectors/common/scoped-document-store.ts
function serializeDocument(value, maxDocumentBytes = 48e3) {
	const json = JSON.stringify(value);
	if (!json || Buffer.byteLength(json, "utf8") > maxDocumentBytes) throw new Error("The private state document exceeds its supported size.");
	return json;
}
var requireModule$1 = createRequire(import.meta.url);
var SqliteDocumentStore = class {
	db;
	maxDocumentBytes;
	constructor(path = ":memory:", options = {}) {
		this.maxDocumentBytes = options.maxDocumentBytes ?? 48e3;
		if (!Number.isInteger(this.maxDocumentBytes) || this.maxDocumentBytes < 1 || this.maxDocumentBytes > 72e3) throw new Error("The SQLite document storage limit is invalid.");
		const { DatabaseSync } = requireModule$1("node:sqlite");
		this.db = new DatabaseSync(path);
		this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS scoped_documents (partition TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(partition,key));");
	}
	async read(partition, key) {
		const row = this.db.prepare("SELECT revision,json FROM scoped_documents WHERE partition=? AND key=?").get(partition, key);
		return row ? {
			revision: Number(row["revision"]),
			value: JSON.parse(String(row["json"]))
		} : void 0;
	}
	async insert(partition, key, value) {
		return this.db.prepare("INSERT OR IGNORE INTO scoped_documents VALUES(?,?,1,?)").run(partition, key, serializeDocument(value, this.maxDocumentBytes)).changes === 1;
	}
	async replace(partition, key, expectedRevision, value) {
		return this.db.prepare("UPDATE scoped_documents SET revision=revision+1,json=? WHERE partition=? AND key=? AND revision=?").run(serializeDocument(value, this.maxDocumentBytes), partition, key, expectedRevision).changes === 1;
	}
	async list(partition, prefix, limit) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("State list limit must be between 1 and 100.");
		return this.db.prepare("SELECT key,revision,json FROM scoped_documents WHERE partition=? AND substr(key,1,?)=? ORDER BY key DESC LIMIT ?").all(partition, prefix.length, prefix, limit).map((row) => ({
			key: String(row["key"]),
			revision: Number(row["revision"]),
			value: JSON.parse(String(row["json"]))
		}));
	}
	close() {
		this.db.close();
	}
};
//#endregion
//#region ../../packages/connectors/common/encrypted-document-store.ts
var envelopeSchema = z.object({
	version: z.literal(1),
	iv: z.string(),
	tag: z.string(),
	ciphertext: z.string()
}).strict();
var EncryptedDocumentStore = class {
	store;
	key;
	constructor(store, key) {
		this.store = store;
		if (key.length !== 32) throw new Error("Local state encryption requires a 32-byte key.");
		this.key = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "tlc-local-documents-v1", 32));
	}
	encrypt(partition, key, revision, value) {
		const plaintext = serializeDocument(value);
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		cipher.setAAD(Buffer.from(JSON.stringify([
			partition,
			key,
			revision
		])));
		const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
		return {
			version: 1,
			iv: iv.toString("base64"),
			tag: cipher.getAuthTag().toString("base64"),
			ciphertext: ciphertext.toString("base64")
		};
	}
	decrypt(partition, key, row) {
		try {
			const envelope = envelopeSchema.parse(row.value);
			const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
			decipher.setAAD(Buffer.from(JSON.stringify([
				partition,
				key,
				row.revision
			])));
			decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
			const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
			return {
				revision: row.revision,
				value: JSON.parse(plaintext.toString("utf8"))
			};
		} catch (cause) {
			throw new Error("Local state could not authenticate its encryption key or document. Restore the matching key and backup.", { cause });
		}
	}
	async read(partition, key) {
		const row = await this.store.read(partition, key);
		return row ? this.decrypt(partition, key, row) : void 0;
	}
	async insert(partition, key, value) {
		return this.store.insert(partition, key, this.encrypt(partition, key, 1, value));
	}
	async replace(partition, key, expectedRevision, value) {
		return this.store.replace(partition, key, expectedRevision, this.encrypt(partition, key, expectedRevision + 1, value));
	}
	async list(partition, prefix, limit) {
		return (await this.store.list(partition, prefix, limit)).map((row) => ({
			key: row.key,
			...this.decrypt(partition, row.key, row)
		}));
	}
};
//#endregion
//#region ../../packages/connectors/common/table-document-store.ts
function status(error) {
	return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : void 0;
}
function partitionKey(value) {
	return createHash("sha256").update(value).digest("hex");
}
function rowKey(value) {
	return Buffer.from(value).toString("base64url");
}
var TableDocumentStore = class {
	client;
	constructor(client) {
		this.client = client;
	}
	async read(partition, key) {
		try {
			const entity = await this.client.getEntity(partitionKey(partition), rowKey(key));
			return {
				revision: entity.revision,
				value: JSON.parse(entity.json)
			};
		} catch (error) {
			if (status(error) === 404) return void 0;
			throw error;
		}
	}
	async insert(partition, key, value) {
		try {
			await this.client.createEntity({
				partitionKey: partitionKey(partition),
				rowKey: rowKey(key),
				revision: 1,
				json: serializeDocument(value)
			});
			return true;
		} catch (error) {
			if (status(error) === 409) return false;
			throw error;
		}
	}
	async replace(partition, key, expectedRevision, value) {
		try {
			const entity = await this.client.getEntity(partitionKey(partition), rowKey(key));
			if (entity.revision !== expectedRevision) return false;
			await this.client.updateEntity({
				partitionKey: partitionKey(partition),
				rowKey: rowKey(key),
				revision: expectedRevision + 1,
				json: serializeDocument(value)
			}, "Replace", { etag: entity.etag });
			return true;
		} catch (error) {
			if ([
				404,
				409,
				412
			].includes(status(error) ?? 0)) return false;
			throw error;
		}
	}
	async list(partition, prefix, limit) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("State list limit must be between 1 and 100.");
		const result = [];
		let examined = 0;
		for await (const entity of this.client.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionKey(partition)}'` } })) {
			if (++examined > 500) throw new Error("Private state enumeration requires a narrower partition.");
			const key = Buffer.from(entity.rowKey ?? "", "base64url").toString();
			if (key.startsWith(prefix)) result.push({
				key,
				revision: entity.revision,
				value: JSON.parse(entity.json)
			});
			if (result.length === limit) break;
		}
		return result;
	}
};
//#endregion
//#region src/runtime-resources.ts
function createTeamsWorkloadCredential(runtime, foundryTenantId, environment) {
	return runtime.profile === "local" ? new AzureCliCredential({
		tenantId: foundryTenantId,
		processTimeoutInMs: 3e4
	}) : new ManagedIdentityCredential(environment["AZURE_CLIENT_ID"] ? { clientId: environment["AZURE_CLIENT_ID"] } : {});
}
async function createTeamsStateStore(configuration, runtime, environment) {
	if (runtime.state.kind === "table") {
		const credential = new ManagedIdentityCredential(environment["AZURE_CLIENT_ID"] ? { clientId: environment["AZURE_CLIENT_ID"] } : {});
		return {
			store: new TableDocumentStore(new TableClient(runtime.state.url, "TlcTeams", credential)),
			close() {}
		};
	}
	const key = configuration.mode === "live" ? loadTeamsStateKey(environment) : void 0;
	if (runtime.state.path !== ":memory:") await mkdir(dirname(runtime.state.path), { recursive: true });
	const sqlite = new SqliteDocumentStore(runtime.state.path, { maxDocumentBytes: key ? 72e3 : 48e3 });
	const store = key ? new EncryptedDocumentStore(sqlite, key) : sqlite;
	try {
		if (configuration.mode === "live") {
			const partition = `runtime-key:${configuration.tenantId}:${configuration.environmentId}`;
			const check = await store.read(partition, "validation");
			if (check) {
				if (check.value !== "tlc-local-state-v1") throw new Error("The local state encryption key check is invalid.");
			} else if (!await store.insert(partition, "validation", "tlc-local-state-v1")) {
				if ((await store.read(partition, "validation"))?.value !== "tlc-local-state-v1") throw new Error("The local state encryption key check could not be persisted.");
			}
		}
		return {
			store,
			close: () => sqlite.close()
		};
	} catch (error) {
		sqlite.close();
		throw error;
	}
}
//#endregion
//#region ../../packages/connectors/common/scoped-portfolio-preferences.ts
var schema = z.object({
	manualAccountIds: z.array(z.string().min(1)),
	hiddenAccountIds: z.array(z.string().min(1)),
	revision: z.number().int().nonnegative()
}).strict();
var empty = () => ({
	manualAccountIds: [],
	hiddenAccountIds: [],
	revision: 0
});
var ScopedPortfolioPreferenceStore = class {
	store;
	partition;
	constructor(store, partition) {
		this.store = store;
		this.partition = partition;
	}
	async read(userKey) {
		const row = await this.store.read(this.partition, `portfolio:${userKey}`);
		return row ? schema.parse(row.value) : empty();
	}
	async addAccount(userKey, accountId) {
		return this.update(userKey, (value) => ({
			...value,
			manualAccountIds: [.../* @__PURE__ */ new Set([...value.manualAccountIds, accountId])].sort()
		}));
	}
	async setVisibility(userKey, accountId, visibility) {
		return this.update(userKey, (value) => ({
			...value,
			hiddenAccountIds: visibility === "hidden" ? [.../* @__PURE__ */ new Set([...value.hiddenAccountIds, accountId])].sort() : value.hiddenAccountIds.filter((id) => id !== accountId)
		}));
	}
	async update(userKey, change) {
		const key = `portfolio:${userKey}`;
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.store.read(this.partition, key);
			const current = row ? schema.parse(row.value) : empty();
			const value = change(current);
			value.revision = current.revision + 1;
			if (row ? await this.store.replace(this.partition, key, row.revision, value) : await this.store.insert(this.partition, key, value)) return value;
		}
		throw new Error("Portfolio preferences changed concurrently. Refresh before retrying.");
	}
};
//#endregion
//#region ../../packages/connectors/teams/context-authority.ts
var collaborationPolicySchema = z.object({
	contractVersion: z.literal("1.0"),
	revision: z.string().min(1).max(100),
	expiresAt: z.iso.datetime(),
	contexts: z.array(z.object({
		kind: z.enum([
			"channel",
			"chat",
			"meeting"
		]),
		contextId: z.string().min(1).max(500),
		teamId: z.string().min(1).max(200).optional(),
		eligibleFteIds: z.array(z.string().min(1)).min(1).max(500),
		configurerIds: z.array(z.string().min(1)).max(500),
		publisherIds: z.array(z.string().min(1)).max(500)
	}).strict()).max(100)
}).strict();
var membersSchema = z.object({
	value: z.array(z.object({
		userId: z.string().optional(),
		tenantId: z.string().optional()
	})),
	"@odata.nextLink": z.url().optional()
});
var GraphContextAuthority = class {
	getMetadataToken;
	fetcher;
	policy;
	constructor(policy, getMetadataToken, fetcher = fetch) {
		this.getMetadataToken = getMetadataToken;
		this.fetcher = fetcher;
		this.policy = collaborationPolicySchema.parse(policy);
	}
	async verify(principal, context) {
		if (Date.parse(this.policy.expiresAt) <= Date.now()) throw new Error("The approved disclosure policy expired.");
		const policy = this.policy.contexts.find((entry) => entry.kind === context.kind && entry.contextId === context.contextId);
		if (!policy) throw new Error("No approved policy exists for this collaboration context.");
		if (policy.kind === "channel" && !policy.teamId) throw new Error("The channel policy has no verified team identity.");
		const expectedPath = `/v1.0${policy.kind === "channel" ? `/teams/${encodeURIComponent(policy.teamId)}/channels/${encodeURIComponent(policy.contextId)}/allMembers` : `/chats/${encodeURIComponent(policy.contextId)}/members`}`;
		let next = `https://graph.microsoft.com${expectedPath}`;
		const members = [];
		let pages = 0;
		while (next) {
			if (++pages > 20) throw new Error("The context membership request budget was exhausted.");
			const url = new URL(next);
			if (url.origin !== "https://graph.microsoft.com" || url.pathname !== expectedPath || url.username || url.password || url.hash) throw new Error("The context membership continuation is not trusted.");
			const token = await this.getMetadataToken();
			if (!token) throw new Error("Resource-specific context authorization is unavailable.");
			const response = await this.fetcher(url, {
				redirect: "error",
				signal: AbortSignal.timeout(3e4),
				headers: {
					authorization: `Bearer ${token}`,
					accept: "application/json"
				}
			});
			if (!response.ok) throw new Error("Current context membership could not be verified.");
			const page = membersSchema.parse(JSON.parse(await readBoundedText(response, 512e3)));
			members.push(...page.value);
			if (members.length > 500) throw new Error("The context membership limit was exceeded.");
			next = page["@odata.nextLink"];
		}
		if (!members.some((member) => member.userId === principal.userId && member.tenantId === principal.tenantId)) throw new Error("The caller is not a verified context member.");
		return {
			revision: this.policy.revision,
			canConfigure: policy.configurerIds.includes(principal.userId),
			canPublish: policy.publisherIds.includes(principal.userId),
			audienceEligible: policy.kind !== "meeting" && members.length > 0 && members.every((member) => member.tenantId === principal.tenantId && member.userId !== void 0 && policy.eligibleFteIds.includes(member.userId))
		};
	}
};
//#endregion
//#region ../../packages/agents/meeting-signal-extractor/src/index.ts
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
	if (/\b(not known|unknown|to be determined|tbd)\b/i.test(text)) return "Not known";
	return null;
}
function matchProcess(text) {
	if (/\b(committee|steering (group|committee)|board (approv|decid))/i.test(text)) return "Committee";
	if (/\b(sole decision|single decision[- ]maker|i will decide|i decide)\b/i.test(text)) return "Individual";
	return null;
}
function matchNeed(text) {
	if (/\bmust[- ]have\b|\bcritical\b|\bessential\b|\bnon-negotiable\b/i.test(text)) return "Must have";
	if (/\bshould[- ]have\b/i.test(text)) return "Should have";
	if (/\b(good to have|nice to have)\b/i.test(text)) return "Good to have";
	if (/\b(no need|not needed|not a requirement)\b/i.test(text)) return "No need";
	return null;
}
function matchSentiment(text) {
	if (/\b(excited|thrilled|love it|great fit|strong fit|very positive|enthusiastic|eager to proceed|ready to move forward)\b/i.test(text)) return "Hot";
	if (/\b(cautiously optimistic|positive but|interested|promising|leaning positive)\b/i.test(text)) return "Warm";
	if (/\b(concerned|worried|frustrated|hesitant|skeptical|not convinced)\b/i.test(text)) return "Cold";
	return null;
}
function matchDecisionMaker(text) {
	return /\b(decision[- ]maker (?:is|identified)|final decision[- ]maker|has final approval|makes? the final (?:call|decision)|owns? the final decision)\b/i.test(text);
}
function matchCustomerNeed(text) {
	return text.match(/\b(?:customer|business) need\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)?.[1]?.trim() || null;
}
function matchProposedSolution(text) {
	return text.match(/\b(?:proposed|recommended) solution\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)?.[1]?.trim() || null;
}
function normalizedDate(year, month, day) {
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	return date.toISOString().slice(0, 10);
}
function matchFinalDecisionDate(text) {
	if (!/\b(final decision|decision date|decide by|decision by)\b/i.test(text)) return null;
	const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (iso?.[1] && iso[2] && iso[3]) return normalizedDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
	if (numeric?.[1] && numeric[2] && numeric[3]) return normalizedDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
	const monthNames = {
		january: 1,
		february: 2,
		march: 3,
		april: 4,
		may: 5,
		june: 6,
		july: 7,
		august: 8,
		september: 9,
		october: 10,
		november: 11,
		december: 12
	};
	const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
	if (!named?.[1] || !named[2] || !named[3]) return null;
	const month = monthNames[named[1].toLowerCase()];
	return month ? normalizedDate(Number(named[3]), month, Number(named[2])) : null;
}
function matchMilestoneRisk(text) {
	return text.match(/\brisk\s*(?:is|:|-)\s*(.+?)(?:[.!?]|$)/i)?.[1]?.trim() || null;
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
				if (/\b(approved|sign(?:ed)?[- ]?off|commit|secured|allocated)\b/i.test(text)) candidates.push({
					canonical: "budgetStatus",
					after: "Yes",
					confidence: .8,
					evidence: [seg.segmentId],
					rationale: "Customer confirmed budget is approved."
				});
			}
		}
		if (/\b(estimated|expected|projected)\s+(deal|opportunity|contract)?\s*value\b|\bdeal value\b/i.test(text)) {
			const amount = parseMoney(text);
			if (amount !== null) candidates.push({
				canonical: "estimatedValue",
				after: amount,
				confidence: .92,
				evidence: [seg.segmentId],
				rationale: `Meeting participants estimated the opportunity value at ${formatMoney(amount)}.`
			});
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
		if (matchDecisionMaker(text)) candidates.push({
			canonical: "decisionMaker",
			after: true,
			confidence: .8,
			evidence: [seg.segmentId],
			rationale: "The meeting identified who owns the final decision."
		});
		const need = matchNeed(text);
		if (need) candidates.push({
			canonical: "need",
			after: need,
			confidence: .72,
			evidence: [seg.segmentId],
			rationale: `Customer framed the need as "${need}".`
		});
		if (!internal) {
			const customerNeed = matchCustomerNeed(text);
			if (customerNeed) candidates.push({
				canonical: "customerNeed",
				after: customerNeed,
				confidence: .78,
				evidence: [seg.segmentId],
				rationale: "Customer stated the business need in the meeting."
			});
			const proposedSolution = matchProposedSolution(text);
			if (proposedSolution) candidates.push({
				canonical: "proposedSolution",
				after: proposedSolution,
				confidence: .78,
				evidence: [seg.segmentId],
				rationale: "Meeting participants described the proposed solution."
			});
		}
		const finalDecisionDate = matchFinalDecisionDate(text);
		if (finalDecisionDate) candidates.push({
			canonical: "finalDecisionDate",
			after: finalDecisionDate,
			confidence: .86,
			evidence: [seg.segmentId],
			rationale: `Customer stated a final decision date of ${finalDecisionDate}.`
		});
		const sentiment = matchSentiment(text);
		if (sentiment) candidates.push({
			canonical: "opportunityRating",
			after: sentiment,
			confidence: .45,
			evidence: [seg.segmentId],
			rationale: `Tone suggests a "${sentiment}" sentiment.`
		});
		const referencedMilestone = ctx.milestones.find((milestone) => text.toLowerCase().includes(milestone.name.toLowerCase()));
		if (referencedMilestone && /\b(committed|commitment confirmed|confirmed commitment)\b/i.test(text)) candidates.push({
			canonical: "milestoneCommitment",
			targetRecordId: referencedMilestone.id,
			after: "Committed",
			confidence: .83,
			evidence: [seg.segmentId],
			rationale: `Commitment was confirmed for milestone "${referencedMilestone.name}".`
		});
		if (internal && referencedMilestone) {
			const risk = matchMilestoneRisk(text);
			if (risk) candidates.push({
				canonical: "milestoneRisk",
				targetRecordId: referencedMilestone.id,
				after: risk,
				confidence: .74,
				evidence: [seg.segmentId],
				rationale: `Internal risk recorded for milestone "${referencedMilestone.name}".`
			});
		}
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
//#region ../../packages/connectors/local-store/schema.ts
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
  visibility  TEXT NOT NULL DEFAULT 'visible',
  default_price_level_id TEXT REFERENCES price_level(id),
  default_currency_id TEXT REFERENCES transaction_currency(id)
);

CREATE TABLE price_level (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE transaction_currency (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  iso_code TEXT NOT NULL
);

CREATE TABLE workload (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
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
  price_level_id           TEXT REFERENCES price_level(id),
  transaction_currency_id TEXT REFERENCES transaction_currency(id),
  opportunity_intent_codes TEXT,
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
  milestone_category INTEGER,
  workload_id       TEXT REFERENCES workload(id),
  parent_account_id TEXT REFERENCES account(id),
  transaction_currency_id TEXT REFERENCES transaction_currency(id),
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

CREATE TABLE creation_batch (
  batch_id          TEXT PRIMARY KEY,
  digest            TEXT NOT NULL,
  account_id        TEXT NOT NULL REFERENCES account(id),
  created_by        TEXT NOT NULL REFERENCES systemuser(id),
  result_json       TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE creation_batch_item (
  batch_id          TEXT NOT NULL REFERENCES creation_batch(batch_id),
  client_key        TEXT NOT NULL,
  kind              TEXT NOT NULL,
  ordinal           INTEGER NOT NULL,
  record_id         TEXT,
  parent_record_id  TEXT,
  PRIMARY KEY (batch_id, kind, client_key)
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
//#region ../../packages/common/fixtures/sample-discovery.ts
var sampleDiscoveryMetadataByOpportunityId = Object.freeze({
	"opp-grid-modernization": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-cloud-security-readiness": {
		domain: "security",
		solutionArea: "Security",
		technicalCapability: "Threat Protection"
	},
	"opp-data-estate-consolidation": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-resilient-cloud-foundation": {
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Well Architected"
	},
	"opp-ai-service": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure AI and ML"
	},
	"opp-store-modernization": {
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "IoT"
	},
	"opp-unified-commerce": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB"
	},
	"opp-customer-data-platform": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-zava-ai-platform": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure AI and ML"
	},
	"opp-zava-migration": {
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Windows & SQL Server Migration to Azure"
	},
	"opp-aw-commerce": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB"
	},
	"opp-ms-only-showcase": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-fourth-coffee-loyalty": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure AI and ML"
	},
	"opp-fourth-coffee-analytics": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-tailspin-ecommerce": {
		domain: "ai-apps",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB"
	},
	"opp-tailspin-forecasting": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-wwi-control-tower": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	},
	"opp-wwi-warehouse-edge": {
		domain: "infra",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Azure Stack Edge"
	},
	"opp-woodgrove-fraud-ai": {
		domain: "security",
		solutionArea: "Security",
		technicalCapability: "Fraud Protection"
	},
	"opp-woodgrove-regulatory-data": {
		domain: "data",
		solutionArea: "Cloud and AI Platforms",
		technicalCapability: "Cloud Scale Analytics"
	}
});
function samplePortfolioDiscoveryOpportunities(accounts, opportunities) {
	const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
	return opportunities.flatMap((opportunity) => {
		const metadata = sampleDiscoveryMetadataByOpportunityId[opportunity.id];
		const accountName = accountNames.get(opportunity.accountId);
		if (!metadata || !accountName) return [];
		return [{
			...opportunity,
			accountName,
			...metadata,
			onDealTeam: true
		}];
	});
}
//#endregion
//#region ../../packages/connectors/local-store/seed.ts
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
var OPPORTUNITY_INTENT = {
	60682e4: "Billed",
	606820001: "Consumption"
};
var MILESTONE_CATEGORY = {
	86198e4: "POC/Pilot",
	861980002: "Production",
	861980003: "Deal Registration",
	861980004: "Dual Credit",
	861980005: "Other Adjustments",
	861980006: "Partner Reported ACR",
	861980007: "Credit Offer",
	861980008: "Optimization",
	861980009: "Intent (MW, BA, Sec)",
	725300001: "ISV/ Marketplace"
};
var CUSTOMER_BUDGET_APPROVED = {
	60682e4: "Yes",
	606820001: "No"
};
var SOLUTION_AREA = {
	39438e4: "Cloud and AI Platforms",
	394380002: "AI Business Solutions",
	861980005: "Security",
	861980011: "Microsoft Services",
	861980012: "Windows and Devices",
	861980013: "Unknown"
};
var TECHNICAL_CAPABILITY = {
	861980002: "Azure AI and ML",
	861980034: "Commerce",
	861980063: "Cloud Security",
	861980077: "Cloud Scale Analytics",
	861980072: "Well Architected"
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
	},
	...additionalSampleAccounts.map((account) => ({
		id: account.id,
		name: account.name,
		segment: account.segment ?? null,
		tpid: account.tpid ?? null,
		visibility: "visible"
	}))
];
var seedPriceLevels = [{
	id: "price-list-usd-standard",
	name: "USD Standard Price List"
}];
var seedCurrencies = [{
	id: "currency-usd",
	name: "US Dollar",
	iso_code: "USD"
}];
var seedWorkloads = [
	{
		id: "workload-cloud-scale-analytics",
		name: "Cloud Scale Analytics"
	},
	{
		id: "workload-azure-ai-ml",
		name: "Azure AI and ML"
	},
	{
		id: "workload-commerce",
		name: "Commerce"
	},
	{
		id: "workload-cloud-security",
		name: "Cloud Security"
	},
	{
		id: "workload-well-architected",
		name: "Well Architected"
	}
];
var additionalOwnerNames = [...new Set([...additionalSampleOpportunities.map((opportunity) => opportunity.owner), ...additionalSampleMilestones.map((milestone) => milestone.owner)].filter((owner) => owner !== void 0))];
function additionalOwnerId(owner) {
	return `user-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
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
	},
	...additionalOwnerNames.map((owner) => ({
		id: additionalOwnerId(owner),
		fullname: owner,
		initials: owner.split(/\s+/).map((part) => part[0]).join("").toUpperCase(),
		email: null,
		alias: null
	}))
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
	},
	...additionalSampleOpportunities.map((opportunity) => ({
		id: opportunity.id,
		account_id: opportunity.accountId,
		name: opportunity.name,
		owner_id: opportunity.owner ? additionalOwnerId(opportunity.owner) : null,
		recorded_stage: opportunity.recordedStage,
		estimated_value: opportunity.value,
		currency: opportunity.currency,
		estimated_close_date: opportunity.closeDate
	}))
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
	},
	...additionalSampleMilestones.map((milestone) => ({
		id: milestone.id,
		opportunity_id: milestone.opportunityId,
		name: milestone.name,
		status: milestone.status === "Completed" ? 861980003 : milestone.status === "At Risk" ? 861980001 : milestone.status === "Blocked" ? 861980002 : 86198e4,
		milestone_date: milestone.targetDate ?? null,
		owner_id: milestone.owner ? additionalOwnerId(milestone.owner) : null,
		commitment: milestone.commitment === "Committed" ? COMMITTED : UNCOMMITTED$1,
		monthly_use: milestone.estimatedMonthlyUsage ?? null,
		risk_details: milestone.riskDetails ?? null,
		forecast_comments: milestone.comments ?? null,
		conversation: null,
		customer_budget_approved: null
	}))
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
	...Object.entries(OPPORTUNITY_INTENT).map(([code, label]) => ({
		option_set: "msp_opportunitytype",
		code: Number(code),
		label
	})),
	...Object.entries(MILESTONE_CATEGORY).map(([code, label]) => ({
		option_set: "msp_milestonecategory",
		code: Number(code),
		label
	})),
	...Object.entries(CUSTOMER_BUDGET_APPROVED).map(([code, label]) => ({
		option_set: "msp_customerbudgetapproved",
		code: Number(code),
		label
	})),
	...Object.entries(SOLUTION_AREA).map(([code, label]) => ({
		option_set: "msp_solutionarea",
		code: Number(code),
		label
	})),
	...Object.entries(TECHNICAL_CAPABILITY).map(([code, label]) => ({
		option_set: "msp_technicalcapability",
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
	...seedOpportunities.flatMap((opportunity) => {
		const id = String(opportunity["id"]);
		const metadata = sampleDiscoveryMetadataByOpportunityId[id];
		if (!metadata) return [];
		return [{
			id,
			account_id: String(opportunity["account_id"]),
			name: String(opportunity["name"]),
			recorded_stage: Number(opportunity["recorded_stage"]),
			value: Number(opportunity["estimated_value"]),
			currency: String(opportunity["currency"]),
			close_date: String(opportunity["estimated_close_date"]),
			domain: metadata.domain,
			solution_area: metadata.solutionArea,
			technical_capability: metadata.technicalCapability
		}];
	}),
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
/** Meetings / activities tied to opportunities (the meeting a transcript comes from). */
var seedActivities = [
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
];
var comprehensiveMeetingVariations = [
	{
		id: "tr-security-complete-01",
		title: "Security qualification transcript - executive review",
		source: "teams",
		occurredAt: "2026-09-16T15:00:00.000Z",
		customerSpeaker: "Priya Nair",
		internalSpeaker: "Girish Pillai",
		customerSegments: [
			"The approved budget is $1.1 million for this program.",
			"The estimated deal value is $2.4 million.",
			"Our steering committee decides this quarter, and the decision-maker identified is Priya Nair.",
			"This is a must-have. Customer need: reduce cloud security exposure across regulated workloads.",
			"Proposed solution: Microsoft Defender for Cloud with Microsoft Sentinel. Final decision date: 2027-01-15.",
			"We are excited and ready to move forward."
		],
		internalSegments: ["Internal note: AWS is competing for the security platform scope.", "The Security posture discovery milestone is committed. Risk: customer security architects have limited availability."]
	},
	{
		id: "tr-security-complete-02",
		title: "Security discovery meeting notes - committee path",
		source: "paste",
		occurredAt: "2026-09-17T15:00:00.000Z",
		customerSpeaker: "Daniel Reyes",
		internalSpeaker: "Avery Johnson",
		customerSegments: [
			"We secured a budget of 1.25 million dollars.",
			"The projected opportunity value is 2.6 million.",
			"The architecture committee makes the final decision next quarter; the final decision-maker is Daniel Reyes.",
			"The control uplift is critical. Business need: standardize threat detection across all business units.",
			"Recommended solution: Defender XDR integrated with Sentinel. We will make the final decision by 02/20/2027.",
			"The leadership team is very positive about the approach."
		],
		internalSegments: ["Internal note: Palo Alto remains the primary competitor.", "Commitment confirmed for Security posture discovery. Risk is that identity telemetry access may arrive late."]
	},
	{
		id: "tr-security-complete-03",
		title: "Cloud protection transcript - board checkpoint",
		source: "upload",
		occurredAt: "2026-09-18T15:00:00.000Z",
		customerSpeaker: "Morgan Chen",
		internalSpeaker: "Jordan Lee",
		customerSegments: [
			"The board approved the budget at $1,300,000.",
			"Our expected contract value is $2,750,000.",
			"Board approval is required this fiscal year, and Morgan Chen owns the final decision.",
			"This program is essential. Customer need: consolidate fragmented cloud security controls.",
			"Proposed solution is Defender for Cloud plus Sentinel analytics. Final decision date is March 5, 2027.",
			"The team is thrilled with the consolidated design."
		],
		internalSegments: ["Internal note: Google Cloud is positioning an alternative security stack.", "Security posture discovery has a confirmed commitment. Risk: procurement review could extend the schedule."]
	},
	{
		id: "tr-security-complete-04",
		title: "Threat protection meeting recap - rapid decision",
		source: "paste",
		occurredAt: "2026-09-19T15:00:00.000Z",
		customerSpeaker: "Alex Wilber",
		internalSpeaker: "Megan Bowen",
		customerSegments: [
			"Finance allocated a budget of 1400 thousand.",
			"The estimated opportunity value is 2.9 million.",
			"I will decide immediately; the decision-maker identified is Alex Wilber.",
			"The risk reduction is non-negotiable. Business need: protect privileged access in the cloud.",
			"Recommended solution is Microsoft Entra ID Protection with Defender XDR. Decision date: 2027-03-12.",
			"This feels like a strong fit for our security roadmap."
		],
		internalSegments: ["Internal note: Okta is not in scope, but IBM is competing on identity services.", "The Security posture discovery milestone is committed. Risk: the customer has not assigned a test tenant."]
	},
	{
		id: "tr-security-complete-05",
		title: "Security readiness transcript - sponsor alignment",
		source: "teams",
		occurredAt: "2026-09-20T15:00:00.000Z",
		customerSpeaker: "Sara Davis",
		internalSpeaker: "Avery Johnson",
		customerSegments: [
			"We have sign-off on a $1.5m budget.",
			"The projected deal value is $3.1 million.",
			"Our security steering group will decide right away, and Sara Davis has final approval.",
			"This is a should-have for the transformation. Customer need: automate investigation and response.",
			"Proposed solution: Sentinel automation with Defender XDR. Final decision date: 04/02/2027.",
			"We are cautiously optimistic and interested in proceeding."
		],
		internalSegments: ["Internal note: ServiceNow is competing for the workflow portion.", "Confirmed commitment for Security posture discovery. Risk is that the data retention policy is unresolved."]
	},
	{
		id: "tr-security-complete-06",
		title: "Cloud defense meeting notes - operating model",
		source: "paste",
		occurredAt: "2026-09-21T15:00:00.000Z",
		customerSpeaker: "Lee Gu",
		internalSpeaker: "Jordan Lee",
		customerSegments: [
			"We can commit a budget of 1.6 million.",
			"The estimated contract value is 3.25 million.",
			"A committee will decide this quarter; the final decision-maker is Lee Gu.",
			"The operating model is a must-have. Business need: give the SOC one cross-cloud incident view.",
			"Recommended solution: Microsoft Sentinel with Defender for Cloud Apps. The final decision is May 14, 2027.",
			"The security operations team is enthusiastic about the plan."
		],
		internalSegments: ["Internal note: Oracle is competing through the incumbent services agreement.", "Security posture discovery is now committed. Risk: the SOC staffing plan is still incomplete."]
	},
	{
		id: "tr-security-complete-07",
		title: "Cybersecurity transcript - investment review",
		source: "upload",
		occurredAt: "2026-09-22T15:00:00.000Z",
		customerSpeaker: "Nestor Wilke",
		internalSpeaker: "Girish Pillai",
		customerSegments: [
			"The approved spend is $1,700,000 in this budget.",
			"The expected deal value is $3.4 million.",
			"The investment committee decides next quarter, and the decision-maker identified is Nestor Wilke.",
			"This capability is critical. Customer need: improve ransomware detection and recovery readiness.",
			"Proposed solution is Microsoft Sentinel and Defender for Endpoint. Final decision date is 2027-06-18.",
			"Executives love it and are eager to proceed."
		],
		internalSegments: ["Internal note: AWS is competing with a cloud-native security proposal.", "Commitment confirmed for the Security posture discovery milestone. Risk: legal review of telemetry locations may delay approval."]
	},
	{
		id: "tr-security-complete-08",
		title: "Zero trust meeting recap - individual approval",
		source: "paste",
		occurredAt: "2026-09-23T15:00:00.000Z",
		customerSpeaker: "Miriam Graham",
		internalSpeaker: "Megan Bowen",
		customerSegments: [
			"Finance approved a budget of 1.8 million.",
			"The projected contract value is 3.6 million.",
			"It is a sole decision this year, and Miriam Graham makes the final call.",
			"Zero trust is essential. Customer need: enforce consistent conditional access for every workforce identity.",
			"Recommended solution: Microsoft Entra Suite with Defender XDR. Decision by 07/09/2027.",
			"The sponsor sees a great fit and is ready to move forward."
		],
		internalSegments: ["Internal note: Palo Alto is competing on the network security workstream.", "The Security posture discovery milestone is committed. Risk: device inventory quality may slow policy rollout."]
	},
	{
		id: "tr-security-complete-09",
		title: "Security platform transcript - urgent response",
		source: "teams",
		occurredAt: "2026-09-24T15:00:00.000Z",
		customerSpeaker: "Isaac Levin",
		internalSpeaker: "Avery Johnson",
		customerSegments: [
			"We have secured the $1.9 million budget.",
			"The estimated opportunity value is $3.8 million.",
			"The steering committee must decide ASAP, and Isaac Levin owns the final decision.",
			"The response capability is non-negotiable. Business need: shorten incident containment from days to hours.",
			"Proposed solution: Microsoft Sentinel automation and Defender Experts. Final decision date: August 13, 2027.",
			"The response leaders are excited by the design."
		],
		internalSegments: ["Internal note: Google Cloud is competing with its security operations tooling.", "Security posture discovery has a confirmed commitment. Risk is that incident data classification is unfinished."]
	},
	{
		id: "tr-security-complete-10",
		title: "SOC modernization meeting notes - governance review",
		source: "paste",
		occurredAt: "2026-09-25T15:00:00.000Z",
		customerSpeaker: "Emily Braun",
		internalSpeaker: "Jordan Lee",
		customerSegments: [
			"The committee approved a 2 million budget.",
			"The expected opportunity value is 4.05 million.",
			"The governance committee decides this quarter; the decision-maker identified is Emily Braun.",
			"This is a good to have for the first wave. Customer need: centralize SOC reporting and case management.",
			"Recommended solution is Microsoft Sentinel with unified security operations. Final decision date is 2027-09-17.",
			"The team says the proposal is promising and is leaning positive."
		],
		internalSegments: ["Internal note: ServiceNow is competing for security case management.", "Confirmed commitment for Security posture discovery. Risk: governance ownership remains split across two teams."]
	},
	{
		id: "tr-security-complete-11",
		title: "Cloud compliance transcript - funding confirmation",
		source: "upload",
		occurredAt: "2026-09-26T15:00:00.000Z",
		customerSpeaker: "Adele Vance",
		internalSpeaker: "Girish Pillai",
		customerSegments: [
			"Leadership signed off on the $2.1m budget.",
			"The projected deal value is $4.2 million.",
			"The compliance board decides next quarter, and Adele Vance has final approval.",
			"Continuous compliance is a nice to have. Business need: automate evidence collection for cloud audits.",
			"Proposed solution is Defender for Cloud regulatory compliance. We will decide by 10/08/2027.",
			"Stakeholders are interested and cautiously optimistic."
		],
		internalSegments: ["Internal note: IBM is competing through its compliance consulting team.", "The Security posture discovery milestone is now committed. Risk: control mappings need customer validation."]
	},
	{
		id: "tr-security-complete-12",
		title: "Identity security meeting recap - final sponsor review",
		source: "teams",
		occurredAt: "2026-09-27T15:00:00.000Z",
		customerSpeaker: "Grady Archie",
		internalSpeaker: "Megan Bowen",
		customerSegments: [
			"Finance allocated a budget of 2200 thousand.",
			"The estimated contract value is 4.4 million.",
			"I will decide immediately, and the final decision-maker is Grady Archie.",
			"There is no need for a separate appliance. Customer need: reduce identity attack paths without new hardware.",
			"Recommended solution: Microsoft Entra ID Protection and Defender for Identity. Final decision date: November 19, 2027.",
			"The sponsor is thrilled and eager to proceed."
		],
		internalSegments: ["Internal note: Oracle is competing through the existing identity platform.", "Commitment confirmed for the Security posture discovery milestone. Risk is that legacy directory cleanup may miss the target date."]
	}
];
/** Seeded meeting transcripts linked to activities, with diarized segments as evidence units. */
var seedTranscripts = [
	{
		id: "tr-grid-customer",
		opportunity_id: "opp-grid-modernization",
		activity_id: "act-grid-review",
		meeting_type: "customer",
		title: "Executive architecture review",
		source: "teams",
		occurred_at: "2026-10-12T15:00:00.000Z"
	},
	{
		id: "tr-cloud-security",
		opportunity_id: "opp-cloud-security-readiness",
		activity_id: "act-cs-discovery",
		meeting_type: "customer",
		title: "Cloud security discovery call",
		source: "teams",
		occurred_at: "2026-09-15T15:00:00.000Z"
	},
	...comprehensiveMeetingVariations.map((variation) => ({
		id: variation.id,
		opportunity_id: "opp-cloud-security-readiness",
		activity_id: "act-cs-discovery",
		meeting_type: "customer",
		title: variation.title,
		source: variation.source,
		occurred_at: variation.occurredAt
	}))
];
var seedTranscriptSegments = [
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
	},
	...comprehensiveMeetingVariations.flatMap((variation) => [...variation.customerSegments.map((text, index) => ({
		id: `seg-${variation.id.slice(3)}-customer-${index + 1}`,
		transcript_id: variation.id,
		start_ms: index * 3e4,
		end_ms: index * 3e4 + 25e3,
		speaker: variation.customerSpeaker,
		speaker_role: "customer",
		text
	})), ...variation.internalSegments.map((text, index) => ({
		id: `seg-${variation.id.slice(3)}-internal-${index + 1}`,
		transcript_id: variation.id,
		start_ms: (variation.customerSegments.length + index) * 3e4,
		end_ms: (variation.customerSegments.length + index) * 3e4 + 25e3,
		speaker: variation.internalSpeaker,
		speaker_role: "internal",
		text
	}))])
];
var defaultSeed = {
	accounts: seedAccounts.map((row) => ({
		...row,
		default_price_level_id: "price-list-usd-standard",
		default_currency_id: "currency-usd"
	})),
	priceLevels: seedPriceLevels,
	currencies: seedCurrencies,
	workloads: seedWorkloads,
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
	activities: seedActivities,
	transcripts: seedTranscripts,
	transcriptSegments: seedTranscriptSegments
};
//#endregion
//#region ../../packages/connectors/local-store/migrations.ts
var migrateLocalStoreV1 = `
CREATE TABLE IF NOT EXISTS price_level (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_currency (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iso_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workload (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
ALTER TABLE account ADD COLUMN default_price_level_id TEXT REFERENCES price_level(id);
ALTER TABLE account ADD COLUMN default_currency_id TEXT REFERENCES transaction_currency(id);
ALTER TABLE opportunity ADD COLUMN price_level_id TEXT REFERENCES price_level(id);
ALTER TABLE opportunity ADD COLUMN transaction_currency_id TEXT REFERENCES transaction_currency(id);
ALTER TABLE opportunity ADD COLUMN opportunity_intent_codes TEXT;
ALTER TABLE engagement_milestone ADD COLUMN milestone_category INTEGER;
ALTER TABLE engagement_milestone ADD COLUMN workload_id TEXT REFERENCES workload(id);
ALTER TABLE engagement_milestone ADD COLUMN parent_account_id TEXT REFERENCES account(id);
ALTER TABLE engagement_milestone ADD COLUMN transaction_currency_id TEXT REFERENCES transaction_currency(id);
CREATE TABLE creation_batch (
  batch_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES account(id),
  created_by TEXT NOT NULL REFERENCES systemuser(id),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE creation_batch_item (
  batch_id TEXT NOT NULL REFERENCES creation_batch(batch_id),
  client_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  record_id TEXT,
  parent_record_id TEXT,
  PRIMARY KEY (batch_id, kind, client_key)
);
`;
//#endregion
//#region ../../packages/connectors/local-store/local-store.ts
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
		try {
			this.db.exec("PRAGMA foreign_keys = ON");
			const version = Number(this.db.prepare("PRAGMA user_version").get()?.["user_version"]);
			if (version > 1) throw new Error(`The SQLite test store has an unsupported newer schema (v${version}).`);
			if (!this.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'account'").get()) {
				this.db.exec("BEGIN IMMEDIATE");
				try {
					this.db.exec(LOCAL_STORE_SCHEMA);
					this.load(options.seed ?? defaultSeed);
					this.db.exec(`PRAGMA user_version = 1`);
					this.db.exec("COMMIT");
				} catch (error) {
					this.db.exec("ROLLBACK");
					throw error;
				}
			} else if (version === 0) {
				this.db.exec("BEGIN IMMEDIATE");
				try {
					this.db.exec(migrateLocalStoreV1);
					this.loadCreationReferences();
					this.db.exec(`PRAGMA user_version = 1`);
					this.db.exec("COMMIT");
				} catch (error) {
					this.db.exec("ROLLBACK");
					throw error;
				}
			}
		} catch (error) {
			this.db.close();
			throw error;
		}
	}
	load(seed) {
		const tables = [
			["price_level", seed.priceLevels],
			["transaction_currency", seed.currencies],
			["workload", seed.workloads],
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
	loadCreationReferences() {
		for (const [table, rows] of [
			["price_level", seedPriceLevels],
			["transaction_currency", seedCurrencies],
			["workload", seedWorkloads],
			["option_value", seedOptionValues]
		]) for (const row of rows) {
			const columns = Object.keys(row);
			this.db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((column) => row[column]));
		}
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
//#region ../../packages/connectors/local-store/record-creation.ts
function reference(row) {
	return {
		id: String(row["id"]),
		label: String(row["name"])
	};
}
function selectReference(value, fallback, choices, name) {
	const selected = value ?? fallback;
	const current = choices.find((item) => item.id === selected?.id);
	if (!current || current.label !== selected?.label) throw new Error(`${name} is unavailable or has changed.`);
	return current;
}
function selectChoice(value, choices, name) {
	const current = choices.find((item) => item.value === value.value);
	if (!current || current.label !== value.label) throw new Error(`${name} is unavailable or has changed.`);
	return current;
}
var LocalStoreRecordCreation = class {
	store;
	currentUserId;
	constructor(store, currentUserId) {
		this.store = store;
		this.currentUserId = currentUserId;
	}
	getCatalog(accountId) {
		const account = this.store.get("SELECT * FROM account WHERE id = ? AND visibility = ?", accountId, "visible");
		if (!account) throw new Error("The selected Account is unavailable or hidden.");
		const ownerRow = this.store.get("SELECT id, fullname AS name FROM systemuser WHERE id = ?", this.currentUserId);
		if (!ownerRow) throw new Error("The signed-in user is unavailable in the SQLite test store.");
		const priceLists = this.store.all("SELECT id, name FROM price_level ORDER BY name").map(reference);
		const currencies = this.store.all("SELECT id, name, iso_code FROM transaction_currency ORDER BY name").map((row) => ({
			...reference(row),
			isoCode: String(row["iso_code"])
		}));
		const workloads = this.store.all("SELECT id, name FROM workload ORDER BY name").map(reference);
		const owners = this.store.all("SELECT id, fullname AS name FROM systemuser ORDER BY fullname").map(reference);
		const options = this.store.all("SELECT option_set, code, label FROM option_value ORDER BY option_set, code");
		const choices = {
			intent: this.choiceValues(options, "msp_opportunitytype"),
			category: this.choiceValues(options, "msp_milestonecategory"),
			status: this.choiceValues(options, "msp_milestonestatus"),
			commitment: this.choiceValues(options, "msp_commitmentrecommendation"),
			customerBudgetApproved: this.choiceValues(options, "msp_customerbudgetapproved"),
			solutionArea: this.choiceValues(options, "msp_solutionarea"),
			technicalCapability: this.choiceValues(options, "msp_technicalcapability")
		};
		const defaultPriceList = priceLists.find((item) => item.id === account["default_price_level_id"]);
		const defaultCurrency = currencies.find((item) => item.id === account["default_currency_id"]);
		const opportunities = this.store.all(`SELECT o.id, o.name, o.currency, o.transaction_currency_id FROM opportunity o WHERE o.account_id = ? AND (
        EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
        OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
      ) ORDER BY o.name`, accountId, this.currentUserId, this.currentUserId).map((row) => {
			const matches = row["transaction_currency_id"] ? currencies.filter((item) => item.id === row["transaction_currency_id"]) : currencies.filter((item) => item.isoCode === row["currency"]);
			const currency = matches.length === 1 && matches[0]?.isoCode === row["currency"] ? matches[0] : void 0;
			return {
				...reference(row),
				...currency ? { currency } : {}
			};
		});
		const data = {
			account: {
				id: accountId,
				label: String(account["name"])
			},
			opportunities,
			priceLists,
			currencies,
			workloads,
			owners,
			defaults: {
				owner: {
					id: this.currentUserId,
					label: String(ownerRow["name"])
				},
				...defaultPriceList ? { priceList: defaultPriceList } : {},
				...defaultCurrency ? { currency: defaultCurrency } : {}
			},
			choices
		};
		const revision = createHash("sha256").update(JSON.stringify(data)).digest("hex");
		return recordCreationCatalogSchema.parse({
			contractVersion: "1.2",
			target: "sqlite",
			revision,
			...data,
			maxMutations: 50
		});
	}
	getReceipt(batchId, digest) {
		const saved = this.store.get("SELECT digest, created_by, result_json FROM creation_batch WHERE batch_id = ?", batchId);
		if (!saved) return void 0;
		if (saved["digest"] !== digest || saved["created_by"] !== this.currentUserId) throw new Error("This creation batch was already committed with different content or by another user.");
		return recordCreationResultSchema.parse(JSON.parse(String(saved["result_json"])));
	}
	async commit(input, batchId, digest) {
		const draft = recordCreationDraftSchema.parse(input);
		if (!batchId.trim() || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("A valid batch ID and preview digest are required.");
		this.store.exec("BEGIN IMMEDIATE");
		try {
			const receipt = this.getReceipt(batchId, digest);
			if (receipt) {
				this.store.exec("COMMIT");
				return receipt;
			}
			const catalog = this.getCatalog(draft.account.id);
			if (catalog.account.label !== draft.account.label) throw new Error("The selected Account has changed.");
			const opportunityCount = draft.kind === "opportunity-batch" ? draft.opportunities.length : 0;
			const milestoneCount = draft.kind === "opportunity-batch" ? draft.opportunities.reduce((count, bundle) => count + bundle.milestones.length, 0) : draft.milestones.length;
			if (opportunityCount * 2 + milestoneCount > catalog.maxMutations) throw new Error("The creation batch exceeds the allowed number of mutations.");
			const created = [];
			if (draft.kind === "opportunity-batch") for (const bundle of draft.opportunities) {
				const inputOpportunity = bundle.opportunity;
				const priceList = selectReference(inputOpportunity.priceList, catalog.defaults.priceList, catalog.priceLists, "Price List");
				const currency = selectReference(inputOpportunity.currency, catalog.defaults.currency, catalog.currencies, "Currency");
				const currencyIsoCode = catalog.currencies.find((item) => item.id === currency.id).isoCode;
				const owner = selectReference(inputOpportunity.owner, catalog.defaults.owner, catalog.owners, "Owner");
				const intent = inputOpportunity.intent.map((choice) => selectChoice(choice, catalog.choices.intent, "Opportunity Intent"));
				const solutionArea = inputOpportunity.solutionArea ? selectChoice(inputOpportunity.solutionArea, catalog.choices.solutionArea, "Solution Area") : void 0;
				const technicalCapability = inputOpportunity.technicalCapability ? selectChoice(inputOpportunity.technicalCapability, catalog.choices.technicalCapability, "Technical Capability") : void 0;
				const opportunityId = `opp-${randomUUID()}`;
				this.store.run(`INSERT INTO opportunity
              (id, account_id, name, owner_id, price_level_id, transaction_currency_id, opportunity_intent_codes,
               recorded_stage, estimated_value, currency, estimated_close_date, description, solution_area, technical_capability)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`, opportunityId, catalog.account.id, inputOpportunity.name, owner.id, priceList.id, currency.id, intent.map((choice) => choice.value).join(","), inputOpportunity.estimatedValue, currencyIsoCode, inputOpportunity.estimatedCloseDate, inputOpportunity.need ?? null, solutionArea?.label ?? null, technicalCapability?.label ?? null);
				created.push({
					kind: "opportunity",
					clientKey: inputOpportunity.clientOpportunityKey,
					recordId: opportunityId
				});
				this.store.run("INSERT INTO opportunity_dealteam (opportunity_id, systemuser_id) VALUES (?, ?)", opportunityId, this.currentUserId);
				created.push({
					kind: "deal-team",
					clientKey: inputOpportunity.clientOpportunityKey,
					parentRecordId: opportunityId
				});
				for (const milestone of bundle.milestones) created.push(this.insertMilestone(milestone, opportunityId, catalog, currency.id));
			}
			else {
				const parent = this.store.get(`SELECT o.id, o.name, o.account_id, o.currency, o.transaction_currency_id FROM opportunity o WHERE o.id = ? AND o.account_id = ? AND (
             EXISTS (SELECT 1 FROM opportunity_dealteam dt WHERE dt.opportunity_id = o.id AND dt.systemuser_id = ?)
             OR EXISTS (SELECT 1 FROM milestone_team_member mt WHERE mt.opportunity_id = o.id AND mt.systemuser_id = ?)
           )`, draft.opportunity.id, draft.account.id, this.currentUserId, this.currentUserId);
				if (!parent || parent["name"] !== draft.opportunity.label) throw new Error("The parent Opportunity is unavailable or does not belong to this Account.");
				const currency = catalog.opportunities.find((item) => item.id === draft.opportunity.id)?.currency;
				if (!currency || currency.isoCode !== parent["currency"] || parent["transaction_currency_id"] && currency.id !== parent["transaction_currency_id"]) throw new Error("The parent Opportunity currency is unavailable or has changed.");
				for (const milestone of draft.milestones) created.push(this.insertMilestone(milestone, draft.opportunity.id, catalog, currency.id));
			}
			const result = recordCreationResultSchema.parse({
				contractVersion: "1.2",
				batchId,
				target: "sqlite",
				state: "committed",
				created,
				audit: {
					correlationId: batchId,
					opportunityCount,
					milestoneCount,
					committedAt: (/* @__PURE__ */ new Date()).toISOString()
				},
				message: "All reviewed records were created in the SQLite sample store."
			});
			this.store.run("INSERT INTO creation_batch (batch_id, digest, account_id, created_by, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", batchId, digest, catalog.account.id, this.currentUserId, JSON.stringify(result), result.audit.committedAt);
			for (const [ordinal, item] of result.created.entries()) this.store.run("INSERT INTO creation_batch_item (batch_id, client_key, kind, ordinal, record_id, parent_record_id) VALUES (?, ?, ?, ?, ?, ?)", batchId, item.clientKey, item.kind, ordinal, item.recordId ?? null, item.parentRecordId ?? null);
			this.store.exec("COMMIT");
			return result;
		} catch (error) {
			this.store.exec("ROLLBACK");
			throw error;
		}
	}
	choiceValues(rows, optionSet) {
		return rows.filter((row) => row["option_set"] === optionSet).map((row) => ({
			value: Number(row["code"]),
			label: String(row["label"])
		}));
	}
	insertMilestone(milestone, opportunityId, catalog, currencyId) {
		const category = selectChoice(milestone.category, catalog.choices.category, "Milestone Category");
		const status = milestone.status ? selectChoice(milestone.status, catalog.choices.status, "Milestone Status") : catalog.choices.status.find((choice) => choice.value === 86198e4);
		if (!status) throw new Error("An On Track milestone status is unavailable in the SQLite catalog.");
		const commitment = milestone.commitment ? selectChoice(milestone.commitment, catalog.choices.commitment, "Customer Commitment") : void 0;
		const budget = milestone.customerBudgetApproved ? selectChoice(milestone.customerBudgetApproved, catalog.choices.customerBudgetApproved, "Customer Budget Approved") : void 0;
		const workload = selectReference(milestone.workload, void 0, catalog.workloads, "Workload");
		const owner = selectReference(milestone.owner, catalog.defaults.owner, catalog.owners, "Owner");
		const id = `ms-${randomUUID()}`;
		this.store.run(`INSERT INTO engagement_milestone
        (id, opportunity_id, name, status, milestone_date, owner_id, milestone_category, workload_id,
         parent_account_id, transaction_currency_id, commitment, monthly_use, risk_details,
         forecast_comments, customer_budget_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, opportunityId, milestone.name, status.value, milestone.milestoneDate, owner.id, category.value, workload.id, catalog.account.id, currencyId, commitment?.value ?? null, milestone.estimatedMonthlyUsage ?? null, milestone.riskDetails ?? null, milestone.comments ?? null, budget?.value ?? null);
		return {
			kind: "milestone",
			clientKey: milestone.clientMilestoneKey,
			recordId: id,
			parentRecordId: opportunityId
		};
	}
};
//#endregion
//#region ../../packages/connectors/local-store/index.ts
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
	createRecordCreationWriter() {
		return new LocalStoreRecordCreation(this.store, this.currentUserId);
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
		return accountSchema$1.parse({
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
		const intent = (str(row["opportunity_intent_codes"])?.split(",") ?? []).map((code) => str(this.store.get("SELECT label FROM option_value WHERE option_set = ? AND code = ?", "msp_opportunitytype", Number(code))?.["label"])).filter((value) => value !== void 0);
		return opportunitySchema.parse({
			id: String(row["id"]),
			accountId: String(row["account_id"]),
			name: String(row["name"]),
			recordedStage: num(row["recorded_stage"]) ?? 1,
			value: num(row["estimated_value"]) ?? 0,
			currency: str(row["currency"]) ?? "USD",
			closeDate: String(row["estimated_close_date"]),
			...intent.length ? { opportunityIntent: intent } : {},
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
//#endregion
//#region ../../packages/common/fixtures/sample-opportunity-intent.ts
var sampleIntents = [
	["Consumption"],
	["Billed"],
	["Billed", "Consumption"]
];
function withSampleOpportunityIntents(opportunities) {
	return opportunities.map((opportunity, index) => ({
		...opportunity,
		opportunityIntent: [...sampleIntents[index % sampleIntents.length]]
	}));
}
var accountRowSchema = z.object({
	accountid: z.guid(),
	name: z.string().trim().min(1),
	statecode: z.number().int().optional()
}).catchall(z.unknown());
var accountPageSchema = z.object({
	value: z.array(accountRowSchema),
	"@odata.nextLink": z.string().optional()
});
var searchEnvelopeSchema = z.object({ response: z.string() });
var searchResultsSchema = z.object({
	Error: z.null().optional(),
	Value: z.array(z.object({
		Id: z.guid(),
		EntityName: z.literal("account")
	})).max(25)
});
var searchStatusSchema = z.object({ value: z.object({
	status: z.string(),
	entitystatusresults: z.array(z.object({
		entitylogicalname: z.string(),
		entitystatus: z.string(),
		searchableindexedfieldinfomap: z.record(z.string(), z.unknown())
	}))
}) });
function searchPayload(input) {
	const envelope = searchEnvelopeSchema.safeParse(input);
	if (!envelope.success) throw new Error("MSX close-name search returned an invalid response envelope.");
	try {
		return JSON.parse(envelope.data.response);
	} catch (error) {
		throw new Error("MSX close-name search returned an invalid JSON response.", { cause: error });
	}
}
function parseAccountSearchPage(input) {
	const result = accountPageSchema.safeParse(input);
	if (!result.success) throw new Error("MSX account search returned an invalid account response.");
	return result.data;
}
function indexedAccountIds(input) {
	const result = searchResultsSchema.safeParse(searchPayload(input));
	if (!result.success) throw new Error("MSX close-name search returned an invalid or unsuccessful response.");
	return [...new Set(result.data.Value.map((row) => row.Id.toLowerCase()))];
}
function assertAccountNameIndex(input) {
	const result = searchStatusSchema.safeParse(searchPayload(input));
	const account = result.success ? result.data.value.entitystatusresults.find((row) => row.entitylogicalname === "account") : void 0;
	if (!result.success || result.data.value.status !== "provisioned" || account?.entitystatus !== "EntitySyncComplete" || !Object.hasOwn(account.searchableindexedfieldinfomap, "name")) throw new Error("MSX close-name search is unavailable. Account-name indexing must be enabled and synchronized; try a shorter exact name or TPID.");
}
function fuzzyAccountName(query) {
	const words = query.normalize("NFKC").replace(/['\u2019]s\b/gi, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	if (words.length === 0 || words.length > 16) throw new Error("Enter an account name containing letters or numbers and no more than 16 words.");
	return words.map((word) => word.length >= 4 ? `${word}~1` : word).join(" ");
}
//#endregion
//#region ../../packages/connectors/common/portfolio-preferences.ts
var preferencesSchema = z.object({
	manualAccountIds: z.array(z.string().min(1)),
	hiddenAccountIds: z.array(z.string().min(1)),
	revision: z.number().int().nonnegative()
}).strict();
z.record(z.string().min(1), preferencesSchema);
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
//#endregion
//#region ../../packages/connectors/common/milestone-membership.ts
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
//#region ../../packages/connectors/msx/live.ts
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
	cacheOptions;
	entityVersions = /* @__PURE__ */ new Map();
	expectedVersions = new AsyncLocalStorage();
	baseUrl;
	portfolioPromise;
	observationPromises = /* @__PURE__ */ new Map();
	milestonePromises = /* @__PURE__ */ new Map();
	currentUserIdPromise;
	dealTeamBindingsPromise;
	milestoneTeamTemplateIdPromise;
	accountTpidField;
	accountTpidMetadataPromise;
	accountNameIndexPromise;
	constructor(tokenProvider, fetchImplementation = fetch, baseUrl = defaultBaseUrl, performanceReporter, writeMetadata = {}, preferenceStore = new MemoryPortfolioPreferenceStore(), cacheOptions = {}) {
		this.tokenProvider = tokenProvider;
		this.fetchImplementation = fetchImplementation;
		this.performanceReporter = performanceReporter;
		this.writeMetadata = writeMetadata;
		this.preferenceStore = preferenceStore;
		this.cacheOptions = cacheOptions;
		this.baseUrl = new URL(baseUrl);
		if (writeMetadata.riskDetailsField && !/^[A-Za-z][A-Za-z0-9_]*$/.test(writeMetadata.riskDetailsField)) throw new Error("The MSX risk details logical field name is invalid.");
		if (writeMetadata.accountTpidField && !navigationPropertyPattern.test(writeMetadata.accountTpidField)) throw new Error("TLC_MSX_ACCOUNT_TPID_FIELD must be a valid Dataverse identifier.");
		this.accountTpidField = writeMetadata.accountTpidField;
	}
	async listAccounts(options = {}) {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.accounts.filter((account) => options.includeHidden || account.visibility !== "hidden"));
	}
	async getCatalog(accountId) {
		const account = (await this.listAccounts()).find((item) => item.id === accountId);
		if (!account) throw new Error("The selected Account is unavailable or hidden in MSX.");
		const userId = await this.getCurrentUserId();
		const [user, priceRows, currencyRows, workloadRows, opportunities, intent, category, status, commitment, customerBudgetApproved, solutionArea, technicalCapability] = await Promise.all([
			this.requestJson(`systemusers(${userId})?$select=fullname`),
			this.requestAll("pricelevels", {
				"$select": "pricelevelid,name",
				"$orderby": "name asc"
			}),
			this.requestAll("transactioncurrencies", {
				"$select": "transactioncurrencyid,currencyname,isocurrencycode",
				"$orderby": "currencyname asc"
			}),
			this.requestAll("msp_workloads", {
				"$select": "msp_workloadid,msp_name",
				"$orderby": "msp_name asc"
			}),
			this.listOpportunities(accountId),
			this.getCreationChoiceValues("opportunity", "msp_opportunitytype", "MultiSelectPicklistAttributeMetadata"),
			this.getCreationChoiceValues("msp_engagementmilestone", "msp_milestonecategory", "PicklistAttributeMetadata"),
			this.getCreationChoiceValues("msp_engagementmilestone", "msp_milestonestatus", "PicklistAttributeMetadata"),
			this.getCreationChoiceValues("msp_engagementmilestone", "msp_commitmentrecommendation", "PicklistAttributeMetadata"),
			this.getCreationChoiceValues("msp_engagementmilestone", "msp_customerbudgetapproved", "PicklistAttributeMetadata"),
			this.getCreationChoiceValues("opportunity", "msp_solutionarea", "PicklistAttributeMetadata"),
			this.getCreationChoiceValues("opportunity", "msp_technicalcapability", "PicklistAttributeMetadata")
		]);
		if (!user.fullname?.trim()) throw new Error("The current MSX user name is unavailable.");
		const data = {
			account: {
				id: account.id,
				label: account.name
			},
			opportunities: opportunities.map((item) => ({
				id: item.id,
				label: item.name
			})),
			priceLists: priceRows.map((row) => ({
				id: row.pricelevelid,
				label: row.name
			})),
			currencies: currencyRows.map((row) => ({
				id: row.transactioncurrencyid,
				label: row.currencyname,
				isoCode: row.isocurrencycode
			})),
			workloads: workloadRows.map((row) => ({
				id: row.msp_workloadid,
				label: row.msp_name
			})),
			owners: [{
				id: userId,
				label: user.fullname
			}],
			defaults: { owner: {
				id: userId,
				label: user.fullname
			} },
			choices: {
				intent,
				category,
				status,
				commitment,
				customerBudgetApproved,
				solutionArea,
				technicalCapability
			}
		};
		return recordCreationCatalogSchema.parse({
			contractVersion: "1.2",
			target: "draft",
			revision: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
			...data,
			maxMutations: 50
		});
	}
	async getCreationChoiceValues(entity, field, metadataType) {
		const path = `EntityDefinitions(LogicalName='${entity}')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.${metadataType}`;
		const url = new URL(path, this.baseUrl);
		url.searchParams.set("$expand", "OptionSet");
		const metadata = await this.requestJson(url);
		if (!metadata.OptionSet?.Options) throw new Error(`MSX choice metadata is unavailable for ${field}.`);
		return metadata.OptionSet.Options.map((option) => {
			const label = option.Label?.LocalizedLabels?.find((item) => item.LanguageCode === 1033)?.Label ?? option.Label?.UserLocalizedLabel?.Label;
			if (typeof option.Value !== "number" || !label?.trim()) throw new Error(`MSX choice metadata is incomplete for ${field}.`);
			return {
				value: option.Value,
				label: label.trim()
			};
		}).sort((left, right) => left.value - right.value);
	}
	async searchAccounts(input) {
		const request = accountSearchRequestSchema.parse(input);
		const escapedQuery = escapeODataStringLiteral(request.query);
		const tpidField = request.matchBy === "tpid" ? await this.resolveAccountTpidField() : this.accountTpidField;
		const select = [
			"accountid",
			"name",
			tpidField
		].filter(isPresent).join(",");
		const rows = await measurePerformance("msx.search-accounts", this.performanceReporter, () => request.matchBy === "name" ? this.searchAccountNames(request.query, select) : this.requestAccountCandidates(`statecode eq 0 and ${tpidField} eq '${escapedQuery}'`, select));
		if (rows.length === 0) return [];
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
	async requestAccountCandidates(filter, select) {
		const url = new URL("accounts", this.baseUrl);
		for (const [name, value] of Object.entries({
			"$select": select,
			"$filter": filter,
			"$orderby": "name asc",
			"$top": String(25)
		})) url.searchParams.set(name, value);
		const rows = [];
		let next = url;
		while (next && rows.length < 25) {
			const page = parseAccountSearchPage(await this.requestJson(next));
			rows.push(...page.value.slice(0, 25 - rows.length));
			next = page["@odata.nextLink"] ? new URL(page["@odata.nextLink"]) : void 0;
		}
		return rows;
	}
	async searchAccountNames(query, select) {
		const escaped = escapeODataStringLiteral(query);
		const exact = await this.requestAccountCandidates(`statecode eq 0 and name eq '${escaped}'`, select);
		if (exact.length > 0) return exact;
		const partial = await this.requestAccountCandidates(`statecode eq 0 and contains(name,'${escaped}')`, select);
		if (partial.length > 0) return partial;
		this.accountNameIndexPromise ??= this.requestJson("searchstatus()").then(assertAccountNameIndex).catch((error) => {
			this.accountNameIndexPromise = void 0;
			throw error;
		});
		await this.accountNameIndexPromise;
		const ids = indexedAccountIds(await this.postReturningEntity("searchquery", {
			search: fuzzyAccountName(query),
			entities: JSON.stringify([{
				name: "account",
				selectcolumns: ["name"],
				searchcolumns: ["name"],
				filter: "statecode eq 0"
			}]),
			top: 25,
			options: JSON.stringify({
				querytype: "lucene",
				searchmode: "all",
				besteffortsearchenabled: "false"
			})
		}, "search"));
		if (ids.length === 0) return [];
		return parseAccountSearchPage({ value: await this.requestByIds("accounts", "accountid", ids, `${select},statecode`) }).value.filter((row) => row.statecode === 0 && ids.includes(row.accountid.toLowerCase())).sort((left, right) => ids.indexOf(left.accountid.toLowerCase()) - ids.indexOf(right.accountid.toLowerCase()));
	}
	resolveAccountTpidField() {
		this.accountTpidMetadataPromise ??= this.verifyAccountTpidField().catch((error) => {
			this.accountTpidMetadataPromise = void 0;
			throw error;
		});
		return this.accountTpidMetadataPromise;
	}
	async verifyAccountTpidField() {
		const field = this.writeMetadata.accountTpidField ?? "msp_mstopparentid";
		const url = new URL(`EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${field}')`, this.baseUrl);
		url.searchParams.set("$select", "LogicalName,AttributeType,IsValidForRead");
		let metadata;
		try {
			metadata = await this.requestJson(url);
		} catch (error) {
			if (error instanceof MsxRequestError && error.status === 404) throw new Error("TPID lookup is unavailable. Set TLC_MSX_ACCOUNT_TPID_FIELD to the verified readable String field for this MSX environment.", { cause: error });
			throw error;
		}
		if (metadata.LogicalName !== field || metadata.AttributeType !== "String" || metadata.IsValidForRead !== true) throw new Error("The TPID field must be a verified readable String attribute. Check TLC_MSX_ACCOUNT_TPID_FIELD.");
		this.accountTpidField = field;
		return field;
	}
	async addAccount(accountId) {
		this.assertAccountId(accountId);
		const rows = await this.requestByIds("accounts", "accountid", [accountId], [
			"accountid",
			"name",
			this.accountTpidField
		].filter(isPresent).join(","));
		const row = rows[0];
		if (rows.length !== 1 || !row) throw new Error("The selected account is unavailable or inactive in MSX.");
		const preferences = await this.preferenceStore.addAccount(await this.getCurrentUserId(), accountId);
		const updated = this.getPortfolio().then((portfolio) => {
			const teamAccountIds = new Set(portfolio.accounts.filter((account) => account.provenance === "deal-team" || account.provenance === "both").map((account) => account.id));
			const account = this.mapAccount(row, preferences, teamAccountIds);
			return {
				...portfolio,
				accounts: [...portfolio.accounts.filter((item) => item.id !== accountId), account].sort((left, right) => left.name.localeCompare(right.name))
			};
		}).catch((error) => {
			this.portfolioPromise = void 0;
			throw error;
		});
		this.portfolioPromise = updated;
		const account = (await updated).accounts.find((candidate) => candidate.id === accountId);
		if (!account) throw new Error("The account preference was saved but the account could not be reloaded.");
		return structuredClone(account);
	}
	async setAccountVisibility(accountId, visibility) {
		this.assertAccountId(accountId);
		const row = (await this.requestByIds("accounts", "accountid", [accountId], [
			"accountid",
			"name",
			this.accountTpidField
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
				onDealTeam: portfolio.dealTeamOpportunityIds.has(row.opportunityid)
			};
		}).sort((left, right) => left.name.localeCompare(right.name));
	}
	/** Fetches open opportunities within the given assigned accounts, filtered by the domain clauses. */
	async requestOpportunitiesForAccounts(accountIds, domainClauses) {
		const select = "opportunityid,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description,msp_solutionarea,msp_technicalcapability,msp_conversation,msp_opportunitytype";
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
		const membershipQuery = {
			"$select": "msp_dealteamid",
			"$filter": `statecode eq 0 and ${dealTeam.userLookupField} eq ${userId} and ${dealTeam.opportunityLookupField} eq ${opportunityId}`,
			"$top": "2"
		};
		const existing = await this.requestAll(dealTeam.entitySet, membershipQuery);
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
		if ((await this.requestAll(dealTeam.entitySet, membershipQuery)).length > 0) throw new Error("MSX still reports you on this Deal Team after the delete request. Removal could not be confirmed. Refresh and try again.");
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
		this.entityVersions.clear();
	}
	async getConcurrencyTokens(opportunityId) {
		const milestones = await this.getMilestoneRows(opportunityId);
		const paths = [`opportunities(${opportunityId})`, ...milestones.map((row) => `msp_engagementmilestones(${row.msp_engagementmilestoneid})`)];
		const result = {};
		for (const path of paths) {
			const token = this.entityVersions.get(path.toLowerCase());
			if (token) result[path.toLowerCase()] = token;
		}
		return result;
	}
	withExpectedVersions(versions, operation) {
		return this.expectedVersions.run({ ...versions }, operation);
	}
	rememberNativeVersions(value) {
		const remember = (row) => {
			if (!isObjectRecord(row)) return;
			const records = [
				["opportunityid", "opportunities"],
				["msp_engagementmilestoneid", "msp_engagementmilestones"],
				["msp_dealteamid", this.writeMetadata.dealTeam?.entitySet ?? defaultDealTeamWriteMetadata.entitySet]
			];
			for (const [field, set] of records) {
				const id = row[field];
				if (typeof id !== "string" || !guidPattern.test(id)) continue;
				const path = `${set}(${id})`.toLowerCase();
				this.entityVersions.delete(path);
				if ("@odata.etag" in row && typeof row["@odata.etag"] === "string" && /^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(row["@odata.etag"])) this.entityVersions.set(path, row["@odata.etag"]);
			}
		};
		if (value && typeof value === "object" && "value" in value && Array.isArray(value.value)) value.value.forEach(remember);
		else remember(value);
	}
	/** Returns the signed-in user's Dataverse systemuser id (WhoAmI UserId), cached for reuse. */
	getCurrentUserId() {
		this.currentUserIdPromise ??= this.requestJson("WhoAmI").then((identity) => identity.UserId).catch((error) => {
			this.currentUserIdPromise = void 0;
			throw error;
		});
		return this.currentUserIdPromise;
	}
	async assertNativeIdentity(entraObjectId) {
		const userId = await this.getCurrentUserId();
		if (!guidPattern.test(entraObjectId) || !guidPattern.test(userId)) throw new Error("The native source identity mapping is invalid.");
		const user = await this.requestJson(`systemusers(${userId})?$select=azureactivedirectoryobjectid,isdisabled`);
		if (!isObjectRecord(user) || user["isdisabled"] !== false || typeof user["azureactivedirectoryobjectid"] !== "string" || user["azureactivedirectoryobjectid"].toLowerCase() !== entraObjectId.toLowerCase()) throw new Error("The native source identity is absent, disabled or belongs to another Entra subject.");
		return userId;
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
		if (this.cacheOptions.cachePortfolio === false) return this.loadPortfolio();
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
		const dealTeamOpportunityIds = new Set(dealTeamRows.map((row) => row._msp_parentopportunityid_value).filter(isPresent));
		const opportunityIds = unique([...dealTeamOpportunityIds, ...milestoneOpportunityIds]);
		const activeOpportunities = (await measurePerformance("msx.opportunities", this.performanceReporter, () => this.requestByIds("opportunities", "opportunityid", opportunityIds, "opportunityid,statecode,_parentaccountid_value,_ownerid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate,description,msp_opportunitytype"))).filter((row) => row._parentaccountid_value && (row.statecode === void 0 || row.statecode === 0));
		const dealTeamAccountIds = unique(activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent));
		const accountIds = unique([
			...dealTeamAccountIds,
			...preferences.manualAccountIds,
			...preferences.hiddenAccountIds
		]);
		const accounts = (await measurePerformance("msx.accounts", this.performanceReporter, () => this.requestByIds("accounts", "accountid", accountIds, [
			"accountid",
			"name",
			this.accountTpidField
		].filter(isPresent).join(",")))).map((row) => this.mapAccount(row, preferences, new Set(dealTeamAccountIds))).sort((left, right) => left.name.localeCompare(right.name));
		const visibleAccountIds = new Set(accounts.filter((account) => account.visibility !== "hidden").map((account) => account.id));
		return {
			accounts,
			opportunities: activeOpportunities.filter((row) => row._parentaccountid_value && visibleAccountIds.has(row._parentaccountid_value)).map((row) => this.mapOpportunity(row)).sort((left, right) => left.name.localeCompare(right.name)),
			dealTeamOpportunityIds
		};
	}
	mapAccount(row, preferences = {
		manualAccountIds: [],
		hiddenAccountIds: [],
		revision: 0
	}, dealTeamAccountIds = /* @__PURE__ */ new Set()) {
		const manual = preferences.manualAccountIds.includes(row.accountid);
		const dealTeam = dealTeamAccountIds.has(row.accountid);
		const tpidField = this.accountTpidField;
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
		const opportunityIntent = formattedValue(row, "msp_opportunitytype")?.split(";").map((value) => value.trim()).filter(Boolean);
		return {
			id: row.opportunityid,
			accountId: row._parentaccountid_value,
			name: row.name,
			...formattedValue(row, "_ownerid_value") ? { owner: formattedValue(row, "_ownerid_value") } : {},
			...opportunityIntent?.length ? { opportunityIntent } : {},
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
		const result = await response.json();
		if (this.cacheOptions.requireConditionalWrites) this.rememberNativeVersions(result);
		return result;
	}
	async patch(path, body) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const expected = this.expectedVersions.getStore();
		const version = this.cacheOptions.requireConditionalWrites ? expected?.[path.toLowerCase()] : "*";
		if (!version || this.cacheOptions.requireConditionalWrites && !/^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(version)) throw new Error("A reviewed native concurrency token is required before this update.");
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"Content-Type": "application/json",
				"If-Match": version
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new MsxRequestError(`MSX update failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status);
		if (this.cacheOptions.requireConditionalWrites && expected) {
			const next = response.headers.get("etag");
			if (next && /^(?:W\/)?"[A-Za-z0-9-]{1,100}"$/.test(next)) expected[path.toLowerCase()] = next;
			else delete expected[path.toLowerCase()];
		}
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
		if (!response.ok) throw new MsxRequestError(`MSX create failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status);
	}
	/** searchquery is a read-only POST action; other callers create records. */
	async postReturningEntity(path, body, operation = "create") {
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
		if (!response.ok) {
			const detail = operation === "search" ? "" : await serviceErrorDetail(response);
			throw new MsxRequestError(`MSX ${operation} failed with status ${response.status}${detail}.`, response.status);
		}
		return await response.json();
	}
	async delete(path) {
		const url = new URL(path, this.baseUrl);
		this.assertTrustedUrl(url);
		const version = this.cacheOptions.requireConditionalWrites ? this.entityVersions.get(path.toLowerCase()) : "*";
		if (!version) throw new Error("A verified native membership concurrency token is required before removal.");
		const accessToken = await this.tokenProvider.getAccessToken();
		const response = await this.fetchImplementation(url, {
			method: "DELETE",
			headers: {
				Authorization: ["Bearer", accessToken].join(" "),
				Accept: "application/json",
				"If-Match": version
			}
		});
		if (!response.ok) throw new MsxRequestError(`MSX delete failed with status ${response.status}${await serviceErrorDetail(response)}.`, response.status);
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
function isObjectRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function formattedValue(row, field) {
	const value = row[`${field}${formattedValueSuffix}`];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
/** Dataverse's own error text so a bare status code is actionable; never includes request data. A missing-privilege denial is summarized without the principal's internal identifiers. */
async function serviceErrorDetail(response) {
	try {
		const body = await response.json();
		const text = (typeof body?.error?.message === "string" ? body.error.message : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
		const privilege = /\bis missing (prv[A-Za-z0-9_]{1,80})/.exec(text)?.[1];
		if (privilege) return ` (your MSX security role is missing the ${privilege} privilege; ask an MSX administrator to grant it or to make this change for you)`;
		const summary = text.replace(/\.$/, "").slice(0, 300);
		return summary ? ` (MSX said: ${summary})` : "";
	} catch {
		return "";
	}
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
//#region ../../packages/connectors/msx/live-meeting.ts
var MAX_COMMENTS = 3e4;
function prepend(existing, entry) {
	const combined = existing && existing.trim().length > 0 ? `${entry}\n\n${existing}` : entry;
	return combined.length > MAX_COMMENTS ? combined.slice(0, MAX_COMMENTS) : combined;
}
function datePrefix(when) {
	return `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`;
}
/**
* Live-MSX meeting capture. Builds the extractor snapshot from live opportunity + milestone
* reads, runs the (deterministic or Foundry) extractor, and injects back into MSX all-or-none:
*  - milestone signals (commitment / risk) are written to the real milestone columns;
*  - opportunity-field signals and recommended new milestones are captured into an additive,
*    dated meeting note appended to the opportunity comments, because the live connector cannot
*    write discrete qualification columns (budget/timeline/etc.).
* MSX has no cross-entity transaction, so apply uses validate-all -> apply -> compensate.
*/
var LiveMeetingCaptureConnector = class {
	msx;
	now;
	constructor(msx, now = () => /* @__PURE__ */ new Date()) {
		this.msx = msx;
		this.now = now;
	}
	/** Graph-based transcript discovery is a later step; the live path uses paste/upload today. */
	async listMeetingTranscripts() {
		return [];
	}
	async getMeetingTranscript() {}
	buildOpportunitySnapshot(name, id, value, comments) {
		return {
			id,
			name,
			fields: {
				estimatedValue: value ?? null,
				qualificationComments: comments ?? null,
				budgetAmount: null,
				budgetStatus: null,
				timeline: null,
				purchaseProcess: null,
				decisionMaker: null,
				need: null,
				customerNeed: null,
				proposedSolution: null,
				finalDecisionDate: null,
				identifyCompetitors: null,
				opportunityRating: null
			}
		};
	}
	buildMilestoneSnapshot(milestone) {
		return {
			id: milestone.id,
			name: milestone.name,
			fields: {
				milestoneCommitment: milestone.commitment ?? null,
				milestoneRisk: milestone.riskDetails ?? null
			}
		};
	}
	async proposeMeetingChangeSet(request, extractor) {
		if (!request.transcript) throw new Error("Live meeting capture needs a pasted or uploaded transcript (Graph acquisition is not wired yet).");
		const transcript = meetingTranscriptSchema.parse(request.transcript);
		const context = await this.msx.getOpportunityContext(request.opportunityId);
		const milestones = await this.msx.listMilestones(request.opportunityId);
		const opportunity = this.buildOpportunitySnapshot(context.opportunity.name, context.opportunity.id, context.opportunity.value, context.opportunity.comments);
		const anchored = {
			...transcript,
			opportunityId: request.opportunityId
		};
		const changeSetId = request.changeSetId ?? `cs-${request.opportunityId}-${this.now().getTime().toString(36)}`;
		return (extractor ?? ((ctx, options) => extractMeetingSignals(ctx, options)))({
			transcript: anchored,
			opportunity,
			milestones: milestones.map((milestone) => this.buildMilestoneSnapshot(milestone))
		}, { changeSetId });
	}
	composeMeetingNote(proposal, oppSlots, approvedNewMilestones, reason) {
		const lines = [`MEETING CAPTURE (${proposal.meetingType}) ${datePrefix(this.now())} — ${reason}`];
		if (oppSlots.length > 0) {
			lines.push("Signals:");
			for (const slot of oppSlots) lines.push(`- ${slot.label}: ${slot.displayAfter} [${slot.mcemCriterion}]`);
		}
		if (approvedNewMilestones.length > 0) {
			lines.push("Recommended next steps:");
			for (const name of approvedNewMilestones) lines.push(`- ${name}`);
		}
		return lines.join("\n");
	}
	async applyMeetingChangeSet(input) {
		const proposal = meetingChangeSetProposalSchema.parse(input.proposal);
		const approval = meetingChangeSetApprovalSchema.parse(input.approval);
		if (approval.changeSetId !== proposal.changeSetId) throw new Error("Approval does not match the proposal.");
		if (approval.opportunityId !== proposal.opportunityId) throw new Error("Approval targets a different opportunity.");
		const approvedSlots = proposal.slots.filter((slot) => approval.approvedSlotIds.includes(slot.slotId));
		const oppSlots = approvedSlots.filter((slot) => slot.targetKind === "opportunity");
		const milestoneSlots = approvedSlots.filter((slot) => slot.targetKind === "milestone" && slot.targetRecordId && approval.selectedMilestoneIds.includes(slot.targetRecordId));
		const approvedNewMilestoneNames = proposal.newMilestones.filter((milestone) => approval.approvedNewMilestoneTempIds.includes(milestone.tempId)).map((milestone) => milestone.name);
		const current = await this.msx.listMilestones(proposal.opportunityId);
		const currentById = new Map(current.map((milestone) => [milestone.id, milestone]));
		const conflicts = /* @__PURE__ */ new Set();
		for (const slot of milestoneSlots) {
			const entry = MEETING_FIELD_DICTIONARY[slot.targetField];
			if (!entry || entry.append) continue;
			const milestone = currentById.get(slot.targetRecordId);
			const liveValue = slot.targetField === "milestoneCommitment" ? milestone?.commitment ?? null : milestone?.riskDetails ?? null;
			if ((slot.before === null || slot.before === void 0 ? "" : String(slot.before).trim()) !== String(liveValue ?? "").trim()) conflicts.add(slot.slotId);
		}
		if (conflicts.size > 0) return meetingChangeSetResultSchema.parse({
			changeSetId: proposal.changeSetId,
			state: "rolled-back",
			items: this.buildResultItems(proposal, approval, {
				applied: /* @__PURE__ */ new Set(),
				conflicts,
				appliedNewMilestones: false
			}),
			auditNote: `Rolled back: ${conflicts.size} milestone field(s) changed in MSX since review; no updates applied.`
		});
		const updatesByMilestone = /* @__PURE__ */ new Map();
		for (const slot of milestoneSlots) {
			const milestoneId = slot.targetRecordId;
			const milestone = currentById.get(milestoneId);
			const bucket = updatesByMilestone.get(milestoneId) ?? {
				update: {},
				before: this.captureMilestoneBefore(milestone)
			};
			if (slot.targetField === "milestoneCommitment") bucket.update = {
				...bucket.update,
				customerCommitment: slot.after === "Committed" ? "Committed" : "Uncommitted"
			};
			else if (slot.targetField === "milestoneRisk") bucket.update = {
				...bucket.update,
				riskDetails: prepend(milestone?.riskDetails, String(slot.after))
			};
			updatesByMilestone.set(milestoneId, bucket);
		}
		const appliedMilestoneIds = [];
		let oppCommentsBefore;
		let oppCommentApplied = false;
		try {
			for (const [milestoneId, { update }] of updatesByMilestone) {
				if (Object.keys(update).length === 0) continue;
				await this.msx.updateMilestone(proposal.opportunityId, milestoneId, update);
				appliedMilestoneIds.push(milestoneId);
			}
			const note = this.composeMeetingNote(proposal, oppSlots, approvedNewMilestoneNames, approval.reason);
			if (oppSlots.length > 0 || approvedNewMilestoneNames.length > 0) {
				oppCommentsBefore = (await this.msx.getOpportunityContext(proposal.opportunityId)).opportunity.comments;
				await this.msx.updateOpportunity(proposal.opportunityId, { comments: prepend(oppCommentsBefore, note) });
				oppCommentApplied = true;
			}
		} catch (error) {
			for (const milestoneId of appliedMilestoneIds.reverse()) {
				const before = updatesByMilestone.get(milestoneId)?.before;
				if (before && Object.keys(before).length > 0) await this.msx.updateMilestone(proposal.opportunityId, milestoneId, before).catch(() => {});
			}
			if (oppCommentApplied) await this.msx.updateOpportunity(proposal.opportunityId, { comments: oppCommentsBefore ?? "" }).catch(() => {});
			return meetingChangeSetResultSchema.parse({
				changeSetId: proposal.changeSetId,
				state: "rolled-back",
				items: this.buildResultItems(proposal, approval, {
					applied: /* @__PURE__ */ new Set(),
					conflicts: /* @__PURE__ */ new Set(),
					appliedNewMilestones: false,
					failure: error instanceof Error ? error.message : String(error)
				}),
				auditNote: `Rolled back after a write failed: ${error instanceof Error ? error.message : String(error)}.`
			});
		}
		const appliedSlotIds = /* @__PURE__ */ new Set([...oppSlots.map((slot) => slot.slotId), ...milestoneSlots.filter((slot) => appliedMilestoneIds.includes(slot.targetRecordId)).map((slot) => slot.slotId)]);
		return meetingChangeSetResultSchema.parse({
			changeSetId: proposal.changeSetId,
			state: "applied",
			items: this.buildResultItems(proposal, approval, {
				applied: appliedSlotIds,
				conflicts: /* @__PURE__ */ new Set(),
				appliedNewMilestones: true
			}),
			auditNote: `Meeting inject (${proposal.meetingType}): updated ${appliedMilestoneIds.length} milestone(s) and captured ${oppSlots.length} opportunity signal(s) in the opportunity notes. Reason: ${approval.reason}`
		});
	}
	captureMilestoneBefore(milestone) {
		if (!milestone) return {};
		return {
			...milestone.commitment === "Committed" || milestone.commitment === "Uncommitted" ? { customerCommitment: milestone.commitment } : {},
			...milestone.riskDetails ? { riskDetails: milestone.riskDetails } : {}
		};
	}
	buildResultItems(proposal, approval, outcome) {
		const items = [];
		for (const slot of proposal.slots) {
			if (!approval.approvedSlotIds.includes(slot.slotId)) continue;
			let state;
			let detail;
			if (outcome.conflicts.has(slot.slotId)) {
				state = "conflict";
				detail = `"${slot.label}" changed in MSX since review; no update applied.`;
			} else if (outcome.applied.has(slot.slotId)) {
				state = "applied";
				detail = slot.targetKind === "opportunity" ? `${slot.label}: ${slot.displayAfter} (captured in opportunity notes)` : `${slot.label}: ${slot.displayAfter}`;
			} else if (slot.targetKind === "milestone" && slot.targetRecordId && !approval.selectedMilestoneIds.includes(slot.targetRecordId)) {
				state = "skipped";
				detail = `${slot.label}: milestone not selected.`;
			} else {
				state = "skipped";
				detail = outcome.failure ? `${slot.label}: not applied (rolled back).` : `${slot.label}: not applied.`;
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
			items.push({
				id: milestone.tempId,
				kind: "new-milestone",
				state: outcome.appliedNewMilestones ? "applied" : "skipped",
				detail: outcome.appliedNewMilestones ? `"${milestone.name}" recorded in opportunity notes as a recommended next step.` : `"${milestone.name}" not recorded (rolled back).`
			});
		}
		return items;
	}
};
//#endregion
//#region ../../packages/connectors/msx/index.ts
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
	},
	...additionalSampleAccounts
];
var opportunities = withSampleOpportunityIntents([
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
	},
	...additionalSampleOpportunities
]);
Object.fromEntries(opportunities.map((opportunity) => [opportunity.id, additionalSampleMilestones.filter((milestone) => milestone.opportunityId === opportunity.id).length > 0 ? additionalSampleMilestones.filter((milestone) => milestone.opportunityId === opportunity.id) : [{
	id: `${opportunity.id}-milestone`,
	opportunityId: opportunity.id,
	name: "Customer outcome validation",
	status: "In progress",
	targetDate: opportunity.closeDate,
	owner: "Account team",
	commitment: "Best case"
}]]));
({ ...Object.fromEntries(Object.entries(additionalSampleObservationsByOpportunity).map(([opportunityId, observations]) => [opportunityId, [...observations]])) });
var discoverableOpportunities = [
	...samplePortfolioDiscoveryOpportunities(accounts, opportunities),
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
Object.fromEntries(discoverableOpportunities.map((opportunity) => [opportunity.id, [{
	id: `${opportunity.id}-milestone`,
	opportunityId: opportunity.id,
	name: "Customer outcome validation",
	status: "On Track",
	targetDate: opportunity.closeDate,
	owner: "Account team",
	commitment: "Best case"
}]]));
//#endregion
//#region ../../packages/connectors/sharepoint/local-pdf.ts
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
//#region ../../packages/agents/mcem-coach/src/milestone-signals.ts
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
//#region ../../packages/agents/mcem-coach/src/index.ts
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
		contractVersion: "1.2",
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
//#region ../../packages/orchestrator/record-creation/digest.ts
var signingKey = randomBytes(32);
function creationPreviewDigest(input) {
	return createHmac("sha256", signingKey).update(JSON.stringify(input)).digest("hex");
}
//#endregion
//#region ../../packages/orchestrator/record-creation/export.ts
function csvCell(value) {
	const raw = String(value ?? "");
	const firstContent = [...raw].find((character) => character.charCodeAt(0) > 31 && !/\s/.test(character));
	const safe = firstContent && "=+-@".includes(firstContent) ? `'${raw}` : raw;
	return /[",\r\n]/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}
function csv(rows) {
	return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
function reviewText(value) {
	return value.replace(/[\\<>*_[\]`|]/g, "\\$&").replace(/\r?\n/g, " ");
}
var opportunityHeaders = [
	"clientOpportunityKey",
	"name",
	"opportunityIntent",
	"estimatedValue",
	"priceListId",
	"priceListLabel",
	"currencyId",
	"currencyLabel",
	"ownerId",
	"ownerLabel",
	"estimatedCloseDate",
	"need",
	"solutionArea",
	"technicalCapability"
];
var milestoneHeaders = [
	"clientMilestoneKey",
	"parentOpportunityKey",
	"name",
	"milestoneCategory",
	"milestoneDate",
	"workloadId",
	"workloadLabel",
	"ownerId",
	"ownerLabel",
	"milestoneStatus",
	"customerCommitment",
	"estimatedMonthlyUsage",
	"comments",
	"riskDetails",
	"customerBudgetApproved"
];
function milestoneRow(milestone, parentKey) {
	return [
		milestone.clientMilestoneKey,
		parentKey,
		milestone.name,
		milestone.category.label,
		milestone.milestoneDate,
		milestone.workload.id,
		milestone.workload.label,
		milestone.owner?.id,
		milestone.owner?.label,
		milestone.status?.label,
		milestone.commitment?.label,
		milestone.estimatedMonthlyUsage,
		milestone.comments,
		milestone.riskDetails,
		milestone.customerBudgetApproved?.label
	];
}
function creationCsvFiles(draft) {
	const opportunityRows = draft.kind === "opportunity-batch" ? draft.opportunities.map(({ opportunity }) => [
		opportunity.clientOpportunityKey,
		opportunity.name,
		opportunity.intent.map((choice) => choice.label).join("|"),
		opportunity.estimatedValue,
		opportunity.priceList?.id,
		opportunity.priceList?.label,
		opportunity.currency?.id,
		opportunity.currency?.label,
		opportunity.owner?.id,
		opportunity.owner?.label,
		opportunity.estimatedCloseDate,
		opportunity.need,
		opportunity.solutionArea?.label,
		opportunity.technicalCapability?.label
	]) : [];
	const milestoneRows = draft.kind === "opportunity-batch" ? draft.opportunities.flatMap(({ opportunity, milestones }) => milestones.map((milestone) => milestoneRow(milestone, opportunity.clientOpportunityKey))) : draft.milestones.map((milestone) => milestoneRow(milestone, draft.opportunity.id));
	return [...opportunityRows.length > 0 ? [{
		name: "opportunities.csv",
		content: csv([opportunityHeaders, ...opportunityRows]),
		mimeType: "text/csv"
	}] : [], ...milestoneRows.length > 0 ? [{
		name: "milestones.csv",
		content: csv([milestoneHeaders, ...milestoneRows]),
		mimeType: "text/csv"
	}] : []];
}
function exportCreationDraft(preview) {
	const draft = preview.normalizedDraft;
	const opportunityCount = draft.kind === "opportunity-batch" ? draft.opportunities.length : 0;
	const milestoneCount = draft.kind === "opportunity-batch" ? draft.opportunities.reduce((total, item) => total + item.milestones.length, 0) : draft.milestones.length;
	const result = recordCreationResultSchema.parse({
		contractVersion: "1.2",
		batchId: preview.batchId,
		target: "draft",
		state: "drafted",
		created: [],
		audit: {
			correlationId: preview.batchId,
			opportunityCount,
			milestoneCount
		},
		message: "Draft created. No Opportunity or Milestone was written to MSX."
	});
	const names = draft.kind === "opportunity-batch" ? draft.opportunities.map((item) => item.opportunity.name) : [draft.opportunity.label];
	const review = [
		"# Record creation draft",
		"",
		`Account: ${reviewText(draft.account.label)}`,
		`Opportunities to create: ${opportunityCount}`,
		`Milestones to create: ${milestoneCount}`,
		"",
		...names.map((name) => `- ${reviewText(name)}`),
		"",
		"**No Opportunity or Milestone was written to MSX.**",
		""
	].join("\n");
	return recordCreationDraftResultSchema.parse({
		contractVersion: "1.2",
		result,
		files: [
			{
				name: "creation-manifest.json",
				content: `${JSON.stringify(draft, null, 2)}\n`,
				mimeType: "application/json"
			},
			{
				name: "creation-review.md",
				content: review,
				mimeType: "text/markdown"
			},
			...creationCsvFiles(draft)
		]
	});
}
//#endregion
//#region ../../packages/orchestrator/record-creation/service.ts
var RecordCreationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "RecordCreationError";
	}
};
function requireReference(submitted, fallback, options, label) {
	const requested = submitted ?? fallback;
	const found = options.find((item) => item.id === requested?.id);
	if (!found || found.label !== requested?.label) throw new RecordCreationError("reference-unavailable", `${label} is unavailable or has changed. Choose a current value.`);
	return {
		id: found.id,
		label: found.label
	};
}
function requireChoice(selected, choices, label) {
	const found = choices.find((choice) => choice.value === selected.value);
	if (!found || found.label !== selected.label) throw new RecordCreationError("reference-unavailable", `${label} is unavailable or has changed. Choose a current value.`);
	return found;
}
var RecordCreationService = class {
	msx;
	catalogProvider;
	writer;
	now;
	constructor(msx, catalogProvider, options = {}) {
		this.msx = msx;
		this.catalogProvider = catalogProvider;
		this.writer = options.writer;
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
	}
	async getCatalog(input) {
		const request = recordCreationCatalogRequestSchema.parse(input);
		const account = (await this.msx.listAccounts()).find((item) => item.id === request.accountId);
		if (!account || account.visibility === "hidden") throw new RecordCreationError("parent-unavailable", "The selected Account is unavailable or hidden.");
		const catalog = await this.catalogProvider.getCatalog(request.accountId);
		if (account.name !== catalog.account.label) throw new RecordCreationError("catalog-changed", "The Account name changed. Refresh the creation catalog.");
		return {
			...catalog,
			target: this.writer ? "sqlite" : "draft"
		};
	}
	async preview(input) {
		const request = recordCreationPreviewRequestSchema.parse(input);
		if (request.target === "live-msx") throw new RecordCreationError("target-disabled", "Live MSX record creation is disabled. Use a draft or the SQLite sample store.");
		if (request.target === "sqlite" && !this.writer) throw new RecordCreationError("target-disabled", "SQLite record creation is unavailable in this mode. Export a draft instead.");
		const catalog = await this.getCatalog({
			contractVersion: "1.2",
			accountId: request.draft.account.id
		});
		const normalizedDraft = await this.normalizeDraft(request.draft, catalog);
		if (request.target === "sqlite" && normalizedDraft.kind === "existing-opportunity-milestone-batch" && !catalog.opportunities.find((item) => item.id === normalizedDraft.opportunity.id)?.currency) throw new RecordCreationError("reference-unavailable", "The parent Opportunity currency is unavailable. Choose an Opportunity with a resolved currency.");
		const mutationCount = this.countMutations(normalizedDraft);
		if (mutationCount > catalog.maxMutations) throw new RecordCreationError("batch-too-large", `The batch has ${mutationCount} mutations; this mode allows ${catalog.maxMutations}.`);
		const batchId = randomUUID();
		const warnings = request.target === "draft" ? ["Draft only. No records will be written to MSX or SQLite."] : [];
		const expiresAt = new Date(this.now().getTime() + 9e5).toISOString();
		return recordCreationPreviewSchema.parse({
			contractVersion: "1.2",
			batchId,
			digest: creationPreviewDigest({
				batchId,
				target: request.target,
				catalogRevision: catalog.revision,
				userId: catalog.defaults.owner.id,
				normalizedDraft,
				mutationCount,
				warnings,
				expiresAt
			}),
			target: request.target,
			catalogRevision: catalog.revision,
			normalizedDraft,
			mutationCount,
			warnings,
			expiresAt
		});
	}
	async commit(input) {
		const request = recordCreationCommitRequestSchema.parse(input);
		const { preview } = request;
		if (preview.target !== "sqlite" || !this.writer) throw new RecordCreationError("target-disabled", "This preview is a draft; export it instead of committing.");
		const catalog = await this.validatePreview(request);
		const receipt = await this.writer.getReceipt(preview.batchId, preview.digest);
		if (receipt) return receipt;
		await this.validateCurrentCatalog(preview, catalog);
		return this.writer.commit(preview.normalizedDraft, preview.batchId, preview.digest);
	}
	async exportDraft(input) {
		const request = recordCreationCommitRequestSchema.parse(input);
		if (request.preview.target !== "draft") throw new RecordCreationError("target-disabled", "Only a reviewed draft can be exported.");
		const catalog = await this.validatePreview(request);
		await this.validateCurrentCatalog(request.preview, catalog);
		return exportCreationDraft(request.preview);
	}
	async validatePreview(request) {
		const { preview } = request;
		if (preview.digest !== request.expectedDigest) throw new RecordCreationError("stale-preview", "The reviewed preview digest changed. Preview the batch again.");
		if (this.now().getTime() >= Date.parse(preview.expiresAt)) throw new RecordCreationError("stale-preview", "The reviewed preview expired. Preview the batch again.");
		const catalog = await this.getCatalog({
			contractVersion: "1.2",
			accountId: preview.normalizedDraft.account.id
		});
		if (creationPreviewDigest({
			batchId: preview.batchId,
			target: preview.target,
			catalogRevision: preview.catalogRevision,
			userId: catalog.defaults.owner.id,
			normalizedDraft: preview.normalizedDraft,
			mutationCount: preview.mutationCount,
			warnings: preview.warnings,
			expiresAt: preview.expiresAt
		}) !== preview.digest) throw new RecordCreationError("stale-preview", "The reviewed preview was changed. Preview the batch again.");
		return catalog;
	}
	async validateCurrentCatalog(preview, catalog) {
		if (catalog.revision !== preview.catalogRevision) throw new RecordCreationError("catalog-changed", "The creation catalog changed. Preview the batch again.");
		if (this.countMutations(preview.normalizedDraft) !== preview.mutationCount || preview.mutationCount > catalog.maxMutations) throw new RecordCreationError("stale-preview", "The reviewed mutation count changed. Preview the batch again.");
		const draft = preview.normalizedDraft;
		if (preview.target === "sqlite" && draft.kind === "existing-opportunity-milestone-batch" && !catalog.opportunities.find((item) => item.id === draft.opportunity.id)?.currency) throw new RecordCreationError("reference-unavailable", "The parent Opportunity currency is unavailable. Preview the batch again.");
		const normalized = await this.normalizeDraft(preview.normalizedDraft, catalog);
		if (JSON.stringify(normalized) !== JSON.stringify(preview.normalizedDraft)) throw new RecordCreationError("catalog-changed", "A reference or parent changed. Preview the batch again.");
	}
	countMutations(draft) {
		return draft.kind === "opportunity-batch" ? draft.opportunities.reduce((total, bundle) => total + 2 + bundle.milestones.length, 0) : draft.milestones.length;
	}
	async normalizeDraft(input, catalog) {
		const draft = recordCreationDraftSchema.parse(input);
		if (draft.account.id !== catalog.account.id || draft.account.label !== catalog.account.label) throw new RecordCreationError("parent-unavailable", "The selected Account does not match the current catalog.");
		const normalizeChild = (value) => ({
			...value,
			category: requireChoice(value.category, catalog.choices.category, "Milestone Category"),
			workload: requireReference(value.workload, void 0, catalog.workloads, "Workload"),
			owner: requireReference(value.owner, catalog.defaults.owner, catalog.owners, "Owner"),
			status: value.status ? requireChoice(value.status, catalog.choices.status, "Milestone Status") : requireChoice({
				value: 86198e4,
				label: "On Track"
			}, catalog.choices.status, "Milestone Status"),
			...value.commitment ? { commitment: requireChoice(value.commitment, catalog.choices.commitment, "Customer Commitment") } : {},
			...value.customerBudgetApproved ? { customerBudgetApproved: requireChoice(value.customerBudgetApproved, catalog.choices.customerBudgetApproved, "Customer Budget Approved") } : {}
		});
		if (draft.kind === "existing-opportunity-milestone-batch") {
			const parent = (await this.msx.listOpportunities(draft.account.id)).find((item) => item.id === draft.opportunity.id);
			const authorized = catalog.opportunities.find((item) => item.id === draft.opportunity.id);
			if (!parent || parent.name !== draft.opportunity.label || authorized?.label !== parent.name) throw new RecordCreationError("parent-unavailable", "The parent Opportunity is unavailable or does not belong to this Account.");
			if (authorized.currency && authorized.currency.isoCode !== parent.currency) throw new RecordCreationError("catalog-changed", "The parent Opportunity currency has changed. Refresh the creation catalog.");
			return recordCreationDraftSchema.parse({
				...draft,
				account: catalog.account,
				opportunity: {
					id: parent.id,
					label: parent.name
				},
				milestones: draft.milestones.map(normalizeChild)
			});
		}
		return recordCreationDraftSchema.parse({
			...draft,
			account: catalog.account,
			opportunities: draft.opportunities.map(({ opportunity, milestones }) => ({
				opportunity: {
					...opportunity,
					intent: opportunity.intent.map((choice) => requireChoice(choice, catalog.choices.intent, "Opportunity Intent")),
					priceList: requireReference(opportunity.priceList, catalog.defaults.priceList, catalog.priceLists, "Price List"),
					currency: requireReference(opportunity.currency, catalog.defaults.currency, catalog.currencies, "Currency"),
					owner: requireReference(opportunity.owner, catalog.defaults.owner, catalog.owners, "Owner"),
					...opportunity.solutionArea ? { solutionArea: requireChoice(opportunity.solutionArea, catalog.choices.solutionArea, "Solution Area") } : {},
					...opportunity.technicalCapability ? { technicalCapability: requireChoice(opportunity.technicalCapability, catalog.choices.technicalCapability, "Technical Capability") } : {}
				},
				milestones: milestones.map(normalizeChild)
			}))
		});
	}
};
//#endregion
//#region ../../packages/orchestrator/policies/mcp-tool-authorization.ts
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
//#region ../../packages/orchestrator/routing/mcp-tool-broker.ts
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
//#region ../../packages/orchestrator/workflows/cohort-executor.ts
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
//#region ../../packages/connectors/dataverse-mcp/query-guard.ts
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
//#region ../../packages/connectors/dataverse-mcp/adapter.ts
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
//#region ../../packages/connectors/mcp/index.ts
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
//#region ../../packages/connectors/mcp/pool.ts
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
//#region ../../packages/connectors/msx-mcp/adapter.ts
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
var activitySchema$1 = z.object({
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
	activities: z.array(activitySchema$1),
	competitors: z.array(z.string().min(1)),
	products: z.array(z.string().min(1))
}).strict();
var account360Schema = z.object({
	account: accountSchema$1,
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
		}, z.array(activitySchema$1), [], context);
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
			const code = getErrorCode(error);
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
function getErrorCode(error) {
	return isRecord(error) && typeof error.code === "string" ? error.code : void 0;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region ../../packages/orchestrator/workflows/registry.ts
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
//#region ../../packages/orchestrator/workflows/configured-host.ts
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
//#region ../../packages/orchestrator/workflows/sample-host.ts
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
//#region ../../packages/orchestrator/index.ts
var ThinSliceOrchestrator = class {
	msx;
	mcem;
	taskAgents;
	performanceReporter;
	recordCreation;
	constructor(msx, mcem, taskAgents = {}, performanceReporter, recordCreation) {
		this.msx = msx;
		this.mcem = mcem;
		this.taskAgents = taskAgents;
		this.performanceReporter = performanceReporter;
		this.recordCreation = recordCreation;
	}
	getRecordCreationCatalog(request) {
		return this.requireRecordCreation().getCatalog(request);
	}
	previewRecordCreation(request) {
		return this.requireRecordCreation().preview(request);
	}
	commitRecordCreation(request) {
		return this.requireRecordCreation().commit(request);
	}
	exportRecordCreationDraft(request) {
		return this.requireRecordCreation().exportDraft(request);
	}
	requireRecordCreation() {
		if (!this.recordCreation) throw new RecordCreationError("target-disabled", "Record creation is unavailable in this mode.");
		return this.recordCreation;
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
	async getOpportunitySnapshot(opportunityId) {
		if (!opportunityId.trim()) throw new Error("An opportunity id is required.");
		const context = await this.msx.getOpportunityContext(opportunityId);
		const milestones = await this.msx.listMilestones(opportunityId);
		const revisionTokens = await this.msx.getConcurrencyTokens?.(opportunityId);
		return {
			account: context.account,
			opportunity: context.opportunity,
			milestones,
			...revisionTokens ? { revisionTokens } : {}
		};
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
			contractVersion: "1.2",
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
//#region ../../packages/connectors/foundry/index.ts
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
//#region ../../packages/orchestrator/task-agents.ts
function formatLiveAgentGuidance(capability, context) {
	const evaluation = context.localEvaluation;
	const opportunity = context.opportunityContext.opportunity;
	const headline = {
		"account-pulse": `Focus for ${opportunity.name}: close the highest-priority Stage ${evaluation.recordedStage} evidence gaps and confirm the next customer commitment.`,
		"mcem-coach": evaluation.summary,
		"pursuit-executive": `Prepare the pursuit for ${opportunity.name} around its Stage ${evaluation.recordedStage} gaps, decision team, and customer commitments.`,
		"risk-solution-play": `${opportunity.name} has ${evaluation.recommendations.length} progression risk${evaluation.recommendations.length === 1 ? "" : "s"} to resolve before Stage ${evaluation.evidenceBasedStage}.`
	};
	const criteria = evaluation.criteria.map((criterion) => `- **${criterion.label}: ${criterion.status}** — ${criterion.rationale}`).join("\n");
	const recommendations = evaluation.recommendations.map((recommendation) => `| ${recommendation.ownerRole} | ${recommendation.action} | ${recommendation.confidence} |`).join("\n");
	const missing = evaluation.missingData.length > 0 ? evaluation.missingData.map((item) => `- ${item}`).join("\n") : "- All current-stage exit criteria have supporting evidence.";
	return [
		"## Summary",
		"",
		headline[capability],
		"",
		`> Requested: ${context.request.prompt}`,
		"",
		"## Context used",
		"",
		`**Opportunity:** ${opportunity.name}`,
		`**Owner:** ${opportunity.owner ?? "Account team"}`,
		`**Recorded / evidence-based stage:** ${evaluation.recordedStage} / ${evaluation.evidenceBasedStage}`,
		`**MCEM guidance:** ${context.guidance.title}`,
		"",
		"## Exit criteria",
		"",
		criteria,
		"",
		"## Recommended actions",
		"",
		"| Owner | Action | Confidence |",
		"| --- | --- | --- |",
		recommendations,
		"",
		"## Assumptions and missing information",
		"",
		missing
	].join("\n");
}
function createDeterministicLiveTaskAgents() {
	return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
		version: "guidance-live-v1",
		agent: { invoke: async (context) => formatLiveAgentGuidance(capability, context) }
	}]));
}
function createFoundryTaskAgents(environment, credential, client = createFoundryOpenAIClient(environment.foundry.projectEndpoint, credential)) {
	const bindings = environment.foundry.agents;
	const agents = {
		"account-pulse": bindings.accountPulse,
		"mcem-coach": bindings.mcemCoach,
		"pursuit-executive": bindings.pursuitExecutive,
		"risk-solution-play": bindings.riskSolutionPlay
	};
	return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
		version: "active",
		agent: new FoundryPromptAgent({
			projectEndpoint: environment.foundry.projectEndpoint,
			agentName: agents[capability].name,
			requestTimeoutMs: environment.foundry.requestTimeoutMs,
			credential,
			openAIClient: client
		})
	}]));
}
function createSampleTaskAgents(version = "sample-v1") {
	return Object.fromEntries(workflowAgentCapabilityValues.map((capability) => [capability, {
		version,
		agent: { invoke: async (context) => `## ${capability.replaceAll("-", " ")}\n\nSample guidance for **${context.opportunityContext.opportunity.name}**.\n\n${context.request.prompt}` }
	}]));
}
//#endregion
//#region ../../packages/common/fixtures/seller-dashboard.ts
var asOf = "2026-10-10";
var generatedAt = "2026-10-10T09:00:00.000Z";
var end = "2026-12-31";
var accountInputs = [
	{
		tpid: "1000001",
		name: "Contoso Energy",
		quotas: [
			9e5,
			42e4,
			24e4
		],
		actuals: [
			72e4,
			27e4,
			28e4
		]
	},
	{
		tpid: "1000002",
		name: "Fabrikam Retail",
		quotas: [
			6e5,
			3e5,
			15e4
		],
		actuals: [
			45e4,
			18e4,
			16e4
		]
	},
	{
		tpid: "1000003",
		name: "Northwind Health",
		quotas: [
			42e4,
			24e4,
			12e4
		],
		actuals: [
			462e3,
			13e4,
			125e3
		]
	},
	{
		tpid: "1000004",
		name: "Zava Inc.",
		quotas: [
			3e5,
			18e4,
			6e4
		],
		actuals: [
			18e4,
			9e4,
			65e3
		]
	},
	{
		tpid: "1000005",
		name: "Adventure Works Cycles",
		quotas: [
			18e4,
			6e4,
			3e4
		],
		actuals: [
			-3e4,
			null,
			2e4
		]
	}
];
var metricInputs = [
	{
		name: "ACR - Core",
		bucket: "Organic consumption",
		weight: .6,
		attainment: 80,
		recurring: 6e5
	},
	{
		name: "Databases",
		bucket: "Strategic workloads",
		weight: .25,
		attainment: 60,
		recurring: 2e5
	},
	{
		name: "Fabric + XCR - Power BI Consumed Revenue",
		bucket: "Analytics growth",
		weight: .15,
		attainment: 100,
		recurring: 1e5
	}
];
function recordTiming(value) {
	return value === null ? "undated" : value < asOf ? "overdue" : value > end ? "future" : "in-quarter";
}
function createSampleSellerDashboard() {
	const metrics = metricInputs.map((metric, index) => {
		const quota = accountInputs.reduce((sum, row) => sum + (row.quotas[index] ?? 0), 0);
		const actual = accountInputs.reduce((sum, row) => sum + (row.actuals[index] ?? 0), 0);
		return {
			name: metric.name,
			bucket: metric.bucket,
			unit: "USD",
			mappingSupported: true,
			scenarioAllowed: true,
			attainment: metric.attainment,
			actual,
			quota,
			recurring: metric.recurring,
			calcActual: actual - metric.recurring,
			calcQuota: quota - metric.recurring,
			gap: Math.max(quota - actual, 0),
			closedGap: Math.max(quota / 2 - actual / 2, 0),
			closedAttainment: 85.2,
			accountActualDifference: 0,
			accountQuotaDifference: 0
		};
	});
	const opportunities = [
		{
			account: 0,
			name: "Grid operations modernization",
			owner: "Avery Johnson",
			stage: "3 - Empower & Achieve",
			value: 42e5,
			date: "2026-11-15",
			state: "Open",
			intent: "Azure consumption",
			play: "Cloud migration",
			modified: "2026-08-20T09:00:00.000Z"
		},
		{
			account: 0,
			name: "Azure commitment renewal",
			owner: "Jordan Lee",
			stage: "2 - Inspire & Design",
			value: 26e5,
			date: "2026-12-10",
			state: "Open",
			intent: "MACC",
			play: "Azure commitment",
			modified: generatedAt
		},
		{
			account: 1,
			name: "Retail analytics expansion",
			owner: "Taylor Morgan",
			stage: "3 - Empower & Achieve",
			value: 18e5,
			date: "2026-10-25",
			state: "Open",
			intent: "Azure consumption",
			play: "Fabric analytics",
			modified: generatedAt
		},
		{
			account: 1,
			name: "SQL platform modernization",
			owner: "Casey Park",
			stage: "2 - Inspire & Design",
			value: 11e5,
			date: "2026-12-01",
			state: "Open",
			intent: "SQL billed",
			play: "SQL modernization",
			modified: "2026-08-18T09:00:00.000Z"
		},
		{
			account: 2,
			name: "Clinical data estate",
			owner: "Morgan Chen",
			stage: "4 - Realize Value",
			value: 32e5,
			date: "2026-08-30",
			state: "Won",
			intent: "Azure consumption",
			play: "Database modernization",
			modified: generatedAt
		},
		{
			account: 2,
			name: "AI-assisted care planning",
			owner: "Morgan Chen",
			stage: "1 - Listen & Consult",
			value: 85e4,
			date: "2027-02-20",
			state: "Open",
			intent: "Azure consumption",
			play: "AI innovation",
			modified: generatedAt
		},
		{
			account: 3,
			name: "Secure cloud landing zone",
			owner: "Drew Wilson",
			stage: "1 - Listen & Consult",
			value: 65e4,
			date: "2026-12-20",
			state: "Open",
			intent: "Azure consumption",
			play: "Security foundations",
			modified: generatedAt
		},
		{
			account: 3,
			name: "Database growth program",
			owner: "Sam Rivera",
			stage: "2 - Inspire & Design",
			value: 72e4,
			date: "2026-11-28",
			state: "Open",
			intent: "Azure consumption",
			play: "Database modernization",
			modified: generatedAt
		}
	].map((input, index) => {
		const account = accountInputs[input.account];
		if (!account) throw new Error("Invalid synthetic opportunity account.");
		return {
			id: `sample-opportunity-${index + 1}`,
			number: `SAMPLE-OP-${index + 1}`,
			tpid: account.tpid,
			account: account.name,
			name: input.name,
			owner: input.owner,
			stage: input.stage,
			solutionArea: "Cloud and AI Platforms",
			salesPlay: input.play,
			intent: input.intent,
			estimatedValue: input.value,
			currency: "USD",
			monthlyRunRate: null,
			closeDate: input.date,
			state: input.state,
			forecastComments: "Synthetic review evidence: confirm customer decision, workload credit and the next accountable owner.",
			timing: recordTiming(input.date),
			relevance: "Review metric mapping",
			modifiedAt: input.modified,
			...input.intent === "SQL billed" ? {
				estimatedBilledRevenue: 24e4,
				estimatedSqlRevenue: 18e4
			} : {}
		};
	});
	const milestones = [
		{
			parent: 0,
			name: "Azure production rollout",
			monthly: 42e3,
			date: "2026-11-01",
			status: "On Track",
			commitment: "Committed",
			metric: 0,
			workload: "Azure Kubernetes Service",
			category: "Production"
		},
		{
			parent: 0,
			name: "Grid telemetry expansion",
			monthly: 18e3,
			date: "2026-10-03",
			status: "At Risk",
			commitment: "Uncommitted",
			metric: 0,
			workload: "Azure infrastructure",
			category: "Production"
		},
		{
			parent: 0,
			name: "Regional capacity approval",
			monthly: 24e3,
			date: "2026-10-28",
			status: "Blocked",
			commitment: "Uncommitted",
			metric: 0,
			workload: "Azure virtual machines",
			category: "Production"
		},
		{
			parent: 1,
			name: "Commitment onboarding",
			monthly: 16e3,
			date: "2026-12-15",
			status: "On Track",
			commitment: "Committed",
			metric: 0,
			workload: "Azure infrastructure",
			category: "Production"
		},
		{
			parent: 2,
			name: "Fabric analytics launch",
			monthly: 22e3,
			date: "2026-10-21",
			status: "On Track",
			commitment: "Committed",
			metric: 2,
			workload: "Microsoft Fabric",
			category: "Production"
		},
		{
			parent: 2,
			name: "Store analytics expansion",
			monthly: 12e3,
			date: "2026-11-20",
			status: "At Risk",
			commitment: "Uncommitted",
			metric: 2,
			workload: "Power BI",
			category: "Production"
		},
		{
			parent: 3,
			name: "SQL production cutover",
			monthly: 28e3,
			date: "2026-10-05",
			status: "Blocked",
			commitment: "Uncommitted",
			metric: 1,
			workload: "Azure SQL Database",
			category: "Production"
		},
		{
			parent: 3,
			name: "Database capacity growth",
			monthly: 19e3,
			date: "2026-12-01",
			status: "On Track",
			commitment: "Uncommitted",
			metric: 1,
			workload: "Azure SQL Database",
			category: "Production"
		},
		{
			parent: 4,
			name: "Clinical database scale-out",
			monthly: 31e3,
			date: "2026-11-08",
			status: "On Track",
			commitment: "Committed",
			metric: 1,
			workload: "Azure Cosmos DB",
			category: "Production"
		},
		{
			parent: 4,
			name: "Completed clinical pilot",
			monthly: 8e3,
			date: "2026-08-30",
			status: "Completed",
			commitment: "Committed",
			metric: 1,
			workload: "Azure SQL Database",
			category: "Pilot"
		},
		{
			parent: 5,
			name: "AI proof of value",
			monthly: 9e3,
			date: "2027-01-12",
			status: "On Track",
			commitment: "Uncommitted",
			metric: 0,
			workload: "Azure AI",
			category: "Pilot"
		},
		{
			parent: 6,
			name: "Landing-zone assessment",
			monthly: 7e3,
			date: "2026-11-12",
			status: "On Track",
			commitment: "Uncommitted",
			metric: 0,
			workload: "Azure infrastructure",
			category: "Assessment"
		},
		{
			parent: 7,
			name: "PostgreSQL production ramp",
			monthly: 14e3,
			date: "2026-11-18",
			status: "At Risk",
			commitment: "Uncommitted",
			metric: 1,
			workload: "Azure Database for PostgreSQL",
			category: "Production"
		},
		{
			parent: 7,
			name: "Workload credit review",
			monthly: 11e3,
			date: null,
			status: "On Track",
			commitment: "Best case",
			metric: null,
			workload: "Unmapped workload",
			category: "Production"
		}
	].map((input, index) => {
		const parent = opportunities[input.parent];
		const metric = input.metric === null ? void 0 : metricInputs[input.metric];
		if (!parent) throw new Error("Invalid synthetic milestone parent.");
		const active = input.status !== "Completed";
		const eligible = active && input.category === "Production";
		return {
			id: `sample-milestone-${index + 1}`,
			number: `SAMPLE-MS-${index + 1}`,
			opportunityId: parent.id,
			opportunityName: parent.name,
			tpid: parent.tpid,
			account: parent.account,
			name: input.name,
			owner: parent.owner,
			category: input.category,
			status: input.status,
			commitment: input.commitment,
			monthly: input.monthly,
			date: input.date,
			workload: input.workload,
			forecastComments: "Synthetic customer-review note; incremental credit and production date require owner confirmation.",
			currency: "USD",
			active,
			timing: recordTiming(input.date),
			metricCandidates: metric ? [metric.name] : [],
			mappingBasis: "Tentative workload hint; not a verified earnings-credit rule.",
			classification: eligible ? "Production candidate - credit unverified" : "Not an eligible production candidate",
			scenarioCredit: null,
			modifiedAt: parent.modifiedAt ?? generatedAt,
			...input.commitment === "Committed" ? { commitmentChangedAt: "2026-10-05T09:00:00.000Z" } : {},
			region: "East US",
			riskDetails: input.status === "Blocked" ? "Synthetic capacity dependency: owner approval required." : ""
		};
	});
	const accounts = accountInputs.map((input) => {
		const accountOpportunities = opportunities.filter((row) => row.tpid === input.tpid);
		const open = accountOpportunities.filter((row) => row.state === "Open");
		const accountMilestones = milestones.filter((row) => row.tpid === input.tpid);
		const candidates = accountMilestones.filter((row) => row.active && row.category === "Production" && row.timing === "in-quarter");
		return {
			tpid: input.tpid,
			name: input.name,
			metrics: metricInputs.map((metric, index) => {
				const quota = input.quotas[index];
				const actual = input.actuals[index];
				if (quota === void 0 || actual === void 0) throw new Error("Incomplete synthetic quota row.");
				return {
					metric: metric.name,
					bucket: metric.bucket,
					quota,
					actual,
					variance: actual === null ? null : actual - quota,
					gap: actual === null ? null : Math.max(quota - actual, 0)
				};
			}),
			pipeline: {
				status: "complete",
				openCount: open.length,
				inQuarterCount: open.filter((row) => row.timing === "in-quarter").length,
				inQuarterValue: open.filter((row) => row.timing === "in-quarter").reduce((sum, row) => sum + (row.estimatedValue ?? 0), 0),
				productionCount: accountMilestones.filter((row) => row.active && row.category === "Production").length,
				inQuarterProductionCount: candidates.length,
				committedMonthly: candidates.filter((row) => row.commitment === "Committed").reduce((sum, row) => sum + (row.monthly ?? 0), 0),
				uncommittedMonthly: candidates.filter((row) => row.commitment === "Uncommitted").reduce((sum, row) => sum + (row.monthly ?? 0), 0),
				noPipeline: accountOpportunities.length + accountMilestones.length === 0,
				noInQuarterPipeline: !open.some((row) => row.timing === "in-quarter") && candidates.length === 0
			},
			nextAction: input.tpid === "1000005" ? "No recorded pipeline in the complete accessible sample scope. Resolve missing database actuals and qualify a new customer play." : "Validate incremental credit, production timing and dependencies with the milestone owner."
		};
	});
	return sellerDashboardSnapshotSchema.parse({
		contractVersion: "1.0",
		kind: "snapshot",
		mode: "sample",
		state: "ready",
		message: "Synthetic sample only. No seller, customer, earnings or pipeline data was copied from the reference report.",
		report: {
			schemaVersion: 1,
			generatedAt,
			plan: {
				currency: "USD",
				unit: "USD",
				fiscalYear: 2027,
				sourceUnitsVerified: true,
				metricMapping: metricInputs.map((row) => ({
					metric: row.name,
					bucket: row.bucket,
					hintSupported: true,
					state: "Optional tentative hints only",
					scenarioAllowed: true
				})),
				unmappedProductionCandidates: 0
			},
			period: {
				label: "FY27 Q2 official YTD period",
				start: "2026-07-01",
				end,
				today: asOf
			},
			sources: {
				earnings: {
					status: "live",
					generatedAt,
					refreshedAt: "2026-10-09T09:00:00.000Z",
					months: [
						"July, 2026",
						"August, 2026",
						"September, 2026",
						"October, 2026",
						"November, 2026",
						"December, 2026"
					],
					ageDays: 1
				},
				pipeline: {
					status: "complete",
					asOf: generatedAt,
					errors: []
				},
				quota: {
					name: "Synthetic Quota by Accounts fixture",
					rows: 90,
					accounts: accounts.length
				}
			},
			warnings: [
				"Adventure Works Cycles has missing database actuals; unknown is not zero.",
				"Opportunity nominal value, monthly consumption and period earnings credit have different units.",
				"Workload mappings are tentative. No pipeline amount is certified as incremental earnings credit."
			],
			official: {
				weightedAttainment: 78,
				closedMonthAttainment: 85.2,
				closedThrough: "September, 2026",
				buckets: metrics.map((row, index) => ({
					name: row.bucket,
					weight: metricInputs[index]?.weight,
					unit: "USD",
					attainment: row.attainment,
					actual: row.actual,
					quota: row.quota,
					recurring: row.recurring,
					calcActual: row.calcActual,
					calcQuota: row.calcQuota,
					gap: row.gap
				})),
				metrics
			},
			accounts,
			opportunities,
			milestones,
			coverage: metrics.map((metric) => {
				const candidates = milestones.filter((row) => row.active && row.category === "Production" && row.timing === "in-quarter" && row.metricCandidates.includes(metric.name));
				return {
					metric: metric.name,
					bucket: metric.bucket,
					gap: metric.gap,
					candidateCount: candidates.length,
					committedMonthly: candidates.filter((row) => row.commitment === "Committed").reduce((sum, row) => sum + (row.monthly ?? 0), 0),
					uncommittedMonthly: candidates.filter((row) => row.commitment === "Uncommitted").reduce((sum, row) => sum + (row.monthly ?? 0), 0),
					verifiedPeriodCredit: null,
					state: "Needs credit validation",
					mappingSupported: true,
					mappingReviewRequired: false,
					scenarioAllowed: true,
					scenarioCommittedCredit: null,
					scenarioUncommittedCredit: null,
					scenarioRemainingGap: null,
					nextAction: "Confirm metric mapping, incremental production credit and the remaining-period ramp."
				};
			}),
			actions: accounts.map((account) => ({
				account: account.name,
				tpid: account.tpid,
				metric: "ACR - Core",
				priority: account.pipeline.noPipeline ? "High" : "Medium",
				issue: account.pipeline.noPipeline ? "No recorded pipeline" : "Credit and timing need validation",
				action: account.nextAction,
				owner: "Account team"
			})),
			methodology: [
				"Official weighted attainment and bucket scores are source-reported, never reconstructed from gross consumption.",
				"Posted gap is max(calculated quota minus signed calculated actual, zero). Ordinary earnings still to post are included.",
				"Account gaps net selected quota and actuals before clamping; overlapping buckets remain separate.",
				"Remaining-period candidates are active positive USD production milestones from the as-of date through period end, inclusive.",
				"Monthly run-rate and nominal opportunity value are not verified period earnings credit.",
				"All data in this sample is fictitious. Live mode requires the current seller’s own validated quota export and authorized sources."
			]
		},
		supplement: {
			schemaVersion: 1,
			consumption: {
				source: {
					name: "Synthetic Fabric consumption",
					status: "complete",
					asOf: generatedAt,
					start: "2026-10-01",
					end: "2026-10-31",
					detail: "Posted monthly consumption and illustrative calendar-day landing are separate from compensation attainment."
				},
				accounts: accountInputs.map((account, index) => {
					const actual = [
						216e3,
						153e3,
						189e3,
						81e3,
						36e3
					][index];
					if (actual === void 0) throw new Error("Incomplete synthetic consumption.");
					return {
						tpid: account.tpid,
						actual,
						previousActual: actual * [
							.9,
							1.12,
							.85,
							1.2,
							1.4
						][index],
						averageDaily: actual / 9,
						projected: actual / 9 * 31,
						daysPosted: 9,
						pillars: [
							{
								name: "Infrastructure",
								actual: actual * .4
							},
							{
								name: "Databases",
								actual: actual * .3
							},
							{
								name: "Analytics",
								actual: actual * .2
							},
							{
								name: "AI",
								actual: actual * .1
							}
						]
					};
				}),
				services: accountInputs.flatMap((account, index) => [{
					id: `sample-service-${index}-1`,
					tpid: account.tpid,
					name: "Azure SQL Database",
					pillar: "Databases",
					previousDaily: 5200 + index * 100,
					currentDaily: 6400 - index * 700,
					isNew: false
				}, {
					id: `sample-service-${index}-2`,
					tpid: account.tpid,
					name: "Microsoft Fabric",
					pillar: "Analytics",
					previousDaily: 0,
					currentDaily: 1800 + index * 100,
					isNew: true
				}]),
				subscriptions: [{
					id: "sample-subscription-1",
					tpid: "1000001",
					name: "Grid production analytics",
					created: "2026-10-03",
					averageDaily: 1200
				}, {
					id: "sample-subscription-2",
					tpid: "1000002",
					name: "Retail data innovation",
					created: "2026-10-07",
					averageDaily: 850
				}],
				sqlReclassification: [{
					id: "sample-sql-1",
					tpid: "1000002",
					workload: "Arc-enabled SQL inventory",
					monthlyOpportunity: 4200,
					evidence: "Synthetic validated inventory; licensing and credit eligibility require review."
				}]
			},
			conversion: {
				source: {
					name: "Synthetic U2C history",
					status: "complete",
					asOf: generatedAt,
					start: "2026-10-01",
					end,
					detail: "Historical starting cohort, conversion events and shifted-out dates; not inferred from today’s commitment state."
				},
				accounts: accountInputs.map((account, index) => ({
					tpid: account.tpid,
					territory: "Sample territory",
					startingMonthly: 1e5 - index * 1e4,
					convertedMonthly: 42e3 - index * 6e3,
					inQuarterMonthly: 35e3 - index * 5e3,
					shiftedOutMonthly: 7e3 - index * 1e3,
					startingCount: 10 - index,
					convertedCount: 5 - index
				}))
			}
		}
	});
}
//#endregion
//#region ../../packages/connectors/common/seller-dashboard.ts
var SellerDashboardSourceError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "SellerDashboardSourceError";
	}
};
var collectorBridge = `
import contextlib, io, json, pathlib, sys
root, profile, action, as_of = sys.argv[1:5]
sys.path.insert(0, str(pathlib.Path(root) / "scripts"))
try:
    from dashboard_config import load_state
    result = 0
    if action == "refresh":
        from manager_runner import main
        arguments = ["--refresh", "--profile", profile]
        if as_of:
            arguments.extend(["--as-of", as_of])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = main(arguments)
    state = load_state(profile)
    if not state.get("dashboard"):
        raise ValueError("No successful dashboard")
    status = state.get("lastRun", {}).get("status")
    print(json.dumps({
        "report": state["dashboard"],
        "supplement": state.get("sellerDashboardSupplement"),
        "stale": result != 0 or status in ("failed", "setup-pending-refresh")
    }, ensure_ascii=True, allow_nan=False))
except (OSError, ValueError, KeyError, TypeError, ImportError):
    print("The protected seller profile could not be loaded. Complete setup and a successful manual refresh.", file=sys.stderr)
    sys.exit(2)
`.trim();
var isolatedCollectorBridge = `
import ctypes, subprocess, sys, threading
from ctypes import wintypes

class BasicLimits(ctypes.Structure):
    _fields_ = [
        ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
        ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
        ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD)
    ]

class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "read_operations", "write_operations", "other_operations",
        "read_bytes", "write_bytes", "other_bytes"
    )]

class ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("basic", BasicLimits), ("io", IoCounters),
        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)
    ]

kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
kernel.CreateJobObjectW.restype = wintypes.HANDLE
kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
kernel.SetInformationJobObject.restype = wintypes.BOOL
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel.AssignProcessToJobObject.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
job = kernel.CreateJobObjectW(None, None)
worker = None
try:
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    limits.basic.flags = 0x00002000
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    code = ${JSON.stringify("import sys\nif sys.stdin.buffer.read(1) != b\"1\":\n    sys.exit(3)\n" + collectorBridge)}
    worker = subprocess.Popen(
        [sys.executable, "-B", "-c", code, *sys.argv[1:]],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW
    )
    process = kernel.OpenProcess(0x0101, False, worker.pid)
    try:
        if not process or not kernel.AssignProcessToJobObject(job, process):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        if process:
            kernel.CloseHandle(process)
    failures = []
    def pump(source, target):
        try:
            for chunk in iter(lambda: source.read(65536), b""):
                target.write(chunk)
                target.flush()
        except (OSError, ValueError) as error:
            failures.append(error)
            if worker.poll() is None:
                worker.terminate()
    threads = [
        threading.Thread(target=pump, args=(worker.stdout, sys.stdout.buffer), daemon=True),
        threading.Thread(target=pump, args=(worker.stderr, sys.stderr.buffer), daemon=True)
    ]
    for thread in threads:
        thread.start()
    # Collection starts only after job assignment; exit closes inherited child pipes.
    worker.stdin.write(b"1")
    worker.stdin.close()
    result = worker.wait()
    if not kernel.CloseHandle(job):
        raise ctypes.WinError(ctypes.get_last_error())
    job = None
    for thread in threads:
        thread.join()
    worker.stdout.close()
    worker.stderr.close()
    if failures:
        raise OSError("Collector output channel failed")
    sys.exit(result)
except OSError:
    if worker is not None and worker.poll() is None:
        worker.terminate()
        worker.communicate()
    print("Windows could not isolate the protected seller collector.", file=sys.stderr)
    sys.exit(2)
finally:
    if job:
        kernel.CloseHandle(job)
`.trim();
var runCollector = (command) => new Promise((resolve, reject) => {
	execFile(command.executable, command.args, {
		windowsHide: true,
		timeout: command.timeout,
		maxBuffer: 67108864,
		env: {
			...process.env,
			PYTHONDONTWRITEBYTECODE: "1"
		}
	}, (error, stdout) => {
		if (error) reject(new SellerDashboardSourceError("runtime-failed", "The protected seller collector failed or timed out. Verify Python, the trusted runtime, profile setup and authorized access."));
		else resolve(stdout);
	});
});
var WindowsSellerDashboardConnector = class {
	options;
	constructor(options) {
		this.options = options;
	}
	read() {
		return this.collect("get");
	}
	refresh(asOf) {
		return this.collect("refresh", asOf);
	}
	async collect(operation, asOf) {
		if ((this.options.platform ?? process.platform) !== "win32") throw new SellerDashboardSourceError("unsupported-platform", "The supplied collector requires Windows user encryption. Use a configured local Windows host; no live sample fallback is permitted.");
		const environment = this.options.environment ?? process.env;
		const root = environment["TLC_SELLER_DASHBOARD_SKILL_ROOT"]?.trim();
		const profile = environment["TLC_SELLER_DASHBOARD_PROFILE"]?.trim();
		const owner = environment["TLC_SELLER_DASHBOARD_OWNER_EMAIL"]?.trim().toLowerCase();
		if (!root || !isAbsolute(root) || root.split(/[\\/]/).includes("..") || !profile || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(profile) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(profile) || !owner || owner.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) throw new SellerDashboardSourceError("not-configured", "Configure a trusted skill root, an explicit profile and its owner email after onboarding with your own MSX Earnings Quota by Accounts CSV.");
		const user = (await this.options.resolveUserEmail())?.trim().toLowerCase();
		if (!user || user !== owner) throw new SellerDashboardSourceError("identity-mismatch", "The current authenticated seller does not match the configured earnings-profile owner. No private data was read.");
		try {
			await Promise.all([
				"dashboard_config.py",
				"manager_runner.py",
				"secure_dashboard.py"
			].map((file) => access(join(root, "scripts", file))));
		} catch (error) {
			if (error instanceof Error && "code" in error && [
				"ENOENT",
				"EACCES",
				"EPERM"
			].includes(String(error.code))) throw new SellerDashboardSourceError("not-configured", "The explicitly configured trusted dashboard runtime is unavailable.");
			throw error;
		}
		const output = await (this.options.run ?? runCollector)({
			executable: environment["TLC_SELLER_DASHBOARD_PYTHON"]?.trim() || "python",
			args: [
				"-B",
				"-c",
				isolatedCollectorBridge,
				root,
				profile,
				operation,
				asOf ?? ""
			],
			timeout: operation === "get" ? 3e4 : 48e4
		});
		let payload;
		try {
			payload = JSON.parse(output);
		} catch (error) {
			if (error instanceof SyntaxError) throw new SellerDashboardSourceError("invalid-snapshot", "The protected collector returned an invalid dashboard envelope.");
			throw error;
		}
		if (!payload || typeof payload !== "object" || !("report" in payload) || !("supplement" in payload) || !("stale" in payload) || typeof payload.stale !== "boolean") throw new SellerDashboardSourceError("invalid-snapshot", "The protected collector returned an unsupported dashboard envelope.");
		const parsed = sellerDashboardSnapshotSchema.safeParse({
			contractVersion: "1.0",
			kind: "snapshot",
			mode: "live",
			state: payload.stale ? "stale" : "ready",
			message: payload.stale ? "The last successful protected snapshot is retained. The latest refresh/setup did not establish current reconciled data." : "Read from this seller’s Windows-user-encrypted snapshot. Reloading this view performs no live source calls.",
			report: payload.report,
			supplement: payload.supplement
		});
		if (!parsed.success) throw new SellerDashboardSourceError("invalid-snapshot", "The protected dashboard failed schema or monetary reconciliation checks. Verify the supported USD plan and complete source data.");
		const snapshot = parsed.data;
		if (operation === "refresh" && !payload.stale && asOf && snapshot.report.period.today !== asOf) throw new SellerDashboardSourceError("invalid-snapshot", "The refreshed dashboard does not match the confirmed reporting date. No replacement data was accepted.");
		const refreshedAt = snapshot.report.sources.earnings.refreshedAt;
		const now = (this.options.now ?? (() => /* @__PURE__ */ new Date()))();
		const ageMs = refreshedAt ? now.getTime() - Date.parse(refreshedAt) : Infinity;
		const asOfAgeMs = Date.parse(now.toISOString().slice(0, 10)) - Date.parse(snapshot.report.period.today);
		if (snapshot.report.sources.earnings.status === "stale" || ageMs > 1728e5 || asOfAgeMs > 1728e5) {
			snapshot.state = "stale";
			snapshot.message = "Official earnings are stale or undated. The displayed source timestamps are unchanged; reload does not refresh source data.";
		}
		return snapshot;
	}
};
//#endregion
//#region ../../packages/orchestrator/seller-dashboard.ts
var SharedSellerDashboardHost = class {
	connector;
	constructor(connector) {
		this.connector = connector;
	}
	async invoke(rawRequest) {
		const request = sellerDashboardRequestSchema.parse(rawRequest);
		try {
			const result = request.operation === "get" ? await this.connector.read() : await this.connector.refresh(request.asOf);
			return sellerDashboardResponseSchema.parse(result);
		} catch (error) {
			if (!(error instanceof SellerDashboardSourceError)) throw error;
			return sellerDashboardResponseSchema.parse({
				contractVersion: "1.0",
				kind: "unavailable",
				mode: "live",
				code: error.code,
				message: error.message
			});
		}
	}
};
function createSellerDashboardHost(options) {
	if (options.mode === "sample") return new SharedSellerDashboardHost({
		read: async () => createSampleSellerDashboard(),
		refresh: async () => createSampleSellerDashboard()
	});
	if (options.allowLocalProfile === false) {
		const denied = async () => {
			throw new SellerDashboardSourceError("hosted-profile-denied", "Web cannot read a host user’s private earnings profile without HTTP caller authentication bound to the seller identity. Use a configured Desktop or local VS Code host.");
		};
		return new SharedSellerDashboardHost({
			read: denied,
			refresh: denied
		});
	}
	return new SharedSellerDashboardHost(new WindowsSellerDashboardConnector(options));
}
//#endregion
//#region ../../packages/orchestrator/application-runtime.ts
function assemble(msx, guidance, agents, recordCreation, meetings, workflows, sellerDashboard, source, dispose, refreshSource = () => {}) {
	return {
		orchestrator: new ThinSliceOrchestrator(msx, guidance, agents, void 0, recordCreation),
		meetings,
		workflows,
		sellerDashboard,
		dispose,
		workflowScopes: /* @__PURE__ */ new Map(),
		...source,
		refreshSource,
		withReviewedVersions: (before, operation) => {
			const versions = before && typeof before === "object" && "revisionTokens" in before ? z.record(z.string(), z.string()).parse(before.revisionTokens) : {};
			return msx.withExpectedVersions ? msx.withExpectedVersions(versions, operation) : operation();
		},
		proposeTranscript: (opportunityId, transcript) => meetings.proposeMeetingChangeSet({
			opportunityId,
			transcript
		})
	};
}
async function createSampleApplicationServices(options = {}) {
	const store = new LocalStore(options.dataPath ? { path: options.dataPath } : {});
	const msx = new LocalStoreMsxConnector(store);
	const writer = msx.createRecordCreationWriter();
	const workflows = createSampleWorkflowHost(async () => {
		const accounts = await msx.listAccounts();
		const opportunities = (await Promise.all(accounts.map((account) => msx.listOpportunities(account.id)))).flat();
		return {
			accountIds: accounts.map((account) => account.id),
			opportunityIds: opportunities.map((opportunity) => opportunity.id)
		};
	});
	return assemble(msx, new LocalPdfMcemGuidanceConnector(resolve(options.workingDirectory ?? process.cwd(), "docs/knowledge/MCEM Overview.pdf")), createSampleTaskAgents(), new RecordCreationService(msx, writer, { writer }), msx, workflows, createSellerDashboardHost({
		mode: "sample",
		resolveUserEmail: async () => void 0
	}), {
		listTranscriptSources: (opportunityId) => msx.listMeetingTranscripts(opportunityId),
		resolveMeeting: async () => {
			throw new Error("Sample mode uses the bundled transcript picker, not a live meeting URL.");
		},
		acquireTranscripts: async (request) => {
			const transcript = await msx.getMeetingTranscript(request.meetingId);
			if (!transcript || transcript.opportunityId !== request.opportunityId) return {
				state: "waiting",
				meetingId: request.meetingId,
				transcripts: [],
				attribution: "unknown",
				contentVersions: {}
			};
			return {
				state: "ready",
				meetingId: request.meetingId,
				transcripts: [{
					...transcript,
					meetingType: request.meetingType
				}],
				attribution: transcript.segments.some((segment) => segment.speaker) ? "attributed" : "unattributed",
				contentVersions: { [transcript.id]: createHash("sha256").update(JSON.stringify(transcript)).digest("hex") }
			};
		}
	}, async () => {
		store.close();
	});
}
async function createLiveApplicationServices(options) {
	const root = options.workingDirectory ?? process.cwd();
	const guidanceMode = options.guidanceMode ?? "foundry";
	if (guidanceMode === "foundry" && !options.foundryCredential) throw new Error("Foundry guidance requires its own configured credential.");
	const [foundry, registry, policy, entityMap] = await Promise.all([
		guidanceMode === "foundry" ? loadFoundryEnvironmentFromEnvironment(options.environment, root) : void 0,
		loadMcpServerRegistry(resolve(root, "config/mcp.servers.json")),
		loadMcpToolPolicy(resolve(root, "config/mcp.tool-policy.json")),
		loadDataverseEntityMap(resolve(root, "config/dataverse.entity-map.json"))
	]);
	const msx = new LiveMsxConnector({ getAccessToken: () => options.getToken("msx") }, options.fetchImplementation ?? fetch, `${options.msxResource}/api/data/v9.2/`, void 0, msxWriteMetadataFromEnvironment(options.environment), options.preferences, {
		cachePortfolio: false,
		requireConditionalWrites: true
	});
	if (registry.servers.some((server) => server.enabled && new URL(server.serverUrl).origin !== options.msxResource)) throw new Error("An enabled MCP server does not match the configured delegated MSX resource.");
	const configured = createLivePlayWorkflowHost({
		registry,
		policy,
		entityMap,
		getAccessToken: () => options.getToken("mcp"),
		resolveCurrentUserId: () => msx.getCurrentUserId(),
		resolveExcludedAccountIds: () => msx.listAccounts({ includeHidden: true }).then((accounts) => accounts.filter((account) => account.visibility === "hidden").map((account) => account.id))
	});
	const graph = new GraphMeetingConnector(() => options.getToken("graph"));
	return assemble(msx, new LocalPdfMcemGuidanceConnector(resolve(root, options.environment["TLC_MCEM_GUIDANCE_PATH"] ?? "docs/knowledge/MCEM Overview.pdf")), foundry && options.foundryCredential ? createFoundryTaskAgents(foundry, options.foundryCredential) : createDeterministicLiveTaskAgents(), new RecordCreationService(msx, msx), new LiveMeetingCaptureConnector(msx), configured.host, createSellerDashboardHost({
		mode: "live",
		allowLocalProfile: false,
		resolveUserEmail: async () => void 0
	}), {
		acquireTranscripts: (request) => graph.acquire(request),
		resolveMeeting: (url) => graph.resolveMeeting(url),
		listTranscriptSources: async () => {
			throw new Error("Live transcripts are discovered from the verified Graph meeting, not sample sources.");
		}
	}, configured.dispose, () => msx.refresh());
}
//#endregion
//#region src/credential-state.ts
var encryptedSchema = z.object({
	iv: z.string(),
	tag: z.string(),
	ciphertext: z.string(),
	expiresAt: z.number()
}).strict();
var EncryptedSdkState = class {
	store;
	partition;
	key;
	constructor(store, partition, key) {
		this.store = store;
		this.partition = partition;
		if (key.length !== 32) throw new Error("Bot credential-state encryption requires a 32-byte key.");
		this.key = Buffer.from(key);
	}
	address(key) {
		return createHash("sha256").update(key).digest("hex");
	}
	async get(key) {
		const row = await this.store.read(this.partition, this.address(key));
		if (!row || row.value === null) return void 0;
		const encrypted = encryptedSchema.parse(row.value);
		if (encrypted.expiresAt <= Date.now()) return void 0;
		const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encrypted.iv, "base64"));
		decipher.setAAD(Buffer.from(`${this.partition}:${this.address(key)}`));
		decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
		return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8"));
	}
	async set(key, value) {
		const plaintext = JSON.stringify(value);
		if (!plaintext || Buffer.byteLength(plaintext) > 32e3) throw new Error("The bot credential-state size limit was exceeded.");
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		cipher.setAAD(Buffer.from(`${this.partition}:${this.address(key)}`));
		const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
		await this.write(key, {
			iv: iv.toString("base64"),
			tag: cipher.getAuthTag().toString("base64"),
			ciphertext: ciphertext.toString("base64"),
			expiresAt: Date.now() + 9e5
		});
	}
	async delete(key) {
		await this.write(key, null);
	}
	async write(key, value) {
		const address = this.address(key);
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.store.read(this.partition, address);
			if (row ? await this.store.replace(this.partition, address, row.revision, value) : await this.store.insert(this.partition, address, value)) return;
		}
		throw new Error("Concurrent bot credential-state update could not be persisted.");
	}
};
//#endregion
//#region src/bot-commands.ts
function assertActivityActor(principal, actor) {
	if (actor.userId !== principal.userId || actor.tenantId !== principal.tenantId) throw new Error("The activity actor does not match the delegated API identity.");
}
async function routeTeamsCommand(request, services, origin) {
	const destination = new URL(origin);
	if (destination.protocol !== "https:") throw new Error("Teams conversational links require HTTPS.");
	const handoff = {
		text: "Open your private TLC Assist workbench to sign in and review business information or source changes.",
		openUrl: `${destination.origin}/`
	};
	if (request.conversationType !== "personal") return handoff;
	requireRole(request.principal, "TLC.Teams.User");
	const [command, argument, ...remaining] = z.string().trim().max(1e3).parse(request.text).split(/\s+/);
	if (command?.toLowerCase() === "accounts") {
		const accounts = await services.orchestrator.listAccounts();
		return {
			text: accounts.length ? `Your accessible accounts:\n${accounts.slice(0, 20).map((account) => account.name).join("\n")}${accounts.length > 20 ? "\nOpen the workbench for the remaining accounts." : ""}` : "No accounts are visible in your portfolio.",
			openUrl: handoff.openUrl
		};
	}
	if (command?.toLowerCase() === "workflow" && /^WF-\d{3}$/.test(argument ?? "")) {
		const run = workflowRunSchema.parse(await createApplicationOperations(services).invoke("workflows.start", {
			contractVersion: "1.0",
			workflowId: argument,
			scope: { kind: "portfolio" },
			input: { asOf: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }
		}));
		return {
			text: `Play accepted: ${run.runId}. Open Plays for progress, evidence and source health.`,
			openUrl: `${destination.origin}/?view=plays&runId=${encodeURIComponent(run.runId)}`
		};
	}
	if (command?.toLowerCase() === "status" && argument) {
		const view = services.workflows.get({
			contractVersion: "1.0",
			runId: argument
		});
		return {
			text: `Play ${view.run.status}${view.run.state ? ` (${view.run.state})` : ""}.`,
			openUrl: `${destination.origin}/?view=plays&runId=${encodeURIComponent(view.run.runId)}`
		};
	}
	if (command?.toLowerCase() === "ask") {
		const capability = agentCapabilitySchema.parse(argument);
		const opportunityId = remaining.shift();
		if (!opportunityId || !remaining.length) throw new Error("Use: ask <capability> <opportunity-id> <question>.");
		const snapshot = await services.orchestrator.getOpportunitySnapshot(opportunityId);
		const result = await services.orchestrator.runAgentTask({
			contractVersion: "1.2",
			capability,
			accountId: snapshot.account.id,
			opportunityId,
			prompt: remaining.join(" ")
		});
		return {
			text: `${result.state} guidance:\n${result.content.slice(0, 2500)}\nOpen TLC Assist for complete evidence and source health.`,
			openUrl: handoff.openUrl
		};
	}
	return {
		text: "Use accounts, workflow WF-001, status <run-id>, or ask <capability> <opportunity-id> <question>. All source changes require private review in TLC Assist.",
		openUrl: handoff.openUrl
	};
}
//#endregion
//#region src/installation-lifecycle.ts
var activitySchema = z.object({
	tenantId: z.uuid(),
	userId: z.uuid().optional(),
	conversationId: z.string().min(1).max(500),
	conversationType: z.string().min(1).max(50),
	channelId: z.string().min(1).max(500).optional(),
	teamId: z.string().min(1).max(500).optional(),
	timestamp: z.union([z.iso.datetime(), z.date()]).optional()
}).strict();
var referenceSchema = z.object({
	conversationId: z.string(),
	disabled: z.boolean(),
	installationEventAt: z.iso.datetime().optional()
}).passthrough();
async function updateVerifiedTeamsInstallation(options, raw, action) {
	const activity = activitySchema.parse(raw);
	if (activity.tenantId.toLowerCase() !== options.scope.tenantId.toLowerCase()) throw new Error("The installation tenant is not authorized.");
	const partition = `${options.scope.tenantId}:${options.scope.environmentId}:delivery`;
	let userId = activity.userId;
	if (activity.conversationType === "personal" && !userId) {
		const owner = await options.store.read(partition, `conversation-owner:${activity.conversationId}`);
		if (owner) userId = z.object({ userId: z.uuid() }).strict().parse(owner.value).userId;
		if (!userId) throw new Error("The personal installation owner could not be verified.");
	}
	const key = activity.conversationType === "personal" ? `personal:${userId}` : activity.teamId ? `team:${activity.teamId}` : activity.channelId ? `channel:${activity.channelId}` : `chat:${activity.conversationId}`;
	const eventAt = activity.timestamp instanceof Date ? activity.timestamp.toISOString() : activity.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
	const eventTime = Date.parse(eventAt);
	for (let attempt = 0; attempt < 5; attempt++) {
		const row = await options.store.read(partition, key);
		const previous = row ? referenceSchema.parse(row.value) : void 0;
		if (previous?.installationEventAt && (Date.parse(previous.installationEventAt) > eventTime || Date.parse(previous.installationEventAt) === eventTime && previous.disabled && action === "add")) return;
		if (action === "remove" && previous && !previous.installationEventAt && previous.conversationId !== activity.conversationId) return;
		const value = {
			...previous,
			conversationId: activity.conversationId,
			disabled: action === "remove",
			installationEventAt: eventAt
		};
		if (!(row ? await options.store.replace(partition, key, row.revision, value) : await options.store.insert(partition, key, value))) continue;
		if (action === "remove" && activity.conversationType === "personal" && userId) {
			const identity = {
				...options.scope,
				userId
			};
			await new CollaborationLifecycle(options.store).deactivate(identity);
			await options.onDeactivate?.(identity);
		}
		return;
	}
	throw new Error("The installation state changed concurrently. Its outcome requires reconciliation.");
}
//#endregion
//#region src/bot.ts
var RedactedLogger = class {
	debug() {}
	trace() {}
	info() {}
	warn() {
		console.warn("[teams-sdk] warning");
	}
	error() {
		console.error("[teams-sdk] operation_failed");
	}
	log(level) {
		if (level === "error") this.error();
		else if (level === "warn") this.warn();
	}
	child() {
		return this;
	}
};
async function registerTeamsBot(options) {
	const { configuration, store } = options;
	const authenticate = createTeamsAuthenticator(configuration);
	const lifecycle = new CollaborationLifecycle(store, options.acceptNewWork ?? true);
	const credentialState = new EncryptedSdkState(store, `${configuration.tenantId}:${configuration.environmentId}:bot-credentials`, options.stateKey);
	const bot = new App({
		clientId: configuration.botClientId,
		clientSecret: configuration.botCredential,
		tenantId: configuration.tenantId,
		applicationIdUri: `api://botid-${configuration.botClientId}`,
		httpServerAdapter: new ExpressAdapter(options.web, { logger: new RedactedLogger() }),
		dangerouslyAllowUnauthenticatedRequests: false,
		telemetry: { agent365: false },
		storage: credentialState,
		state: { storage: {
			get: async (key) => {
				const value = await credentialState.get(key);
				return value === void 0 ? void 0 : z.string().parse(value);
			},
			set: (key, value) => credentialState.set(key, value),
			delete: (key) => credentialState.delete(key)
		} },
		logger: new RedactedLogger()
	});
	const flow = bot.addOAuthFlow("tlc-api", {
		oauthCardText: "Sign in to TLC Assist with your authorized corporate FTE account.",
		signInButtonText: "Sign in to TLC Assist"
	});
	const deliveryPartition = `${configuration.tenantId}:${configuration.environmentId}:delivery`;
	async function saveReference(key, conversationId, teamId) {
		const row = await store.read(deliveryPartition, key);
		const previous = row ? z.object({
			disabled: z.boolean(),
			installationEventAt: z.string().optional()
		}).passthrough().parse(row.value) : void 0;
		const value = {
			...previous,
			conversationId,
			disabled: previous?.disabled ?? false,
			...teamId ? { teamId } : {}
		};
		if (row ? !await store.replace(deliveryPartition, key, row.revision, value) : !await store.insert(deliveryPartition, key, value)) throw new Error("The verified conversation reference changed concurrently.");
	}
	async function installation(context, action) {
		try {
			await updateVerifiedTeamsInstallation({
				store,
				scope: {
					tenantId: configuration.tenantId,
					environmentId: configuration.environmentId
				},
				...options.onDeactivate ? { onDeactivate: options.onDeactivate } : {}
			}, {
				tenantId: context.activity.channelData?.tenant?.id,
				userId: context.activity.from.aadObjectId,
				conversationType: context.activity.conversation.conversationType,
				conversationId: context.activity.conversation.id,
				channelId: context.activity.channelData?.channel?.id,
				teamId: context.activity.channelData?.team?.id,
				timestamp: context.activity.timestamp
			}, action);
			if (action === "remove" && context.activity.conversation.conversationType === "personal") await flow.signOut(context);
		} catch (error) {
			console.error("[teams-installation] lifecycle_change_unconfirmed");
			throw error;
		}
	}
	bot.on("install.add", (context) => installation(context, "add"));
	bot.on("install.remove", (context) => installation(context, "remove"));
	bot.on("message", async (context) => {
		if (context.activity.channelData?.tenant?.id !== configuration.tenantId) return;
		if (context.activity.conversation.conversationType !== "personal") {
			const channelId = context.activity.channelData?.channel?.id;
			if (channelId) await saveReference(`channel:${channelId}`, context.activity.conversation.id, context.activity.channelData?.team?.id);
			else await saveReference(`chat:${context.activity.conversation.id}`, context.activity.conversation.id);
			await context.send({
				type: "message",
				textFormat: "plain",
				text: `Open your private TLC Assist workbench to sign in and review business information: ${configuration.origin}/`
			});
			return;
		}
		try {
			const assertion = await flow.signIn(context);
			if (!assertion) return;
			const principal = await authenticate(assertion);
			assertActivityActor(principal, {
				userId: context.activity.from.aadObjectId,
				tenantId: context.activity.channelData?.tenant?.id
			});
			if (context.activity.text?.trim().toLowerCase() === "signout") {
				await lifecycle.deactivate(principal);
				await options.onDeactivate?.(principal);
				await flow.signOut(context);
				await context.send({
					type: "message",
					textFormat: "plain",
					text: "Your TLC bot connection is signed out. This does not sign you out of Teams."
				});
				return;
			}
			await lifecycle.assertActive(principal);
			await new UserRequestBudget(store).consume(principal, "requests", 60);
			if (/^\s*(?:ask|workflow)\s/i.test(context.activity.text ?? "")) await new UserRequestBudget(store).consume(principal, "agent", 4);
			await saveReference(`personal:${principal.userId}`, context.activity.conversation.id);
			const ownerKey = `conversation-owner:${context.activity.conversation.id}`;
			const owner = await store.read(deliveryPartition, ownerKey);
			if (owner ? !await store.replace(deliveryPartition, ownerKey, owner.revision, { userId: principal.userId }) : !await store.insert(deliveryPartition, ownerKey, { userId: principal.userId })) throw new Error("The conversation owner changed concurrently.");
			const services = await options.resolveServices(principal, assertion);
			const reply = await routeTeamsCommand({
				principal,
				conversationType: "personal",
				text: context.activity.text ?? "help"
			}, services, configuration.origin);
			const activity = new WorkflowActivityStore(store);
			for (const run of services.workflows.listRuns({
				contractVersion: "1.0",
				limit: 20
			})) await activity.record(principal, run);
			await context.send({
				type: "message",
				textFormat: "plain",
				text: `${reply.text}\n${reply.openUrl}`
			});
			await notify(principal);
		} catch {
			console.error("[teams-bot] delegated_operation_failed");
			await context.send({
				type: "message",
				textFormat: "plain",
				text: `TLC could not authorize or complete this request. Open your private workbench for connection status: ${configuration.origin}/`
			});
		}
	});
	flow.onSignInComplete(async (context) => {
		await context.send({
			type: "message",
			textFormat: "plain",
			text: "Sign-in completed. Send your TLC request again; source permissions are checked for that request."
		});
	});
	flow.onSignInFailure(async (context) => {
		await context.send({
			type: "message",
			textFormat: "plain",
			text: "TLC sign-in did not complete. Your tenant consent and FTE assignment may require administrator review."
		});
	});
	bot.on("message.ext.query", async (context) => {
		const handoff = { composeExtension: {
			type: "result",
			attachmentLayout: "list",
			attachments: [{
				contentType: "application/vnd.microsoft.card.hero",
				content: {
					title: "TLC Assist",
					text: "Open the private workbench to sign in or prepare an approved shared summary.",
					buttons: [{
						type: "openUrl",
						title: "Open private Portfolio",
						value: configuration.origin
					}]
				}
			}]
		} };
		if (context.activity.channelData?.tenant?.id !== configuration.tenantId) return handoff;
		try {
			const assertion = await flow.getToken(context);
			if (!assertion) return handoff;
			const principal = await authenticate(assertion);
			assertActivityActor(principal, {
				userId: context.activity.from.aadObjectId,
				tenantId: context.activity.channelData?.tenant?.id
			});
			await new UserRequestBudget(store).consume(principal, "requests", 60);
			const parameter = context.activity.value.parameters?.find((item) => item.name === "search");
			await lifecycle.assertReadable(principal);
			const query = z.string().trim().min(2).max(100).parse(parameter?.value);
			const candidates = await (await options.resolveServices(principal, assertion)).orchestrator.searchAccounts({
				query,
				matchBy: "name"
			});
			const attachments = [];
			for (const candidate of candidates.slice(0, 10)) {
				const referenceId = randomUUID();
				if (!await store.insert(principalPartition(principal), `reference:${referenceId}`, {
					accountId: candidate.id,
					query
				})) throw new Error("The private account reference could not be saved.");
				attachments.push({
					contentType: "application/vnd.microsoft.card.hero",
					content: {
						title: "Private TLC account reference",
						text: "Sign in to view with your own source permissions.",
						buttons: [{
							type: "openUrl",
							title: "Open in private Portfolio",
							value: `${configuration.origin}/?referenceId=${encodeURIComponent(referenceId)}`
						}]
					},
					preview: {
						contentType: "application/vnd.microsoft.card.thumbnail",
						content: {
							title: candidate.name,
							text: "Private search result. Insertion shares an authenticated link, not this account data."
						}
					}
				});
			}
			return { composeExtension: {
				type: "result",
				attachmentLayout: "list",
				attachments
			} };
		} catch {
			console.error("[teams-message-extension] authorization_or_query_failed");
			return handoff;
		}
	});
	bot.event("error", () => {
		console.error("[teams-sdk] activity_failed");
	});
	await bot.initialize();
	async function notify(principal) {
		if (!(await lifecycle.status(principal)).acceptingNewWork) return;
		const row = await store.read(deliveryPartition, `personal:${principal.userId}`);
		if (!row) return;
		const reference = z.object({
			conversationId: z.string(),
			disabled: z.boolean()
		}).parse(row.value);
		if (reference.disabled) return;
		await new NotificationOutbox(store).deliver(principal, async (notification) => {
			await lifecycle.assertActive(principal);
			await bot.send(reference.conversationId, {
				type: "message",
				textFormat: "plain",
				text: `${notification.title}. Open your private Activity view: ${configuration.origin}/?view=activity`
			});
		});
	}
	return {
		bot,
		notify,
		async deliverPublication(_principal, binding, projection) {
			await lifecycle.assertActive(_principal);
			const row = await store.read(deliveryPartition, `${binding.kind}:${binding.contextId}`);
			if (!row) throw new Error("The bot must be installed and receive an activity in the approved context before publication.");
			const reference = z.object({
				conversationId: z.string(),
				disabled: z.boolean(),
				teamId: z.string().optional()
			}).parse(row.value);
			if (reference.disabled) throw new Error("The Teams delivery context is disabled.");
			if (reference.teamId) {
				const team = await store.read(deliveryPartition, `team:${reference.teamId}`);
				if (team && z.object({ disabled: z.boolean() }).parse(team.value).disabled) throw new Error("The destination installation was removed.");
			}
			return { messageId: (await bot.send(reference.conversationId, {
				type: "message",
				textFormat: "plain",
				text: `${projection.title}\n${projection.text}\nReviewed snapshot. Source permissions apply to live details: ${configuration.origin}/`
			})).id };
		}
	};
}
//#endregion
//#region ../../packages/connectors/graph/subscriptions.ts
var subscriptionSchema = z.object({
	id: z.uuid(),
	expirationDateTime: z.iso.datetime()
});
var GraphSubscriptionConnector = class {
	origin;
	getToken;
	fetcher;
	constructor(origin, getToken, fetcher = fetch) {
		this.origin = origin;
		this.getToken = getToken;
		this.fetcher = fetcher;
		const url = new URL(origin);
		if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Graph notifications require an exact HTTPS callback origin.");
	}
	async create(meetingId, clientState) {
		if (!meetingId || /[/:\\?#\r\n]/.test(meetingId)) throw new Error("A verified Graph meeting identity is required.");
		return this.request("POST", "/subscriptions", {
			changeType: "created",
			notificationUrl: `${this.origin}/api/teams/graph/notifications`,
			lifecycleNotificationUrl: `${this.origin}/api/teams/graph/notifications`,
			resource: `communications/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
			includeResourceData: false,
			expirationDateTime: new Date(Date.now() + 3e6).toISOString(),
			clientState
		});
	}
	async renew(subscriptionId) {
		return this.request("PATCH", `/subscriptions/${z.uuid().parse(subscriptionId)}`, { expirationDateTime: new Date(Date.now() + 3e6).toISOString() });
	}
	async stop(subscriptionId) {
		const token = await this.getToken();
		const response = await this.fetcher(`https://graph.microsoft.com/v1.0/subscriptions/${z.uuid().parse(subscriptionId)}`, {
			method: "DELETE",
			redirect: "error",
			signal: AbortSignal.timeout(3e4),
			headers: { authorization: `Bearer ${token}` }
		});
		if (!response.ok && response.status !== 404) throw new Error("Subscription cleanup is unconfirmed.");
	}
	async request(method, path, body) {
		const token = await this.getToken();
		if (!token) throw new Error("Current delegated Graph authorization is required for subscription changes.");
		const response = await this.fetcher(`https://graph.microsoft.com/v1.0${path}`, {
			method,
			redirect: "error",
			signal: AbortSignal.timeout(3e4),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json"
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new Error("Graph transcript notifications are unavailable under the current permission or tenant policy.");
		return subscriptionSchema.parse(JSON.parse(await readBoundedText(response, 64e3)));
	}
};
//#endregion
//#region ../../packages/orchestrator/collaboration/transcript-events.ts
var ownerSchema = z.object({
	partition: z.string(),
	userId: z.string(),
	tenantId: z.string(),
	environmentId: z.string()
}).strict();
var subscriptionRecord = z.object({
	id: z.uuid(),
	owner: ownerSchema,
	request: meetingAcquisitionRequestSchema,
	clientStateHash: z.string(),
	expiresAt: z.iso.datetime(),
	disabled: z.boolean(),
	generation: z.number().int().nonnegative().default(0)
}).strict();
var hintSchema = z.object({
	request: meetingAcquisitionRequestSchema,
	subscriptionId: z.uuid(),
	state: z.enum([
		"pending",
		"processing",
		"processed",
		"auth-required"
	]),
	generation: z.number().int().nonnegative().default(0)
}).strict();
var TranscriptEventService = class {
	store;
	scope;
	connector;
	available;
	partition;
	constructor(store, scope, connector, available) {
		this.store = store;
		this.scope = scope;
		this.connector = connector;
		this.available = available;
		this.partition = `${scope.tenantId}:${scope.environmentId}:graph-subscriptions`;
	}
	key(request) {
		return `subscription-intent:${createHash("sha256").update(canonicalJson(request)).digest("hex")}`;
	}
	check(principal) {
		requireRole(principal, "TLC.Teams.User");
		if (principal.tenantId !== this.scope.tenantId || principal.environmentId !== this.scope.environmentId) throw new Error("The subscription tenant or environment is not authorized.");
	}
	async ensure(principal, raw) {
		this.check(principal);
		const admission = await new CollaborationLifecycle(this.store).assertActive(principal);
		const request = meetingAcquisitionRequestSchema.parse(raw);
		const key = this.key(request);
		const partition = principalPartition(principal);
		const intent = await this.store.read(partition, key);
		if (intent) {
			const existing = z.object({
				state: z.string(),
				id: z.string().optional()
			}).parse(intent.value);
			if (existing.state !== "active" || !existing.id) return {
				state: "unconfirmed",
				detail: "Subscription outcome is unconfirmed or inactive. Foreground transcript discovery remains available; no create is repeated."
			};
			const row = await this.store.read(this.partition, existing.id);
			if (!row) throw new Error("Subscription metadata is unavailable.");
			const record = subscriptionRecord.parse(row.value);
			if (record.owner.partition !== partition) throw new Error("The subscription owner is not authorized.");
			if (record.disabled) return {
				state: "foreground-only",
				detail: "Background acquisition is stopped for this meeting."
			};
			if (record.generation === admission.generation && Date.parse(record.expiresAt) > Date.now() + 3e5) return {
				state: "active",
				detail: "Delegated per-meeting notifications are active."
			};
			if (!await this.store.replace(partition, key, intent.revision, {
				state: "renewing",
				id: record.id
			})) return {
				state: "unconfirmed",
				detail: "Another request is renewing this subscription."
			};
			try {
				const renewed = await this.connector(principal).renew(record.id);
				if (!await this.store.replace(this.partition, record.id, row.revision, {
					...record,
					generation: admission.generation,
					expiresAt: renewed.expirationDateTime
				})) throw new Error("Subscription renewal metadata changed.");
				if (!await this.store.replace(partition, key, intent.revision + 1, {
					state: "active",
					id: record.id
				})) throw new Error("Subscription renewal intent changed concurrently.");
				return {
					state: "active",
					detail: "Delegated subscription renewed."
				};
			} catch {
				return {
					state: "unconfirmed",
					detail: "Subscription renewal is unconfirmed. No external write is retried automatically."
				};
			}
		}
		if ((await this.store.list(partition, "subscription-intent:", 21)).length >= 20) return {
			state: "foreground-only",
			detail: "The per-user background meeting limit was reached."
		};
		if (!await this.store.insert(partition, key, { state: "creating" })) return {
			state: "unconfirmed",
			detail: "Another request owns subscription creation."
		};
		const clientState = randomBytes(32).toString("base64url");
		try {
			const created = await this.connector(principal).create(request.meetingId, clientState);
			const record = subscriptionRecord.parse({
				id: created.id,
				owner: {
					partition,
					userId: principal.userId,
					tenantId: principal.tenantId,
					environmentId: principal.environmentId
				},
				request,
				clientStateHash: createHash("sha256").update(clientState).digest("hex"),
				expiresAt: created.expirationDateTime,
				disabled: false,
				generation: admission.generation
			});
			if (!await this.store.insert(this.partition, created.id, record)) throw new Error("Subscription identity was already recorded.");
			if (!await this.store.replace(partition, key, 1, {
				state: "active",
				id: created.id
			})) throw new Error("Subscription intent changed concurrently.");
			return {
				state: "active",
				detail: "Delegated per-meeting notifications are active."
			};
		} catch {
			return {
				state: "unconfirmed",
				detail: "Subscription creation is unconfirmed or rejected. Foreground discovery remains available; no external create is repeated."
			};
		}
	}
	async maintain(principal) {
		this.check(principal);
		const admission = await new CollaborationLifecycle(this.store).status(principal);
		if (!admission.acceptingNewWork) return [];
		const partition = principalPartition(principal);
		const health = [];
		for (const intent of await this.store.list(partition, "subscription-intent:", 20)) {
			const value = z.object({
				state: z.string(),
				id: z.uuid().optional()
			}).parse(intent.value);
			if (value.state !== "active" || !value.id) continue;
			const row = await this.store.read(this.partition, value.id);
			if (!row) throw new Error("Subscription renewal metadata is unavailable.");
			const record = subscriptionRecord.parse(row.value);
			if (record.owner.partition !== partition) throw new Error("The subscription owner is not authorized.");
			if (record.disabled || record.generation !== admission.generation || Date.parse(record.expiresAt) > Date.now() + 3e5) continue;
			health.push(await this.ensure(principal, record.request));
		}
		return health;
	}
	async receive(raw) {
		const envelope = z.object({ value: z.array(z.object({
			subscriptionId: z.uuid(),
			clientState: z.string().min(1).max(128),
			resourceData: z.object({ id: z.string().max(500).optional() }).optional(),
			lifecycleEvent: z.string().optional()
		})).min(1).max(50) }).parse(raw);
		for (const event of envelope.value) {
			const row = await this.store.read(this.partition, event.subscriptionId);
			if (!row) throw new Error("The Graph notification is not authorized.");
			const record = subscriptionRecord.parse(row.value);
			const actual = createHash("sha256").update(event.clientState).digest();
			const expected = Buffer.from(record.clientStateHash, "hex");
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("The Graph notification is not authorized.");
			if (record.disabled || Date.parse(record.expiresAt) <= Date.now()) continue;
			const admission = await new CollaborationLifecycle(this.store).readIdentity(record.owner);
			if (!admission.acceptingNewWork || record.generation !== admission.generation) continue;
			const hintId = createHash("sha256").update(`${event.subscriptionId}:${record.generation}:${event.resourceData?.id ?? event.lifecycleEvent ?? "available"}`).digest("hex");
			await this.store.insert(record.owner.partition, `transcript-event:${hintId}`, {
				request: record.request,
				subscriptionId: record.id,
				state: "pending",
				generation: record.generation
			});
		}
	}
	async drain(principal) {
		this.check(principal);
		const admission = await new CollaborationLifecycle(this.store).status(principal);
		if (!admission.acceptingNewWork) return;
		const partition = principalPartition(principal);
		for (const row of await this.store.list(partition, "transcript-event:", 20)) {
			const hint = hintSchema.parse(row.value);
			if (hint.generation !== admission.generation) continue;
			if (!["pending", "auth-required"].includes(hint.state)) continue;
			const subscription = await this.store.read(this.partition, hint.subscriptionId);
			if (!subscription || subscriptionRecord.parse(subscription.value).disabled) continue;
			if (!await this.store.replace(partition, row.key, row.revision, {
				...hint,
				state: "processing"
			})) continue;
			let state;
			try {
				await new CollaborationLifecycle(this.store).assertGeneration(principal, hint.generation);
				await this.available(principal, hint.request, hint.generation, row.key);
				state = "processed";
			} catch {
				state = "auth-required";
			}
			if (!await this.store.replace(partition, row.key, row.revision + 1, {
				...hint,
				state
			})) throw new Error("Transcript notification processing could not be persisted.");
		}
	}
	async stop(principal, raw) {
		this.check(principal);
		const request = meetingAcquisitionRequestSchema.parse(raw);
		const intent = await this.store.read(principalPartition(principal), this.key(request));
		if (!intent) return {
			state: "foreground-only",
			detail: "No active subscription is registered."
		};
		const id = z.object({ id: z.uuid() }).parse(intent.value).id;
		const row = await this.store.read(this.partition, id);
		if (!row) throw new Error("Subscription metadata is unavailable.");
		const record = subscriptionRecord.parse(row.value);
		if (record.owner.partition !== principalPartition(principal)) throw new Error("The subscription owner is not authorized.");
		if (!await this.store.replace(this.partition, id, row.revision, {
			...record,
			disabled: true
		})) throw new Error("Subscription state changed concurrently.");
		try {
			await this.connector(principal).stop(id);
		} catch {
			return {
				state: "unconfirmed",
				detail: "Local background processing is stopped; remote subscription cleanup is unconfirmed and it will expire."
			};
		}
		return {
			state: "foreground-only",
			detail: "Background processing and the Graph subscription are stopped."
		};
	}
};
//#endregion
//#region src/local-owner-control.ts
var nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
var helloSchema = z.object({
	instanceId: z.uuid(),
	nonce: nonceSchema
}).strict();
var requestSchema = z.object({
	nonce: nonceSchema,
	command: localOwnerCommandSchema,
	mac: nonceSchema
}).strict();
var responseSchema = z.object({
	nonce: nonceSchema,
	result: localOwnerResultSchema,
	mac: nonceSchema
}).strict();
var pipeName = (instanceId) => process.platform === "win32" ? `\\\\.\\pipe\\tlc-teams-owner-${instanceId}` : join(tmpdir(), `tlc-owner-${instanceId}.sock`);
function mac(key, kind, instanceId, nonce, value) {
	return createHmac("sha256", key).update(canonicalJson({
		version: "1.0",
		kind,
		instanceId,
		nonce,
		value
	})).digest("base64url");
}
var equal = (first, second) => first.length === second.length && timingSafeEqual(Buffer.from(first), Buffer.from(second));
var rejected = () => /* @__PURE__ */ new Error("The protected local owner command was rejected or the owner runtime is unavailable.");
async function startOwnerControlTransport(options) {
	if (options.key.length !== 32) throw rejected();
	z.uuid().parse(options.instanceId);
	const sockets = /* @__PURE__ */ new Set();
	const server = createServer$2((socket) => {
		if (sockets.size >= 8) {
			socket.destroy();
			options.onError?.("owner_connection_capacity");
			return;
		}
		sockets.add(socket);
		socket.setEncoding("utf8");
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => options.onError?.("owner_transport_failed"));
		socket.setTimeout(1e4, () => socket.destroy());
		const nonce = randomBytes(32).toString("base64url");
		socket.write(JSON.stringify({
			instanceId: options.instanceId,
			nonce
		}) + "\n");
		let buffer = "";
		let consumed = false;
		socket.on("data", (chunk) => {
			if (consumed) {
				socket.destroy();
				return;
			}
			buffer += chunk;
			if (buffer.length > 16384) {
				consumed = true;
				socket.destroy();
				options.onError?.("owner_request_too_large");
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			consumed = true;
			(async () => {
				try {
					if (buffer.slice(newline + 1)) throw rejected();
					const request = requestSchema.parse(JSON.parse(buffer.slice(0, newline)));
					if (request.nonce !== nonce || !equal(request.mac, mac(options.key, "request", options.instanceId, nonce, request.command))) throw rejected();
					socket.setTimeout(3e5, () => socket.destroy());
					const result = localOwnerResultSchema.parse(await options.execute(request.command));
					if (!socket.destroyed) socket.end(JSON.stringify({
						nonce,
						result,
						mac: mac(options.key, "response", options.instanceId, nonce, result)
					}) + "\n");
				} catch {
					options.onError?.("owner_command_rejected");
					socket.destroy();
				}
			})();
		});
	});
	await new Promise((ready, reject) => {
		server.once("error", reject);
		server.listen(pipeName(options.instanceId), () => {
			server.removeListener("error", reject);
			ready();
		});
	});
	return { async close() {
		for (const socket of sockets) socket.destroy();
		await new Promise((closed, reject) => server.close((error) => error ? reject(error) : closed()));
	} };
}
async function sendOwnerCommand(options) {
	const command = localOwnerCommandSchema.parse(options.command);
	const record = localOwnerRecordSchema.parse(options.record);
	return new Promise((done, fail) => {
		const socket = createConnection(pipeName(record.instanceId));
		socket.setEncoding("utf8");
		let settled = false;
		const reject = () => {
			if (!settled) {
				settled = true;
				socket.destroy();
				fail(rejected());
			}
		};
		socket.on("error", reject);
		socket.on("end", () => {
			if (!settled) reject();
		});
		socket.setTimeout(3e5, reject);
		let buffer = "";
		let nonce;
		socket.on("data", (chunk) => {
			buffer += chunk;
			if (buffer.length > 16384) {
				reject();
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				const value = JSON.parse(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				if (buffer) throw rejected();
				if (!nonce) {
					const hello = helloSchema.parse(value);
					if (hello.instanceId !== record.instanceId) throw rejected();
					nonce = hello.nonce;
					socket.write(JSON.stringify({
						nonce,
						command,
						mac: mac(options.key, "request", record.instanceId, nonce, command)
					}) + "\n");
				} else {
					const response = responseSchema.parse(value);
					if (response.nonce !== nonce || !equal(response.mac, mac(options.key, "response", record.instanceId, nonce, response.result))) throw rejected();
					settled = true;
					socket.end();
					done(response.result);
				}
			} catch {
				reject();
			}
		});
	});
}
var directoryPolicy = String.raw`
$ErrorActionPreference = 'Stop'
$path = [IO.Path]::GetFullPath($env:TLC_OWNER_DIRECTORY)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$base = [IO.Path]::GetFullPath([Environment]::GetFolderPath('LocalApplicationData'))
$prefix = $base.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (!$path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'owner_directory_must_be_per_user_local_appdata' }
if (!(Test-Path -LiteralPath $path)) {
  if ($env:TLC_OWNER_PREPARE -ne '1') { throw 'owner_directory_missing' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
  New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, $system)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
$directory = Get-Item -LiteralPath $path -Force
if (!$directory.PSIsContainer) { throw 'owner_directory_invalid' }
$ancestor = $directory
$trustedParents = @($sid.Value, $system.Value, 'S-1-5-32-544', 'S-1-3-0')
$write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
while ($null -ne $ancestor) {
  if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner_reparse_point_denied' }
  if ($ancestor.FullName -eq $base -or $ancestor.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    $parentAcl = Get-Acl -LiteralPath $ancestor.FullName
    if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedParents) { throw 'owner_parent_not_trusted' }
    foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trustedParents -and ($rule.FileSystemRights -band $write)) { throw 'owner_parent_writable_by_another_user' }
    }
  }
  $ancestor = $ancestor.Parent
}
$acl = Get-Acl -LiteralPath $path
if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner_directory_not_private' }
$allowed = @($sid.Value, $system.Value)
foreach ($item in @($directory) + @(Get-ChildItem -LiteralPath $path -Force -Recurse)) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner_reparse_point_denied' }
  $itemAcl = Get-Acl -LiteralPath $item.FullName
  if ($itemAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner_file_owner_mismatch' }
  foreach ($rule in $itemAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'owner_directory_not_private' }
  }
}
`;
async function checkDirectory(directory, prepare) {
	if (process.platform !== "win32") throw new Error("Local native owner control requires Windows owner ACLs.");
	try {
		await promisify(execFile)("pwsh", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			directoryPolicy
		], {
			env: {
				...process.env,
				TLC_OWNER_DIRECTORY: resolve(directory),
				TLC_OWNER_PREPARE: prepare ? "1" : "0"
			},
			timeout: 3e4
		});
	} catch {
		throw new Error("The native owner directory must be an owner/SYSTEM-only non-reparse directory. Prepare it with the local owner command.");
	}
}
async function prepareOwnerDirectory(directory) {
	await checkDirectory(directory, true);
	const path = join(directory, "state.key");
	try {
		await writeFile(path, randomBytes(32).toString("base64"), {
			flag: "wx",
			mode: 384
		});
	} catch (error) {
		if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
	}
	await readOwnerStateKey(directory);
}
async function readOwnerStateKey(directory) {
	await checkDirectory(directory, false);
	const key = await readFile(join(directory, "state.key"), "utf8");
	if (Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) throw new Error("The protected native state key is invalid.");
	return key;
}
async function startProtectedOwnerControl(options) {
	await checkDirectory(options.directory, false);
	const recordPath = join(options.directory, "control.json");
	try {
		const previous = localOwnerRecordSchema.parse(JSON.parse(await readFile(recordPath, "utf8")));
		try {
			process.kill(previous.processId, 0);
		} catch (error) {
			if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") throw error;
			previous.processId = 0;
		}
		if (previous.processId) throw new Error("The native owner directory is already assigned to a running process.");
	} catch (error) {
		if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const key = randomBytes(32);
	const record = {
		contractVersion: "1.0",
		instanceId: randomUUID(),
		processId: process.pid,
		origin: options.origin
	};
	const transport = await startOwnerControlTransport({
		key,
		instanceId: record.instanceId,
		execute: options.execute,
		onError: options.onError
	});
	const temporary = join(options.directory, `${record.instanceId}.json`);
	try {
		await writeFile(join(options.directory, "control.key"), key.toString("base64"), { mode: 384 });
		await writeFile(temporary, JSON.stringify(record), {
			flag: "wx",
			mode: 384
		});
		await rename(temporary, recordPath);
	} catch (error) {
		await transport.close();
		throw error;
	}
	return { async close() {
		await transport.close();
		await unlink(recordPath);
		await unlink(join(options.directory, "control.key"));
	} };
}
async function invokeProtectedOwnerCommand(directory, command) {
	await checkDirectory(directory, false);
	const record = localOwnerRecordSchema.parse(JSON.parse(await readFile(join(directory, "control.json"), "utf8")));
	const keyPath = join(directory, "control.key");
	if (!(await lstat(keyPath)).isFile()) throw rejected();
	const encoded = await readFile(keyPath, "utf8");
	const key = Buffer.from(encoded, "base64");
	if (key.length !== 32 || key.toString("base64") !== encoded) throw rejected();
	return sendOwnerCommand({
		key,
		record,
		command
	});
}
//#endregion
//#region src/cli-identity.ts
var CliIdentityProvider = class {
	configuration;
	credential;
	options;
	generation = 0;
	current;
	state = "sign-in-required";
	resolveKey;
	now;
	constructor(configuration, credential = new AzureCliCredential({
		tenantId: configuration.tenantId,
		processTimeoutInMs: 3e4
	}), options) {
		this.configuration = configuration;
		this.credential = credential;
		this.options = options;
		this.now = options.now ?? Date.now;
		this.resolveKey = options.resolveKey ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${configuration.tenantId}/discovery/v2.0/keys`));
	}
	identity() {
		return this.current && (this.current.principal.expiresAt ?? 0) > this.now() ? this.current : void 0;
	}
	assertResource(resource) {
		if (resource !== "msx") throw new NativeConnectionError("native_resource_unavailable");
	}
	async acquire() {
		const result = await this.credential.getToken(`${this.configuration.msxResource}/.default`);
		if (!result) throw new NativeConnectionError("native_sign_in_required");
		return this.validate(result);
	}
	async validate(result) {
		try {
			const v1Issuer = `https://sts.windows.net/${this.configuration.tenantId}/`;
			const v2Issuer = `https://login.microsoftonline.com/${this.configuration.tenantId}/v2.0`;
			const { payload } = await jwtVerify(result.token, this.resolveKey, {
				issuer: [v1Issuer, v2Issuer],
				audience: [
					this.configuration.msxResource,
					`${this.configuration.msxResource}/`,
					"00000007-0000-0000-c000-000000000000"
				],
				algorithms: ["RS256"],
				requiredClaims: [
					"exp",
					"tid",
					"oid",
					"scp",
					"ver"
				],
				currentDate: new Date(this.now())
			});
			const userId = z.uuid().parse(payload["oid"]).toLowerCase();
			if (payload["tid"] !== this.configuration.tenantId || payload["idtyp"] === "app" || !(payload["ver"] === "1.0" && payload.iss === v1Issuer || payload["ver"] === "2.0" && payload.iss === v2Issuer) || typeof payload["scp"] !== "string" || !payload["scp"].split(" ").includes("user_impersonation") || !Number.isFinite(result.expiresOnTimestamp) || result.expiresOnTimestamp <= this.now()) throw new Error("Invalid delegated source identity.");
			const username = [
				payload["preferred_username"],
				payload["upn"],
				payload["unique_name"]
			].find((value) => typeof value === "string" && value.length > 0 && value.length <= 500);
			return {
				token: result.token,
				identity: {
					generation: this.generation,
					account: username ?? "Signed-in Azure CLI user",
					principal: {
						key: `${this.configuration.tenantId}:${userId}`,
						tenantId: this.configuration.tenantId,
						userId,
						environmentId: this.configuration.environmentId,
						mode: "live",
						roles: [],
						localReadOnly: true,
						expiresAt: Math.min(Number(payload.exp) * 1e3, result.expiresOnTimestamp)
					}
				}
			};
		} catch {
			throw new NativeConnectionError("native_identity_rejected");
		}
	}
	async connect(resource) {
		this.assertResource(resource);
		if (this.state === "connecting") throw new NativeConnectionError("native_sign_in_in_progress");
		await this.disconnect();
		const generation = this.generation;
		this.state = "connecting";
		try {
			const result = await this.acquire();
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			await this.options.probeMsxIdentity(result.token, result.identity.principal);
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			this.current = result.identity;
			this.state = "connected";
		} catch (error) {
			if (generation === this.generation) {
				this.current = void 0;
				this.state = "blocked";
			}
			throw error instanceof NativeConnectionError ? error : new NativeConnectionError("native_source_denied");
		}
	}
	async getToken(resource) {
		this.assertResource(resource);
		const identity = this.identity();
		if (!identity) throw new NativeConnectionError("native_sign_in_required");
		const generation = this.generation;
		try {
			const result = await this.acquire();
			if (generation !== this.generation) throw new NativeConnectionError("native_connection_changed");
			if (result.identity.principal.userId !== identity.principal.userId) {
				await this.disconnect();
				throw new NativeConnectionError("native_connection_changed");
			}
			this.current = result.identity;
			return result.token;
		} catch (error) {
			if (generation === this.generation) {
				await this.disconnect();
				this.state = "blocked";
			}
			throw error instanceof NativeConnectionError ? error : new NativeConnectionError("native_source_denied");
		}
	}
	async disconnect() {
		this.generation++;
		this.current = void 0;
		this.state = "sign-in-required";
	}
	status() {
		const identity = this.identity();
		return {
			contractVersion: "1.0",
			state: identity ? "connected" : this.state === "connected" ? "reconnect-required" : this.state,
			detail: identity ? "Current Azure CLI user and own Dataverse mapping verified. Private MSX access is read-only; no FTE, writer or publication role is inferred." : "Use the protected owner Connect command to reuse your existing Azure CLI user. If needed, run az login yourself first. No sign-in or source request is triggered by this page.",
			...identity ? { account: identity.account } : {},
			resources: [
				"msx",
				"mcp",
				"graph"
			].map((resource) => ({
				resource,
				state: resource !== "msx" ? "unavailable" : identity ? "connected" : "not-connected",
				detail: resource !== "msx" ? "This read-only CLI profile does not request optional source grants." : "Current-user delegated MSX access; account/deal-team queries remain source-authorized."
			})),
			capabilities: cliCapabilities.map((capability) => capability.id === "msx" && identity ? {
				...capability,
				state: "available",
				detail: "Signed-in user verified. Portfolio automatically uses their Dataverse system-user ID and active deal-team memberships."
			} : { ...capability })
		};
	}
};
//#endregion
//#region src/native-connection.ts
async function createNativeConnection(configuration, environment) {
	const configuredDirectory = environment["TLC_TEAMS_OWNER_DIRECTORY"];
	if (!configuredDirectory) throw new Error("Native mode requires a prepared TLC_TEAMS_OWNER_DIRECTORY; use the local launcher.");
	const directory = resolve(configuredDirectory);
	const stateKey = await readOwnerStateKey(directory);
	if (environment["TLC_TEAMS_STATE_KEY"] && environment["TLC_TEAMS_STATE_KEY"] !== stateKey) throw new Error("Native state must use the protected local installation key.");
	const dataDirectory = resolve(environment["TLC_TEAMS_DATA_DIR"] ?? join(directory, "data"));
	for (const path of [dataDirectory, environment["TLC_TEAMS_STATE_PATH"]]) {
		if (!path) continue;
		const child = relative(directory, resolve(path));
		if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("Native private state must remain inside the protected local owner directory.");
	}
	const fetchImplementation = (input, init) => {
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		if (isCliConfiguration(configuration) && !["GET", "HEAD"].includes(method)) throw new NativeConnectionError("native_resource_unavailable");
		return fetch(input, {
			...init,
			signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(3e4)]) : AbortSignal.timeout(3e4)
		});
	};
	const options = { probeMsxIdentity: async (token, identity) => {
		await new LiveMsxConnector({ getAccessToken: async () => token }, fetchImplementation, `${configuration.msxResource}/api/data/v9.2/`).assertNativeIdentity(identity.userId);
	} };
	const provider = isCliConfiguration(configuration) ? new CliIdentityProvider(configuration, void 0, options) : new NativeIdentityProvider(configuration, createNativeAuthenticationClient(configuration), options);
	const pairing = new LocalPairingAuthority(configuration.origin, () => provider.identity(), { allowLocalReadOnly: isCliConfiguration(configuration) });
	return {
		provider,
		pairing,
		fetchImplementation,
		environment: {
			...environment,
			TLC_TEAMS_STATE_KEY: stateKey,
			TLC_TEAMS_DATA_DIR: dataDirectory
		},
		status: () => provider.status(),
		async startOwnerControl(stopOwnedWork) {
			return startProtectedOwnerControl({
				directory,
				origin: configuration.origin,
				onError: (code) => console.error(`[teams-owner] ${code}`),
				execute: async (command) => {
					try {
						if (command.action === "connect") {
							if (command.resource === "msx") {
								await provider.disconnect();
								await stopOwnedWork();
							}
							await provider.connect(command.resource);
						} else if (command.action === "approve") pairing.approve(command.userCode);
						else if (command.action === "disconnect") {
							pairing.invalidate();
							await provider.disconnect();
							await stopOwnedWork();
						}
						return {
							contractVersion: "1.0",
							ok: true,
							status: provider.status(),
							pending: pairing.pending()
						};
					} catch (error) {
						const code = error instanceof NativeConnectionError || error instanceof LocalPairingError ? error.code : "native_owner_command_failed";
						console.error(`[teams-owner] ${code}`);
						return {
							contractVersion: "1.0",
							ok: false,
							error: code
						};
					}
				}
			});
		}
	};
}
//#endregion
//#region src/server.ts
async function startTeamsServer(environment = process.env) {
	const configuration = loadTeamsConfiguration(environment);
	const hosted = configuration.mode === "live" && !isLocalConfiguration(configuration) ? configuration : void 0;
	const tlsConfiguration = loadTeamsTlsConfiguration(environment, configuration.origin);
	const tls = tlsConfiguration ? {
		cert: await readFile(tlsConfiguration.certificatePath),
		key: await readFile(tlsConfiguration.keyPath)
	} : void 0;
	const acceptNewWork = loadTeamsAdmission(environment);
	const port = Number(environment["TLC_TEAMS_PORT"] ?? environment["PORT"] ?? 3978);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("The Teams listener port is invalid.");
	const host = environment["TLC_TEAMS_HOST"] ?? (environment["WEBSITE_SITE_NAME"] ? "0.0.0.0" : "127.0.0.1");
	if (isLocalConfiguration(configuration) && (!tls || ![
		"localhost",
		"127.0.0.1",
		"::1"
	].includes(host) || port !== Number(new URL(configuration.origin).port || 443))) throw new Error("Native Teams requires trusted loopback HTTPS on the exact configured origin port.");
	const native = isLocalConfiguration(configuration) ? await createNativeConnection(configuration, environment) : void 0;
	const runtimeEnvironment = native?.environment ?? environment;
	const runtime = loadTeamsRuntimeConfiguration(runtimeEnvironment, configuration);
	const stateKey = configuration.mode === "live" ? loadTeamsStateKey(runtimeEnvironment) : void 0;
	const foundry = hosted || isNativeConfiguration(configuration) && configuration.guidanceMode === "foundry" ? await loadFoundryEnvironmentFromEnvironment(runtimeEnvironment) : void 0;
	const foundryCredential = foundry ? createTeamsWorkloadCredential(runtime, foundry.authentication.foundryTenantId, runtimeEnvironment) : void 0;
	const resources = await createTeamsStateStore(configuration, runtime, runtimeEnvironment);
	const { store } = resources;
	let sample;
	try {
		const lifecycle = new CollaborationLifecycle(store, acceptNewWork);
		const sessions = /* @__PURE__ */ new Map();
		const samplePath = runtime.samplePath;
		if (configuration.mode === "sample" && samplePath !== ":memory:") await mkdir(dirname(samplePath), { recursive: true });
		sample = configuration.mode === "sample" ? await createSampleApplicationServices({ dataPath: samplePath }) : void 0;
		const confidential = hosted ? new ConfidentialClientApplication({ auth: {
			clientId: hosted.apiClientId,
			authority: `https://login.microsoftonline.com/${hosted.tenantId}`,
			clientSecret: hosted.apiCredential
		} }) : void 0;
		let authority;
		if (configuration.mode === "sample") authority = { verify: async (principal) => {
			if (principal.mode !== "sample") throw new Error("Sample disclosure policy cannot authorize a live user.");
			return {
				revision: "sanitized-sample-only",
				canConfigure: true,
				canPublish: true,
				audienceEligible: true
			};
		} };
		else if (hosted) {
			const policyPath = environment["TLC_TEAMS_DISCLOSURE_POLICY"];
			if (!policyPath) throw new Error("An approved, expiring Teams disclosure policy is required in live mode.");
			const policy = JSON.parse(await readFile(resolve(policyPath), "utf8"));
			const metadataClient = new ConfidentialClientApplication({ auth: {
				clientId: hosted.botClientId,
				authority: `https://login.microsoftonline.com/${hosted.tenantId}`,
				clientSecret: hosted.botCredential
			} });
			authority = new GraphContextAuthority(policy, async () => {
				const result = await metadataClient.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
				if (!result?.accessToken) throw new Error("Teams context metadata authorization is unavailable.");
				return result.accessToken;
			});
		} else authority = { verify: async () => {
			throw new Error("Private local source access is not cross-device publication authority.");
		} };
		async function resolveServices(principal, assertion) {
			if (sample) return sample;
			if (configuration.mode !== "live" || !native && (!hosted || !confidential || !foundryCredential)) throw new Error("Live Teams configuration is unavailable.");
			const key = principalPartition(principal);
			const generation = (await lifecycle.status(principal)).generation;
			const nativeGeneration = native?.provider.generation ?? 0;
			const provider = native?.provider ?? (hosted && confidential ? createDelegatedTokenProvider(hosted, assertion, (request) => confidential.acquireTokenOnBehalfOf(request), principal.expiresAt ?? Date.now()) : void 0);
			if (!provider) throw new Error("The configured live source credential is unavailable.");
			let existing = sessions.get(key);
			if (existing && (existing.generation !== generation || existing.nativeGeneration !== nativeGeneration)) {
				await stopOwnedWork(principal);
				existing = void 0;
			}
			if (existing) {
				existing.tokens.current = provider;
				existing.principal = principal;
				existing.lastUsed = Date.now();
				const services = await existing.services;
				services.refreshSource();
				return services;
			}
			if (sessions.size >= 50) throw new Error("The live Teams session limit has been reached. Try again later.");
			const tokens = { current: provider };
			const assertNativeOwner = () => {
				const identity = native?.provider.identity();
				if (native && (!identity || identity.generation !== nativeGeneration || principalPartition(identity.principal) !== key)) throw new NativeConnectionError("native_connection_changed");
			};
			const services = createLiveApplicationServices({
				environment: runtimeEnvironment,
				msxResource: configuration.msxResource,
				...native ? {
					guidanceMode: isNativeConfiguration(configuration) ? configuration.guidanceMode : "deterministic",
					fetchImplementation: async (input, init) => {
						assertNativeOwner();
						const response = await native.fetchImplementation(input, init);
						assertNativeOwner();
						return response;
					}
				} : {},
				getToken: async (resource) => {
					assertNativeOwner();
					await lifecycle.assertGeneration(principal, generation);
					const token = await tokens.current.getToken(resource);
					assertNativeOwner();
					await lifecycle.assertGeneration(principal, generation);
					return token;
				},
				preferences: new ScopedPortfolioPreferenceStore(store, key),
				...foundryCredential ? { foundryCredential } : {}
			});
			const entry = {
				services,
				tokens,
				principal,
				lastUsed: Date.now(),
				generation,
				nativeGeneration
			};
			sessions.set(key, entry);
			services.catch(() => {
				if (sessions.get(key) === entry) sessions.delete(key);
			});
			return services;
		}
		async function stopOwnedWork(identity) {
			const key = principalPartition(identity);
			const entry = sessions.get(key);
			if (entry) sessions.delete(key);
			const services = sample ?? (entry ? await entry.services : void 0);
			if (!services) return;
			for (const run of services.workflows.listRuns({
				contractVersion: "1.0",
				limit: 100
			})) if (run.status === "queued" || run.status === "running") {
				const cancelled = services.workflows.cancel({
					contractVersion: "1.0",
					runId: run.runId
				});
				await new WorkflowActivityStore(store).record(identity, cancelled);
			}
			if (entry) await services.dispose();
		}
		const web = express();
		web.disable("x-powered-by");
		web.use((request, response, next) => {
			if (native) try {
				assertNativeHttpRequest(request, configuration.origin);
			} catch {
				response.status(403).json({ error: "local_origin_denied" });
				return;
			}
			response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com https://*.microsoftonline.com https://res.cdn.office.net/teams-js/validDomains/json/validDomains.json; frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft; base-uri 'none'; object-src 'none'; form-action 'self'");
			response.setHeader("x-content-type-options", "nosniff");
			response.setHeader("referrer-policy", "no-referrer");
			response.setHeader("cache-control", "no-store");
			next();
		});
		let transport;
		if (hosted) {
			if (!stateKey) throw new Error("Live bot credential state requires its configured encryption key.");
			transport = await registerTeamsBot({
				web,
				configuration: hosted,
				store,
				stateKey,
				resolveServices,
				acceptNewWork,
				onDeactivate: stopOwnedWork
			});
		}
		const transcriptEvents = hosted ? new TranscriptEventService(store, {
			tenantId: hosted.tenantId,
			environmentId: hosted.environmentId
		}, (principal) => new GraphSubscriptionConnector(hosted.origin, async () => {
			const session = sessions.get(principalPartition(principal));
			if (!session || (session.principal.expiresAt ?? 0) <= Date.now()) throw new Error("The original delegated session requires reauthentication.");
			return session.tokens.current.getToken("graph");
		}), async (principal, request, generation, notificationId) => {
			const session = sessions.get(principalPartition(principal));
			if (!session || (session.principal.expiresAt ?? 0) <= Date.now()) throw new GraphMeetingError("auth-required", "delegated_session_expired");
			await lifecycle.assertActive(session.principal);
			await lifecycle.assertGeneration(session.principal, generation);
			const services = await session.services;
			services.refreshSource();
			const result = await new MeetingAcquisitionService(store, {
				readOpportunity: async (_actor, id) => {
					await services.orchestrator.getOpportunitySnapshot(id);
				},
				getTranscripts: (_actor, input) => services.acquireTranscripts(input),
				propose: (_actor, id, transcript) => services.proposeTranscript(id, transcript)
			}).acquire(session.principal, request, { notificationId });
			if (result.status.state === "auth-required") throw new GraphMeetingError("auth-required", "delegated_session_expired");
			await new NotificationOutbox(store).enqueueAcquisition(session.principal, result);
			await transport?.notify(session.principal);
		}) : void 0;
		const handler = createTeamsHandler({
			configuration,
			store,
			resolveServices,
			authority,
			acceptNewWork,
			onDeactivate: stopOwnedWork,
			...transport ? {
				deliverPublication: transport.deliverPublication,
				notify: transport.notify
			} : {},
			...transcriptEvents ? { transcriptEvents } : {},
			...native ? { localConnection: native } : {},
			onError: ({ correlationId, code, method, category }) => console.error(`[teams-api] ${correlationId} ${code} ${method} ${category}`)
		});
		web.use((request, response, next) => {
			handler(request, response).then((handled) => {
				if (!handled) next();
			}).catch(() => {
				console.error("[teams-api] unhandled_transport_error");
				if (!response.headersSent) response.status(500).json({ error: "transport_failed" });
			});
		});
		web.get("/auth/callback", (_request, response) => response.type("html").send("<!doctype html><html lang=\"en\"><head><title>Microsoft sign-in complete</title></head><body>Return to TLC Assist.</body></html>"));
		web.get("/privacy", (_request, response) => response.type("text").send("TLC Assist uses delegated source permissions. Prompts, tokens, customer details and transcripts are not operational telemetry. Contact your application owner for the approved data and audit retention policy."));
		web.get("/terms", (_request, response) => response.type("text").send("Internal Microsoft FTE application. Source-system authorization and reviewed-action controls apply. Sample mode uses sanitized data only."));
		const clientRoot = resolve(environment["TLC_TEAMS_STATIC_ROOT"] ?? fileURLToPath(new URL("./client", import.meta.url)));
		web.use(express.static(clientRoot, {
			index: false,
			dotfiles: "deny",
			fallthrough: true
		}));
		web.get("/", (_request, response) => response.sendFile(resolve(clientRoot, "index.html")));
		web.use((_request, response) => response.status(404).json({ error: "route_not_found" }));
		const server = tls ? createServer$1(tls, web) : createServer(web);
		await new Promise((resolveReady, reject) => {
			server.once("error", reject);
			server.listen(port, host, () => {
				server.removeListener("error", reject);
				resolveReady();
			});
		});
		const address = server.address();
		const boundPort = address && typeof address !== "string" ? address.port : port;
		let ownerControl;
		if (native) try {
			ownerControl = await native.startOwnerControl(async () => {
				for (const entry of [...sessions.values()]) await stopOwnedWork(entry.principal);
			});
		} catch (error) {
			await new Promise((closed) => server.close(() => closed()));
			throw error;
		}
		console.info(`TLC Teams ready at ${tls ? "https" : "http"}://${host}:${boundPort} (${configuration.mode})`);
		console.info(`[teams-host] profile=${runtime.profile} state=${runtime.state.kind} source-identity=${configuration.mode === "live" ? "delegated-user" : "sanitized-sample"}`);
		let work = Promise.resolve();
		let processing = false;
		let renewAfter = 0;
		const interval = transcriptEvents ? setInterval(() => {
			if (processing || !acceptNewWork) return;
			processing = true;
			work = (async () => {
				const renew = Date.now() >= renewAfter;
				if (renew) renewAfter = Date.now() + 6e4;
				for (const session of sessions.values()) if ((session.principal.expiresAt ?? 0) > Date.now()) {
					if (renew) {
						if ((await transcriptEvents.maintain(session.principal)).some((item) => item.state !== "active")) console.error("[teams-graph] subscription_renewal_unconfirmed");
					}
					await transcriptEvents.drain(session.principal);
				}
			})().catch(() => {
				console.error("[teams-graph] event_processing_failed");
			}).finally(() => {
				processing = false;
			});
		}, 5e3) : void 0;
		interval?.unref();
		let closing;
		return {
			server,
			configuration,
			store,
			close() {
				closing ??= (async () => {
					if (interval) clearInterval(interval);
					try {
						try {
							await ownerControl?.close();
						} finally {
							try {
								if (native) {
									native.pairing.invalidate();
									await native.provider.disconnect();
								}
							} finally {
								await new Promise((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
								await work;
								for (const session of sessions.values()) await (await session.services).dispose();
								await sample?.dispose();
							}
						}
					} finally {
						resources.close();
					}
				})();
				return closing;
			}
		};
	} catch (error) {
		try {
			await sample?.dispose();
		} finally {
			resources.close();
		}
		throw error;
	}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "--local-owner") {
		const action = process.argv[3];
		const directory = process.argv[4];
		(async () => {
			if (!directory) throw new Error("A protected owner directory is required.");
			if (action === "prepare") {
				await prepareOwnerDirectory(directory);
				console.info("Protected native owner directory prepared. No source sign-in or data access occurred.");
				return;
			}
			const command = localOwnerCommandSchema.parse({
				contractVersion: "1.0",
				action,
				...action === "connect" ? { resource: process.argv[5] ?? "msx" } : {},
				...action === "approve" ? { userCode: process.argv[5] } : {}
			});
			const result = await invokeProtectedOwnerCommand(directory, command);
			if (!result.ok) throw new Error(result.error);
			console.info(JSON.stringify(result, null, 2));
		})().catch((error) => {
			const code = error instanceof Error && /^[a-z_]{1,100}$/.test(error.message) ? error.message : "owner_command_failed";
			console.error(`[teams-owner] ${code}; check the protected directory, native registration/eligibility and resource grants. No source write was performed.`);
			process.exitCode = 1;
		});
	} else startTeamsServer().then((application) => {
		const stop = () => {
			application.close().catch(() => {
				console.error("[teams-host] shutdown_failed");
				process.exitCode = 1;
			});
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	}).catch(() => {
		console.error("[teams-host] configuration_or_startup_failed");
		process.exitCode = 1;
	});
}
//#endregion
export { startTeamsServer };

//# sourceMappingURL=server.js.map