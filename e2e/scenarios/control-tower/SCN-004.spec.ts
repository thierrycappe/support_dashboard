// scaffold:scenario:SCN-004:dcead3ab
import { test, expect } from '@playwright/test'

test.describe.skip('SCN-004 — manual refresh from source', () => {
  test('refresh button updates the ticket from the source app', async ({ page }) => {
    await page.goto('/feedback/some-id')
    await page.getByRole('button', { name: 'Refresh from source' }).click()
    await expect(page.getByText('Refreshing…')).toBeVisible()
  })
})
