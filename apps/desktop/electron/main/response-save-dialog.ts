export interface ResponseSaveDialogOptions {
    title: string
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
    properties: Array<'createDirectory' | 'showOverwriteConfirmation'>
}

export interface ResponseSaveDialogResult {
    canceled: boolean
    filePath?: string
}

export function showResponseSaveDialog<TParent>(
    parent: TParent | undefined,
    defaultPath: string,
    showDialog: (options: ResponseSaveDialogOptions, parent?: TParent) => Promise<ResponseSaveDialogResult>
): Promise<ResponseSaveDialogResult> {
    return showDialog({
        title: 'Export agent response',
        defaultPath,
        filters: [{ name: 'Microsoft Word document', extensions: ['docx'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
    }, parent)
}
