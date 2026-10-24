import { expect, type Locator, type Page } from '@playwright/test'
import { expectTextContrast } from './color-contrast.js'

declare global {
    interface Window {
        customerEmailClipboard: { texts: string[]; fail: boolean }
    }
}

export async function installCustomerEmailClipboard(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.customerEmailClipboard = { texts: [], fail: false }
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (text: string) => {
                if (window.customerEmailClipboard.fail) throw new Error('Clipboard permission denied.')
                window.customerEmailClipboard.texts.push(text)
            } }
        })
    })
}

export async function expectCopiedCustomerEmail(page: Page, actions: Locator): Promise<void> {
    await expect(actions.getByRole('button', { name: 'E-mail', exact: true })).toBeEnabled()
    await expectTextContrast(actions.getByRole('button', { name: 'E-mail', exact: true }))
    await expectTextContrast(actions.getByRole('button', { name: 'Copy', exact: true }))
    await expect(actions).toContainText('Nothing is sent automatically.')
    await actions.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(actions.getByRole('status')).toContainText('copied')
    const text = await page.evaluate(() => window.customerEmailClipboard.texts.at(-1))
    expect(text).toContain('Subject: Confirming the approval path\n\nPlease confirm the sponsor and approval sequence.')
    expect(text).toContain('Confirm sponsor')
    expect(text).not.toContain('**')
    expect(text).not.toContain('Assumptions and missing information')
    expect(text).not.toContain('Feedback prompt')
    expect(text).not.toContain('executive brief')
}

export function expectUnsentCustomerEmail(message: string): void {
    expect(message).toContain('X-Unsent: 1')
    const encodedSubject = message.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1]
    expect(Buffer.from(encodedSubject ?? '', 'base64').toString('utf8')).toBe('Confirming the approval path')
    const encodedText = message.match(/Content-Type: text\/plain; charset="UTF-8"\r?\nContent-Transfer-Encoding: base64\r?\n\r?\n([\s\S]*?)\r?\n--/)?.[1]
    const text = Buffer.from(encodedText ?? '', 'base64').toString('utf8')
    expect(text).toContain('Please confirm the sponsor and approval sequence.')
    expect(text).toContain('Confirm sponsor')
    expect(text).not.toContain('Assumptions and missing information')
    expect(text).not.toContain('Feedback prompt')
}
