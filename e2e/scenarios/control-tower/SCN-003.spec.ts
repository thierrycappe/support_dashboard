// scaffold:scenario:SCN-003:686231f3
import { test, expect } from '@playwright/test'

// Intentionally skipped until Task 22 provisions authenticated source-app fixtures.
test.describe.skip('SCN-003 — periodic pull from configured source apps', () => {
  test('cron endpoint enumerates configured pull slugs and returns per-app counts', async ({ request }) => {
    const response = await request.get('/api/cron/sync-source-apps', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.ok).toBe(true)
  })
})
