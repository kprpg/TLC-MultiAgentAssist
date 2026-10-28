import { expect, type Locator } from '@playwright/test'

export async function expectWorkingSessionIcon(button: Locator): Promise<void> {
  await expect(button).toHaveAttribute('title', 'Generate Prep/ Delivery Artifacts')
  await expect(button).toHaveAttribute('aria-label', 'Generate Prep/ Delivery Artifacts')
  await expect(button).toHaveText('')
  await expect(button).toHaveCSS('width', '32px')
  await expect(button).toHaveCSS('height', '32px')
  const icon = button.locator('img')
  await expect(icon).toHaveAttribute('alt', '')
  await expect(icon).toHaveCSS('width', '24px')
  await expect(icon).toHaveCSS('height', '24px')
  await expect.poll(() => icon.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
}
