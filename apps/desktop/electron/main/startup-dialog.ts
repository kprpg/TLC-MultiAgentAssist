export interface StartupDialogApp {
    whenReady(): Promise<void>
    quit(): void
}

export interface StartupDialog {
    showMessageBox(options: {
        type: 'info'
        title: string
        message: string
        detail: string
        buttons: string[]
        defaultId: number
        cancelId: number
        noLink: boolean
    }): Promise<{ response: number }>
}

export interface StartupDialogShell {
    openPath(path: string): Promise<string>
    showItemInFolder(path: string): void
}

export async function openConfigurationAndExit(
    application: StartupDialogApp,
    dialog: StartupDialog,
    shell: StartupDialogShell,
    filePath: string,
    detail: string
): Promise<void> {
    await application.whenReady()
    const result = await dialog.showMessageBox({
        type: 'info',
        title: 'TLC MultiAgent Assist setup',
        message: 'Configure your environment before starting TLC MultiAgent Assist.',
        detail: `${detail}\n\nConfiguration file:\n${filePath}`,
        buttons: ['Open configuration', 'Exit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
    })
    if (result.response === 0) {
        const openError = await shell.openPath(filePath)
        if (openError) shell.showItemInFolder(filePath)
    }
    application.quit()
}