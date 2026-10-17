let electron = require("electron");
//#region apps/desktop/electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("tlc", {
	invokeSellerDashboard: (request) => electron.ipcRenderer.invoke("tlc:seller-dashboard", request),
	invokeVoice: (request) => electron.ipcRenderer.invoke("tlc:voice-input", request),
	exitApplication: () => electron.ipcRenderer.invoke("tlc:exit-application"),
	getDataStatus: () => electron.ipcRenderer.invoke("tlc:get-data-status"),
	connectMcem: () => electron.ipcRenderer.invoke("tlc:connect-mcem"),
	listAccounts: (options) => electron.ipcRenderer.invoke("tlc:list-accounts", options),
	searchAccounts: (request) => electron.ipcRenderer.invoke("tlc:search-accounts", request),
	addAccount: (accountId) => electron.ipcRenderer.invoke("tlc:add-account", accountId),
	setAccountVisibility: (accountId, visibility) => electron.ipcRenderer.invoke("tlc:set-account-visibility", accountId, visibility),
	listOpportunities: (accountId) => electron.ipcRenderer.invoke("tlc:list-opportunities", accountId),
	getRecordCreationCatalog: (request) => electron.ipcRenderer.invoke("tlc:get-record-creation-catalog", request),
	previewRecordCreation: (request) => electron.ipcRenderer.invoke("tlc:preview-record-creation", request),
	commitRecordCreation: (request) => electron.ipcRenderer.invoke("tlc:commit-record-creation", request),
	exportRecordCreationDraft: (request) => electron.ipcRenderer.invoke("tlc:export-record-creation-draft", request),
	discoverOpportunities: (domain) => electron.ipcRenderer.invoke("tlc:discover-opportunities", domain),
	joinDealTeam: (opportunityId) => electron.ipcRenderer.invoke("tlc:join-deal-team", opportunityId),
	leaveDealTeam: (opportunityId) => electron.ipcRenderer.invoke("tlc:leave-deal-team", opportunityId),
	joinMilestoneTeam: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:join-milestone-team", opportunityId, milestoneId),
	leaveMilestoneTeam: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:leave-milestone-team", opportunityId, milestoneId),
	listMilestones: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-milestones", opportunityId),
	listDiscoverableMilestones: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-discoverable-milestones", opportunityId),
	listMilestoneActivities: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:list-milestone-activities", opportunityId, milestoneId),
	createMilestoneActivity: (opportunityId, milestoneId, request) => electron.ipcRenderer.invoke("tlc:create-milestone-activity", opportunityId, milestoneId, request),
	listMeetingTranscripts: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-meeting-transcripts", opportunityId),
	getMeetingTranscript: (transcriptId) => electron.ipcRenderer.invoke("tlc:get-meeting-transcript", transcriptId),
	proposeMeetingChangeSet: (request) => electron.ipcRenderer.invoke("tlc:propose-meeting-change-set", request),
	applyMeetingChangeSet: (proposal, approval) => electron.ipcRenderer.invoke("tlc:apply-meeting-change-set", proposal, approval),
	updateMilestone: (opportunityId, milestoneId, update) => electron.ipcRenderer.invoke("tlc:update-milestone", opportunityId, milestoneId, update),
	updateOpportunity: (opportunityId, update) => electron.ipcRenderer.invoke("tlc:update-opportunity", opportunityId, update),
	runMcemCoach: (request) => electron.ipcRenderer.invoke("tlc:run-mcem-coach", request),
	transitionOpportunityStage: (request) => electron.ipcRenderer.invoke("tlc:transition-opportunity-stage", request),
	runAgentTask: (request) => electron.ipcRenderer.invoke("tlc:run-agent-task", request),
	openEmailCompose: (request) => electron.ipcRenderer.invoke("tlc:open-email-compose", request),
	exportAgentResponse: (request) => electron.ipcRenderer.invoke("tlc:export-agent-response", request),
	openEvidence: (url) => electron.ipcRenderer.invoke("tlc:open-evidence", url),
	invokeWorkflow: (operation, request) => electron.ipcRenderer.invoke(`tlc:workflow-${operation}`, request)
});
//#endregion

//# sourceMappingURL=index.cjs.map