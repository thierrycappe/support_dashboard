// scaffold:scenario:SCN-001:7ee3ad77
import { test, expect } from '@playwright/test'

test('support tower setup page explains missing database configuration', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Database not configured')).toBeVisible()
})
