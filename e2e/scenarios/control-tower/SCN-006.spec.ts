// scaffold:scenario:SCN-006:a438a71a
import { randomUUID } from 'node:crypto'
import { enrollConnector, escalationPayload, exchangeServiceToken, expect, test } from '../../helpers/fixtures'

test('SCN-006 — a generated connector key exchanges an invitation and submits a visible escalation', async ({ page, request, scenario }) => {
  const connector = await enrollConnector(request, scenario, 'versioned')
  const accessToken = await exchangeServiceToken(request, connector)
  const title = `Versioned escalation ${scenario.id}`
  const response = await request.post('/api/v1/escalations', {
    headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': randomUUID() },
    data: escalationPayload(`${scenario.id}-ticket`, title),
  })
  expect(response.status()).toBe(201)
  expect(await response.json()).toMatchObject({ result: 'created' })

  await page.goto('/')
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current delivery' })).toBeVisible()
  await expect(page.getByText('E2E channel', { exact: true })).toBeVisible()
})
