import { BrowserWindow, app, ipcMain, shell } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AzureCliCredential } from "@azure/identity";
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
		"consent-required"
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
	constructor(tokenProvider, fetchImplementation = fetch, baseUrl = defaultBaseUrl) {
		this.tokenProvider = tokenProvider;
		this.fetchImplementation = fetchImplementation;
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
		return {
			account: structuredClone(account),
			opportunity: structuredClone(opportunity),
			observations: [],
			retrievedAt,
			sourceHealth: {
				source: "msx",
				state: "live",
				detail: "Live MSX data scoped to active opportunities where the signed-in user is on the deal team.",
				checkedAt: retrievedAt
			}
		};
	}
	refresh() {
		this.portfolioPromise = void 0;
	}
	getPortfolio() {
		this.portfolioPromise ??= this.loadPortfolio().catch((error) => {
			this.portfolioPromise = void 0;
			throw error;
		});
		return this.portfolioPromise;
	}
	async loadPortfolio() {
		const identity = await this.requestJson("WhoAmI");
		const opportunityIds = unique((await this.requestAll("msp_dealteams", {
			"$select": "_msp_parentopportunityid_value",
			"$filter": `statecode eq 0 and _msp_dealteamuserid_value eq ${identity.UserId}`
		})).map((row) => row._msp_parentopportunityid_value).filter(isPresent));
		const activeOpportunities = (await this.requestByIds("opportunities", "opportunityid", opportunityIds, "opportunityid,_parentaccountid_value,name,msp_activesalesstage,estimatedvalue,msp_consumptionconsumedrecurring,msp_estcompletiondate,estimatedclosedate")).filter((row) => row._parentaccountid_value);
		const accountIds = unique(activeOpportunities.map((row) => row._parentaccountid_value).filter(isPresent));
		const accounts = (await this.requestByIds("accounts", "accountid", accountIds, "accountid,name")).map((row) => ({
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
			value: row.estimatedvalue ?? row.msp_consumptionconsumedrecurring ?? 0,
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
var opportunities = [{
	id: "opp-grid-modernization",
	accountId: "account-contoso",
	name: "Grid operations modernization",
	recordedStage: 3,
	value: 42e5,
	currency: "USD",
	closeDate: "2026-10-30"
}, {
	id: "opp-ai-service",
	accountId: "account-fabrikam",
	name: "AI-assisted customer service",
	recordedStage: 2,
	value: 175e4,
	currency: "USD",
	closeDate: "2026-12-18"
}];
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
//#region packages/connectors/sharepoint/index.ts
var stageThreeGuidance = {
	stage: 3,
	title: "MCEM Stage 3: Solution Design",
	version: "2026.07",
	effectiveDate: "2026-07-01",
	sourceUrl: "https://microsoft.sharepoint.com/sites/mcem/sample/stage-3",
	criteria: [
		{
			id: "customer-outcome",
			label: "Measurable customer outcome",
			ownerRole: "Specialist",
			actionWhenMissing: "Agree a baseline, target, and measurement owner with the customer.",
			rationale: "A measurable outcome anchors value and later adoption tracking."
		},
		{
			id: "decision-team",
			label: "Decision team coverage",
			ownerRole: "Account Executive",
			actionWhenMissing: "Map the economic buyer, technical approver, procurement path, and customer sponsor.",
			rationale: "Stage progression requires a credible decision path."
		},
		{
			id: "technical-validation",
			label: "Technical validation",
			ownerRole: "Solution Engineer",
			actionWhenMissing: "Define a customer-approved technical validation plan and acceptance criteria.",
			rationale: "Solution confidence must be based on customer evidence."
		},
		{
			id: "business-case",
			label: "Supported business case",
			ownerRole: "Specialist",
			actionWhenMissing: "Build and validate a quantified value hypothesis with the customer.",
			rationale: "A supported business case is needed before commitment."
		},
		{
			id: "next-step",
			label: "Mutually agreed next step",
			ownerRole: "Account Executive",
			actionWhenMissing: "Secure a dated customer next step with named attendees and purpose.",
			rationale: "A mutual next step demonstrates active customer progression."
		}
	],
	sourceHealth: {
		source: "mcem",
		state: "sample",
		detail: "Versioned fixture derived for development; canonical SharePoint path remains unverified.",
		checkedAt: "2026-08-24T00:00:00.000Z"
	}
};
var FixtureMcemGuidanceConnector = class {
	async getStageGuidance(stage) {
		if (stage !== 3) return {
			...stageThreeGuidance,
			stage,
			title: `MCEM Stage ${stage} guidance (sample)`
		};
		return structuredClone(stageThreeGuidance);
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
	const recommendations = gaps.map((gap) => {
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
	const evidenceBasedStage = gaps.length === 0 ? context.opportunity.recordedStage : Math.max(1, context.opportunity.recordedStage - 1);
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	return mcemResponseSchema.parse({
		contractVersion: "1.0",
		correlationId,
		capability: "mcem-coach",
		agentVersion: mcemCoachVersion,
		generatedAt,
		mode: "sample",
		state: "complete",
		summary: evidenceBasedStage === context.opportunity.recordedStage ? `The available evidence supports recorded Stage ${context.opportunity.recordedStage}.` : `The opportunity is recorded at Stage ${context.opportunity.recordedStage}, while the available evidence supports Stage ${evidenceBasedStage}.`,
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
			accessContext: "sample",
			quality: "observed",
			excerpt: observationExcerpt
		}, {
			id: guidanceEvidenceId,
			source: "mcem",
			recordId: `stage-${guidance.stage}-${guidance.version}`,
			title: guidance.title,
			url: guidance.sourceUrl,
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
	constructor(msx, mcem) {
		this.msx = msx;
		this.mcem = mcem;
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
};
//#endregion
//#region apps/desktop/electron/main/azure-cli-token-provider.ts
var msxScope = "https://microsoftsales.crm.dynamics.com/.default";
var corpDomain = "@microsoft.com";
var refreshBufferMs = 300 * 1e3;
var AzureCliMsxTokenProvider = class {
	cachedToken;
	corpId;
	constructor(credential = new AzureCliCredential({ processTimeoutInMs: 3e4 })) {
		this.credential = credential;
	}
	async getAccessToken() {
		if (this.cachedToken && this.cachedToken.expiresOnTimestamp > Date.now() + refreshBufferMs) return this.cachedToken.token;
		const accessToken = await this.credential.getToken(msxScope);
		if (!accessToken) throw new Error("Azure CLI did not return an MSX access token.");
		this.corpId = readMicrosoftCorpId(accessToken.token);
		this.cachedToken = accessToken;
		return accessToken.token;
	}
	async getAuthStatus() {
		try {
			await this.getAccessToken();
			return {
				state: "ready",
				...this.corpId ? { displayName: this.corpId } : {},
				detail: `Azure CLI is signed in as ${this.corpId ?? "a Microsoft corporate user"}.`
			};
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Azure CLI authentication failed.";
			const normalized = detail.toLowerCase();
			return {
				state: normalized.includes("could not be found") || normalized.includes("not recognized") ? "cli-missing" : normalized.includes("aadsts65001") || normalized.includes("consent") ? "consent-required" : normalized.includes("aadsts50020") || normalized.includes("tenant") || normalized.includes("corporate identity") ? "tenant-mismatch" : "login-required",
				detail
			};
		}
	}
};
function readMicrosoftCorpId(accessToken) {
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
	].find((claim) => typeof claim === "string" && claim.toLowerCase().endsWith(corpDomain));
	if (!corpId) throw new Error("The active Azure CLI token is not a Microsoft corporate identity. Sign in with your @microsoft.com CORP ID.");
	return corpId;
}
//#endregion
//#region apps/desktop/electron/main/index.ts
var desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
var rendererFile = resolve(desktopRoot, "dist/renderer/index.html");
var preloadFile = resolve(desktopRoot, "dist-electron/preload/index.cjs");
var developmentUrl = process.env["VITE_DEV_SERVER_URL"];
var allowedRendererUrl = developmentUrl ?? pathToFileURL(rendererFile).toString();
var dataMode = process.env["TLC_DATA_MODE"] === "sample" ? "sample" : "live";
var tokenProvider = new AzureCliMsxTokenProvider();
var orchestrator = new ThinSliceOrchestrator(dataMode === "sample" ? new FixtureMsxConnector() : new LiveMsxConnector(tokenProvider), new FixtureMcemGuidanceConnector());
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
	ipcMain.handle("tlc:list-opportunities", (event, accountId) => {
		assertTrustedSender(event);
		return orchestrator.listOpportunities(z.string().min(1).parse(accountId));
	});
	ipcMain.handle("tlc:run-mcem-coach", (event, request) => {
		assertTrustedSender(event);
		return orchestrator.runMcemCoach(mcemRequestSchema.parse(request));
	});
	ipcMain.handle("tlc:open-evidence", async (event, rawUrl) => {
		assertTrustedSender(event);
		const url = new URL(z.string().url().parse(rawUrl));
		if (url.protocol !== "https:") throw new Error("Only HTTPS evidence links are allowed.");
		await shell.openExternal(url.toString());
	});
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
app.whenReady().then(() => {
	registerReadOnlyIpc();
	createWindow();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
export {};

//# sourceMappingURL=index.js.map