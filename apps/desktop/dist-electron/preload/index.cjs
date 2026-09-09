let electron = require("electron");
//#region apps/desktop/electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("tlc", {
	exitApplication: () => electron.ipcRenderer.invoke("tlc:exit-application"),
	getDataStatus: () => electron.ipcRenderer.invoke("tlc:get-data-status"),
	connectMcem: () => electron.ipcRenderer.invoke("tlc:connect-mcem"),
	listAccounts: () => electron.ipcRenderer.invoke("tlc:list-accounts"),
	listOpportunities: (accountId) => electron.ipcRenderer.invoke("tlc:list-opportunities", accountId),
	listMilestones: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-milestones", opportunityId),
	updateMilestone: (opportunityId, milestoneId, update) => electron.ipcRenderer.invoke("tlc:update-milestone", opportunityId, milestoneId, update),
	updateOpportunity: (opportunityId, update) => electron.ipcRenderer.invoke("tlc:update-opportunity", opportunityId, update),
	runMcemCoach: (request) => electron.ipcRenderer.invoke("tlc:run-mcem-coach", request),
	transitionOpportunityStage: (request) => electron.ipcRenderer.invoke("tlc:transition-opportunity-stage", request),
	runAgentTask: (request) => electron.ipcRenderer.invoke("tlc:run-agent-task", request),
	openEmailCompose: (request) => electron.ipcRenderer.invoke("tlc:open-email-compose", request),
	exportAgentResponse: (request) => electron.ipcRenderer.invoke("tlc:export-agent-response", request),
	openEvidence: (url) => electron.ipcRenderer.invoke("tlc:open-evidence", url)
});
//#endregion

//# sourceMappingURL=index.cjs.map