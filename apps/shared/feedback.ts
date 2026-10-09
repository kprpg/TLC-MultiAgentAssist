export const feedbackRepositoryUrl = 'https://github.com/kprpg/TLC-MultiAgentAssist'
export const feedbackScreenshotLimit = 4
export const feedbackScreenshotSizeLimit = 5 * 1024 * 1024

export interface FeedbackDraft {
    title: string
    description: string
    reproductionSteps: string
}

export interface FeedbackScreenshotSelection {
    accepted: File[]
    rejected: string[]
}

export function buildFeedbackIssueBody(draft: FeedbackDraft, hasScreenshots: boolean): string {
    const sections = [
        '## Description',
        draft.description.trim(),
        '## Steps to reproduce',
        draft.reproductionSteps.trim() || '_No reproduction steps provided._'
    ]
    if (hasScreenshots) {
        sections.push(
            '## Screenshots',
            '<!-- Paste the screenshot image copied by TLC MultiAgent Assist below this line. -->'
        )
    }
    sections.push('---', 'Submitted from TLC MultiAgent Assist.')
    return sections.join('\n\n')
}

export function buildFeedbackIssueUrl(draft: FeedbackDraft, hasScreenshots = false): string {
    const url = new URL(`${feedbackRepositoryUrl}/issues/new`)
    url.searchParams.set('title', draft.title.trim())
    url.searchParams.set('body', buildFeedbackIssueBody(draft, hasScreenshots))
    return url.toString()
}

export function selectFeedbackScreenshots(existingCount: number, files: readonly File[]): FeedbackScreenshotSelection {
    const accepted: File[] = []
    const rejected: string[] = []
    let remaining = Math.max(0, feedbackScreenshotLimit - existingCount)

    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            rejected.push(`${file.name} is not an image.`)
            continue
        }
        if (file.size > feedbackScreenshotSizeLimit) {
            rejected.push(`${file.name} is larger than 5 MB.`)
            continue
        }
        if (remaining === 0) {
            rejected.push(`A maximum of ${feedbackScreenshotLimit} screenshots can be added.`)
            continue
        }
        accepted.push(file)
        remaining -= 1
    }

    return { accepted, rejected }
}

interface LoadedFeedbackImage {
    image: HTMLImageElement
    width: number
    height: number
}

const screenshotSheetMaxWidth = 1_600
const screenshotSheetMaxHeight = 8_000
const screenshotSheetPadding = 24
const screenshotSheetGap = 16

async function loadFeedbackImage(file: File): Promise<HTMLImageElement> {
    const source = URL.createObjectURL(file)
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error(`${file.name} could not be read as an image.`))
            image.src = source
        })
    } finally {
        URL.revokeObjectURL(source)
    }
}

async function createScreenshotSheet(files: readonly File[]): Promise<Blob> {
    const images = await Promise.all(files.map(loadFeedbackImage))
    const availableWidth = screenshotSheetMaxWidth - screenshotSheetPadding * 2
    const initial = images.map((image): LoadedFeedbackImage => {
        const scale = Math.min(1, availableWidth / image.naturalWidth)
        return {
            image,
            width: Math.max(1, Math.round(image.naturalWidth * scale)),
            height: Math.max(1, Math.round(image.naturalHeight * scale))
        }
    })
    const gaps = screenshotSheetGap * Math.max(0, initial.length - 1)
    const availableHeight = screenshotSheetMaxHeight - screenshotSheetPadding * 2 - gaps
    const heightScale = Math.min(1, availableHeight / initial.reduce((sum, item) => sum + item.height, 0))
    const rendered = initial.map((item): LoadedFeedbackImage => ({
        image: item.image,
        width: Math.max(1, Math.round(item.width * heightScale)),
        height: Math.max(1, Math.round(item.height * heightScale))
    }))
    const width = Math.max(...rendered.map((item) => item.width)) + screenshotSheetPadding * 2
    const height = rendered.reduce((sum, item) => sum + item.height, 0) + gaps + screenshotSheetPadding * 2
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Screenshots could not be prepared for the clipboard.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    let y = screenshotSheetPadding
    for (const item of rendered) {
        context.drawImage(item.image, Math.round((width - item.width) / 2), y, item.width, item.height)
        y += item.height + screenshotSheetGap
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Screenshots could not be encoded for the clipboard.')
    return blob
}

export async function copyFeedbackScreenshots(files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard access is not available in this host.')
    }
    const sheet = createScreenshotSheet(files)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': sheet })])
}
