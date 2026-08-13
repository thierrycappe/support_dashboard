import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { describe, expect, it } from 'vitest'

describe('escalation filter layout', () => {
  it('keeps application clear of a narrower priority control on wide screens', async () => {
    const browser = await chromium.launch({ headless: true })

    try {
      const page = await browser.newPage({ viewport: { width: 2048, height: 900 } })
      const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')

      await page.setContent(`
        <style>${css}</style>
        <form class="queue-filters" style="box-sizing: border-box; width: 1900px">
          <div class="field"><label for="search">Search</label><input id="search" value="" /></div>
          <div class="field"><label for="application">Application</label><select id="application"><option>All applications</option></select></div>
          <div class="field"><label for="priority">Priority</label><select id="priority"><option>All priorities</option></select></div>
          <div class="field"><label for="status">Status</label><select id="status"><option>Open statuses</option></select></div>
          <div class="queue-filter-actions">
            <button class="ui-button ui-button-primary">Apply filters</button>
            <a class="ui-button ui-button-secondary">Clear filters</a>
          </div>
        </form>
      `)

      const application = await page.getByLabel('Application').boundingBox()
      const priority = await page.getByLabel('Priority').boundingBox()

      expect(application).not.toBeNull()
      expect(priority).not.toBeNull()
      expect(application!.width - priority!.width).toBeGreaterThanOrEqual(80)
      expect(priority!.x - (application!.x + application!.width)).toBeGreaterThanOrEqual(12)
    } finally {
      await browser.close()
    }
  })
})
