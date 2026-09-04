let electron = require("electron");
//#region apps/desktop/electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("tlc", {
	getDataStatus: () => electron.ipcRenderer.invoke("tlc:get-data-status"),
	connectMcem: () => electron.ipcRenderer.invoke("tlc:connect-mcem"),
	listAccounts: () => electron.ipcRenderer.invoke("tlc:list-accounts"),
	listOpportunities: (accountId) => electron.ipcRenderer.invoke("tlc:list-opportunities", accountId),
	runMcemCoach: (request) => electron.ipcRenderer.invoke("tlc:run-mcem-coach", request),
	runAgentTask: (request) => electron.ipcRenderer.invoke("tlc:run-agent-task", request),
	openEmailCompose: (request) => electron.ipcRenderer.invoke("tlc:open-email-compose", request),
	exportAgentResponse: (request) => electron.ipcRenderer.invoke("tlc:export-agent-response", request),
	openEvidence: (url) => electron.ipcRenderer.invoke("tlc:open-evidence", url)
});
//#endregion

//# sourceMappingURL=index.cjs.map