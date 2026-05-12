// scaffold:scenario:SCN-002:6f6f3900
import { test, expect } from '@playwright/test'

test.describe.skip('SCN-002 — stale-sync indicator', () => {
  test('renders the stale badge on open tickets whose last sync exceeds 48h', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Stale sync')).toBeVisible()
  })
})
