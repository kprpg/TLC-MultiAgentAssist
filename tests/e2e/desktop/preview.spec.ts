import { expect, test, _electron as electron } from '@playwright/test'
import type { WebContents } from 'electron'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

test('launches the secure MCEM operational workbench', async () => {
  const capturePath = resolve('test-results', 'electron-preview', 'foundry-context.json')
  await rm(capturePath, { force: true })
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: {
      ...process.env,
      TLC_DATA_MODE: 'sample',
      TLC_SMOKE_FOUNDRY_CAPTURE_PATH: capturePath
    }
  })

  try {
    const window = await app.firstWindow()
    const pageErrors: Error[] = []
    window.on('pageerror', (error) => pageErrors.push(error))
    await expect(window).toHaveTitle('TLC Account Team Intelligence')
    await expect(window.getByText('SAMPLE DATA')).toBeVisible()
    await expect(window.getByText('Evidence supports', { exact: true })).toBeVisible()
    await expect(window.getByText('NEXT BEST ACTIONS')).toBeVisible()
    await expect(window.getByText('Stage 2', { exact: true })).toBeVisible()

    await expect.poll(async () => {
      const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
        request: { accountId: string; opportunityId: string }
        opportunityContext: { account: { name: string }; opportunity: { name: string } }
        guidance: { criteria: unknown[] }
        localEvaluation: { evidence: unknown[] }
      }
      return {
        accountId: capture.request.accountId,
        opportunityId: capture.request.opportunityId,
        accountName: capture.opportunityContext.account.name,
        opportunityName: capture.opportunityContext.opportunity.name,
        hasGuidance: capture.guidance.criteria.length > 0,
        hasEvidence: capture.localEvaluation.evidence.length > 0
      }
    }).toEqual({
      accountId: 'account-contoso',
      opportunityId: 'opp-grid-modernization',
      accountName: 'Contoso Energy',
      opportunityName: 'Grid operations modernization',
      hasGuidance: true,
      hasEvidence: true
    })

    const startingTheme = await window.locator('html').getAttribute('data-theme')
    const nextTheme = startingTheme === 'dark' ? 'light' : 'dark'
    const themeButton = window.getByRole('button', { name: `Use ${nextTheme} mode` })
    const themeBoxBeforeHover = await themeButton.boundingBox()
    expect(themeBoxBeforeHover).not.toBeNull()
    await themeButton.hover()
    expect(await themeButton.boundingBox()).toEqual(themeBoxBeforeHover)
    await expect(window.locator('html')).toHaveAttribute('data-theme', startingTheme!)

    const refreshButton = window.getByRole('button', { name: 'Refresh analysis' })
    const refreshBoxBeforeHover = await refreshButton.boundingBox()
    expect(refreshBoxBeforeHover).not.toBeNull()
    expect(refreshBoxBeforeHover!.width).toBeCloseTo(32, 4)
    expect(refreshBoxBeforeHover!.height).toBeCloseTo(32, 4)
    await refreshButton.hover()
    const refreshBoxAfterHover = await refreshButton.boundingBox()
    expect(refreshBoxAfterHover).not.toBeNull()
    expect(refreshBoxAfterHover!.x).toBeCloseTo(refreshBoxBeforeHover!.x, 4)
    expect(refreshBoxAfterHover!.y).toBeCloseTo(refreshBoxBeforeHover!.y, 4)
    expect(refreshBoxAfterHover!.width).toBeCloseTo(refreshBoxBeforeHover!.width, 4)
    expect(refreshBoxAfterHover!.height).toBeCloseTo(refreshBoxBeforeHover!.height, 4)
    await expect(window.getByText('Stage 2', { exact: true })).toBeVisible()

    const contextRail = window.locator('.context-rail')
    const accountDropdown = contextRail.locator('[role="combobox"]').nth(0)
    const opportunityDropdown = contextRail.locator('[role="combobox"]').nth(1)
    const contextRailBox = await contextRail.boundingBox()
    const accountBox = await accountDropdown.boundingBox()
    const opportunityBox = await opportunityDropdown.boundingBox()
    expect(contextRailBox).not.toBeNull()
    expect(accountBox).not.toBeNull()
    expect(opportunityBox).not.toBeNull()
    expect(accountBox!.x + accountBox!.width).toBeLessThan(contextRailBox!.x + contextRailBox!.width)
    expect(opportunityBox!.x + opportunityBox!.width).toBeLessThan(contextRailBox!.x + contextRailBox!.width)

    await expect(accountDropdown).toContainText('Contoso Energy')
    await accountDropdown.click()
    await expect(window.getByRole('option', { name: 'Fabrikam Retail' })).toBeVisible()
    await window.getByRole('option', { name: 'Fabrikam Retail' }).click()
    await expect(accountDropdown).toContainText('Fabrikam Retail')
    await expect(window.getByRole('heading', { name: 'AI-assisted customer service' })).toBeVisible()

    await expect(opportunityDropdown).toContainText('AI-assisted customer service')
    await opportunityDropdown.click()
    await expect(window.getByRole('option', { name: 'AI-assisted customer service' })).toBeVisible()
    await window.getByRole('option', { name: 'AI-assisted customer service' }).click()
    await expect(window.getByText('NEXT BEST ACTIONS')).toBeVisible()
    expect(pageErrors).toEqual([])

    await window.getByRole('button', { name: `Use ${nextTheme} mode` }).click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', nextTheme)
    await window.reload()
    await expect(window.locator('html')).toHaveAttribute('data-theme', nextTheme)
    await expect(window.getByRole('button', { name: `Use ${startingTheme} mode` })).toBeVisible()

    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const [mainWindow] = BrowserWindow.getAllWindows()
      const webContents = mainWindow?.webContents as WebContents & {
        getLastWebPreferences(): {
          contextIsolation?: boolean
          sandbox?: boolean
          nodeIntegration?: boolean
        }
      }
      return webContents?.getLastWebPreferences()
    })
    expect(preferences?.contextIsolation).toBe(true)
    expect(preferences?.sandbox).toBe(true)
    expect(preferences?.nodeIntegration).toBe(false)

    const screenshotDirectory = resolve('test-results', 'electron-preview')
    await mkdir(screenshotDirectory, { recursive: true })
    await window.screenshot({
      path: resolve(screenshotDirectory, 'operational-workbench.png'),
      fullPage: true
    })
  } finally {
    await app.close()
  }
})