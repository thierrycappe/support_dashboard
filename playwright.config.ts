import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { resolveSupportE2eBaseUrl } from './e2e/setup/environment'

const BASE_URL = resolveSupportE2eBaseUrl()
const AUTH_FILE = resolve(process.cwd(), 'playwright/.auth/admin.json')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    ['list', { printSteps: true }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'exec node_modules/.bin/tsx e2e/setup/launch-server.ts',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
  },

  projects: [
    {
      name: 'setup',
      testMatch: /setup\/auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: /SCN-0(?:0[5-9]|10)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'], storageState: AUTH_FILE },
      testMatch: /SCN-009\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'], storageState: AUTH_FILE },
      testMatch: /SCN-009\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
})
