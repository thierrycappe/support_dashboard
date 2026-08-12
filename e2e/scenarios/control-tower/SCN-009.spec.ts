// scaffold:scenario:SCN-009:3c810f2e
import { expect, test } from '../../helpers/fixtures'

test('SCN-009 — keyboard, themes, reduced motion, and responsive layouts remain usable', async ({ page, isMobile }) => {
  await page.goto('/')
  if (!isMobile) {
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await page.keyboard.press('Shift+Tab')
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  }

  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/apps')
  const lightColors = await shippedColors(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  const darkColors = await shippedColors(page)
  expect(darkColors.colorScheme).toBe('dark')
  expect(darkColors.background).not.toBe(lightColors.background)
  expect(darkColors.foreground).not.toBe(lightColors.foreground)
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()

  const themeButton = page.getByRole('button', { name: 'Use dark theme' })
  const normalDurations = await transitionDurationsInSeconds(themeButton)
  expect(normalDurations.some((duration) => duration > 0.01)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDurations = await transitionDurationsInSeconds(themeButton)
  expect(reducedDurations.length).toBeGreaterThan(0)
  expect(reducedDurations.every((duration) => duration <= 0.00001)).toBe(true)
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

async function shippedColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }))
}

async function transitionDurationsInSeconds(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => getComputedStyle(element).transitionDuration.split(',').map((raw) => {
    const duration = raw.trim()
    return duration.endsWith('ms') ? Number.parseFloat(duration) / 1_000 : Number.parseFloat(duration)
  }))
}
