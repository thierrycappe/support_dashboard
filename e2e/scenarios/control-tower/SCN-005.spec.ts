// scaffold:scenario:SCN-005:5f419cf3
import { test, expect } from '../../helpers/fixtures'

test('SCN-005 — an administrator enrolls an application and sees its invitation once', async ({ page, scenario }) => {
  const slug = `${scenario.id}-app`
  const name = `Atlas ${scenario.id.slice(-8)}`
  await page.goto('/apps/new')
  await page.getByLabel('Application name').fill(name)
  await page.getByLabel('Stable slug').fill(slug)
  await page.getByLabel('Application URL').fill('https://atlas.example.test')
  await page.getByRole('button', { name: 'Continue to owners' }).click()
  await page.getByRole('checkbox', { name: /Morgan Lee/ }).check()
  await page.getByRole('button', { name: 'Continue to alerts' }).click()
  await page.getByRole('button', { name: 'Create invitation' }).click()

  const invitationId = page.getByRole('definition').filter({ has: page.locator('code') }).first()
  const invitationSecret = page.getByRole('definition').filter({ has: page.locator('code') }).nth(1)
  await expect(page.getByRole('heading', { name: 'Invitation created' })).toBeVisible()
  await expect(invitationId).not.toBeEmpty()
  await expect(invitationSecret).not.toBeEmpty()
  const secret = await invitationSecret.textContent()

  await page.getByRole('checkbox', { name: /stored this invitation/ }).check()
  await page.getByRole('button', { name: 'Hide invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation hidden' })).toBeVisible()
  await expect(page.getByText(secret!)).toHaveCount(0)
  await page.getByRole('link', { name: 'View application' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText(secret!)).toHaveCount(0)
  await expect(page.getByText('Available')).toBeVisible()
})
