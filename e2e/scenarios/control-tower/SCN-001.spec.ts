// scaffold:scenario:SCN-001:0949bb3a
import { test, expect } from '@playwright/test'

test('support tower setup page explains missing database configuration', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Database not configured')).toBeVisible()
})
