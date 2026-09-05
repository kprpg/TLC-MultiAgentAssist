import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { AzureCliCredential, InteractiveBrowserCredential } from "@azure/identity";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { AIProjectClient } from "@azure/ai-projects";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
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
		"linkedin"
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
	tenantName: z.string().min(1).optional(),
	detail: z.string().min(1)
});
z.object({
	mode: dataModeSchema,
	auth: authStatusSchema
});
z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	segment: z.string().min(1)
});
z.object({
	id: z.string().min(1),
	accountId: z.string().min(1),
	name: z.string().min(1),
	recordedStage: z.number().int().min(1).max(5),
	value: z.number().nonnegative(),
	currency: z.string().length(3),
	closeDate: z.string().date()
});
var evidenceSchema = z.object({
	id: z.string().min(1),
	source: z.enum(["msx", "mcem"]),
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
var agentCapabilitySchema = z.enum([
	"account-pulse",
	"mcem-coach",
	"pursuit-executive",
	"risk-solution-play"
]);
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
var appRegistrationSchema = z.object({
	tenantId: z.string().uuid(),
	clientId: z.string().uuid(),
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
	foundryTenantId: z.string().uuid(),
	scopes: resourceScopesSchema,
	appRegistration: appRegistrationSchema.optional()
}).strict(), z.object({
	mode: z.literal("interactive-browser"),
	expectedUserDomain: z.string().regex(/^@[a-z0-9.-]+$/),
	foundryTenantId: z.string().uuid(),
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
		projectEndpoint: z.string().url(),
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
	const configuredPath = environment["TLC_FOUNDRY_ENV_FILE"]?.trim();
	return resolve(workingDirectory, configuredPath || "config/foundry.environment.json");
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
var MsxRequestError = class extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "MsxRequestError";
	}
};
var LiveMsxConnector = class {
	baseUrl;
	portfolioPromise;
	observationPromises = /* @__PURE__ */ new Map();
	constructor(tokenProvider, fetchImplementation = fetch, baseUrl = defaultBaseUrl, performanceReporter) {
		this.tokenProvider = tokenProvider;
		this.fetchImplementation = fetchImplementation;
		this.performanceReporter = performanceReporter;
		this.baseUrl = new URL(baseUrl);
	}
	async listAccounts() {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.accounts);
	}
	async listOpportunities(accountId) {
		const portfolio = await this.getPortfolio();
		return structuredClone(portfolio.opportunities.filter((opportunity) => opportunity.accountId === accountId));
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
	}
	getOpportunityObservations(opportunity) {
		let observations = this.observationPromises.get(opportunity.id);
		if (!observations) {
			observations = measurePerformance("msx.opportunity-evidence", this.performanceReporter, async () => {
				return mapOpportunityObservations(opportunity, await this.requestAll("msp_engagementmilestones", {
					"$select": "msp_engagementmilestoneid,msp_name,_ownerid_value,msp_milestonedate,msp_milestonestatus,msp_commitmentrecommendation,msp_monthlyuse",
					"$filter": `statecode eq 0 and _msp_opportunityid_value eq ${opportunity.id}`,
					"$orderby": "msp_milestonedate asc"
				}));
			}).catch((error) => {
				this.observationPromises.delete(opportunity.id);
				throw error;
			});
			this.observationPromises.set(opportunity.id, observations);
		}
		return observations;
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
		const activeOpportunities = (await measurePerformance("msx.opportunities", this.performanceReporter, () => this.requestByIds("opportunities", "opportunityid", opportunityIds, "opportunityid,_parentaccountid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate"))).filter((row) => row._parentaccountid_value);
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
			recordedStage,
			value: row.estimatedvalue || row.msp_consumptionconsumedrecurring || 0,
			currency: "USD",
			closeDate: closeDate?.slice(0, 10) ?? "1970-01-01"
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
	async listAccounts() {
		return structuredClone(accounts);
	}
	async listOpportunities(accountId) {
		return structuredClone(opportunities.filter((opportunity) => opportunity.accountId === accountId));
	}
	async getOpportunityContext(opportunityId) {
		const opportunity = opportunities.find((candidate) => candidate.id === opportunityId);
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
var stageOneCriteria = [
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
];
var lifecycleCriteria = [
	{
		id: "customer-outcome",
		label: "Measurable customer outcome",
		ownerRole: "ATS",
		actionWhenMissing: "Agree the planned outcome, milestone, measurement, and customer review rhythm.",
		rationale: "The MCEM Overview says teams should measure progress against planned outcomes and milestones."
	},
	{
		id: "decision-team",
		label: "Customer and v-team alignment",
		ownerRole: "Account Executive",
		actionWhenMissing: "Align the relevant customer stakeholders and Microsoft v-team roles around the opportunity.",
		rationale: "Continuous customer planning coordinates execution across customer stakeholders, ATU, STU, CSU, partners, and executives."
	},
	{
		id: "technical-validation",
		label: "Outcome and exit-criteria evidence",
		ownerRole: "Solution Engineer (SE)",
		actionWhenMissing: "Define the evidence needed to demonstrate the current stage outcomes and exit criteria.",
		rationale: "MCEM stage progression is driven by achieved outcomes and exit criteria, not completed activities."
	},
	{
		id: "business-case",
		label: "Business-priority alignment",
		ownerRole: "Specialist / SSP",
		actionWhenMissing: "Connect the opportunity to the customer priority, expected return, and available budget.",
		rationale: "MCEM aligns customer needs, business outcomes, and solutions throughout the lifecycle."
	},
	{
		id: "next-step",
		label: "Governed next step",
		ownerRole: "CSA / CSAM",
		actionWhenMissing: "Agree a dated next step that advances an outcome or exit criterion with named owners.",
		rationale: "Customer planning requires coordinated execution and adjustment as needs and priorities evolve."
	}
];
var LocalPdfMcemGuidanceConnector = class {
	sourcePromise;
	constructor(pdfPath) {
		this.pdfPath = pdfPath;
	}
	async getStageGuidance(stage) {
		const source = await (this.sourcePromise ??= this.loadSource());
		return {
			stage,
			title: `MCEM Stage ${stage} overview guidance`,
			version: source.version,
			effectiveDate: source.effectiveDate,
			criteria: structuredClone(stage === 1 ? stageOneCriteria : lifecycleCriteria),
			sourceHealth: {
				source: "mcem",
				state: "partial",
				detail: "Local snapshot: docs/knowledge/MCEM Overview.pdf. No live SharePoint request was made; detailed stage guidance remains outside this overview.",
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
//#region packages/orchestrator/index.ts
var ThinSliceOrchestrator = class {
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
//#region apps/desktop/electron/main/azure-cli-token-provider.ts
var refreshBufferMs = 300 * 1e3;
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
		created: false
	};
	const filePath = join(options.userDataPath, "foundry.environment.json");
	try {
		await stat(filePath);
		return {
			filePath,
			created: false
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(dirname(filePath), { recursive: true });
	await copyFile(options.templatePath, filePath);
	return {
		filePath,
		created: true
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
			return [new Paragraph({
				children: child.type === "paragraph" ? inlineChildren(child.children) : [new TextRun(textContent(child))],
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
//#region apps/desktop/electron/main/index.ts
var desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
var rendererFile = resolve(desktopRoot, "dist/renderer/index.html");
var preloadFile = resolve(desktopRoot, "dist-electron/preload/index.cjs");
var developmentUrl = process.env["VITE_DEV_SERVER_URL"];
var allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString();
var dataMode = process.env["TLC_DATA_MODE"] === "sample" ? "sample" : "live";
var preparedEnvironment = dataMode === "live" ? await prepareFoundryEnvironmentFile({
	isPackaged: app.isPackaged,
	userDataPath: app.getPath("userData"),
	templatePath: resolve(process.resourcesPath, "config/foundry.environment.example.json")
}) : void 0;
var runtimeEnvironment;
var startupBlocked = false;
if (preparedEnvironment?.created) {
	startupBlocked = true;
	await openConfigurationAndExit(preparedEnvironment.filePath, "Your configuration file has been created. Set the Foundry project, agent names, tenant, client ID, and authentication mode, then reopen the application.");
} else if (preparedEnvironment) try {
	runtimeEnvironment = await loadFoundryEnvironment(preparedEnvironment.filePath);
} catch (error) {
	startupBlocked = true;
	await openConfigurationAndExit(preparedEnvironment.filePath, `The configuration could not be loaded. Correct it, then reopen the application.\n\n${error instanceof Error ? error.message : String(error)}`);
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
var msxConnector = dataMode === "sample" ? new FixtureMsxConnector() : new LiveMsxConnector(tokenProvider, fetch, void 0, reportPerformance);
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
async function openConfigurationAndExit(filePath, detail) {
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
	app.quit();
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
function registerReadOnlyIpc() {
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
	ipcMain.handle("tlc:run-mcem-coach", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.runMcemCoach(mcemRequestSchema.parse(request));
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
	return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120) || "TLC agent response";
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
	registerReadOnlyIpc();
	app.whenReady().then(createWindow);
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
export {};

//# sourceMappingURL=index.js.map