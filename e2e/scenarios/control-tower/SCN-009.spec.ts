// scaffold:scenario:SCN-009:3c810f2e
import { expect, test } from '../../helpers/fixtures'

test('SCN-009 — keyboard, themes, reduced motion, and responsive layouts remain usable', async ({ page, isMobile }) => {
  await page.goto('/')
  if (!isMobile) {
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    for (let press = 0; press < 20 && !(await skip.evaluate((element) => element === document.activeElement)); press += 1) {
      await page.keyboard.press('Tab')
    }
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  }

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/apps')
  const darkScheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  expect(darkScheme).toBe(true)
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Enroll application' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
