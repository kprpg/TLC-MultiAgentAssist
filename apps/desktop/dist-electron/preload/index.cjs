let electron = require("electron");
//#region apps/desktop/electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("tlc", {
	getDataStatus: () => electron.ipcRenderer.invoke("tlc:get-data-status"),
	listAccounts: () => electron.ipcRenderer.invoke("tlc:list-accounts"),
	listOpportunities: (accountId) => electron.ipcRenderer.invoke("tlc:list-opportunities", accountId),
	runMcemCoach: (request) => electron.ipcRenderer.invoke("tlc:run-mcem-coach", request),
	openEvidence: (url) => electron.ipcRenderer.invoke("tlc:open-evidence", url)
});
//#endregion

//# sourceMappingURL=index.cjs.map