// scaffold:scenario:SCN-003:139fc186
import { test, expect } from '@playwright/test'

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
