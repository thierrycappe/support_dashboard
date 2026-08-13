import { describe, expect, it } from 'vitest'
import { buildSupportE2eEnvironment, resolveSupportE2eBaseUrl, resolveSupportE2ePort } from '../../e2e/setup/environment'
import { dockerServerArguments } from '../../e2e/setup/container-launcher'

describe('support Playwright environment safety', () => {
  it.each([
    'https://support.example.com',
    'http://10.0.0.4:3000',
    'http://user:password@127.0.0.1:3000',
    'ftp://127.0.0.1:3000',
  ])('rejects unsafe base URL %s by default', (value) => {
    expect(() => resolveSupportE2eBaseUrl({ PLAYWRIGHT_BASE_URL: value })).toThrow('Refusing support E2E target')
  })

  it('does not permit the mutation suite to target a deployment through an environment override', () => {
    expect(() => resolveSupportE2eBaseUrl({
      PLAYWRIGHT_BASE_URL: 'https://staging.example.test', ALLOW_SUPPORT_E2E: '1',
    })).toThrow('Refusing support E2E target')
  })

  it('derives the container port from the validated non-default loopback base URL', () => {
    expect(resolveSupportE2ePort({ PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:39127' })).toBe('39127')
    expect(resolveSupportE2ePort({ PLAYWRIGHT_BASE_URL: 'http://localhost' })).toBe('80')
  })

  it.each([
    'http://127.0.0.1:3000/apps',
    'http://127.0.0.1:3000/?target=remote',
    'http://127.0.0.1:3000/#fragment',
  ])('rejects a loopback base URL with path, query, or hash: %s', (value) => {
    expect(() => resolveSupportE2eBaseUrl({ PLAYWRIGHT_BASE_URL: value })).toThrow('Refusing support E2E target')
  })

  it('constructs an allowlisted child environment without inherited provider or keyring credentials', () => {
    const child = buildSupportE2eEnvironment({
      PATH: '/safe/bin', HOME: '/Users/test', NODE_OPTIONS: '--inspect',
      RESEND_API_KEY: 'must-not-leak', RESEND_FROM: 'must-not-leak',
      PUSHOVER_APP_TOKEN: 'must-not-leak', PUSHOVER_USER_KEY: 'must-not-leak',
      SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON: 'must-not-leak',
      SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK: 'must-not-leak',
      DATABASE_URL: 'must-not-leak', CRON_SECRET: 'must-not-leak',
    }, { DATABASE_URL: 'approved-test-url', CRON_SECRET: 'fictional-cron' })

    expect(child).toEqual(expect.objectContaining({
      PATH: '/safe/bin', DATABASE_URL: 'approved-test-url', CRON_SECRET: 'fictional-cron',
    }))
    expect(child).not.toHaveProperty('HOME')
    expect(child).not.toHaveProperty('NODE_OPTIONS')
    expect(child).not.toHaveProperty('RESEND_API_KEY')
    expect(child).not.toHaveProperty('RESEND_FROM')
    expect(child).not.toHaveProperty('PUSHOVER_APP_TOKEN')
    expect(child).not.toHaveProperty('PUSHOVER_USER_KEY')
    expect(child).not.toHaveProperty('SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON')
    expect(child.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK).not.toBe('must-not-leak')
  })

  it('passes runtime configuration through a protected env file rather than Docker command arguments', () => {
    const args = dockerServerArguments({
      containerName: 'support-e2e-run', networkName: 'support-e2e-network',
      port: '3017', envFile: '/tmp/support-e2e.env', runtimeDirectory: '/tmp/support-e2e-runtime',
    })

    expect(args).toEqual([
      'run', '--rm', '--label', 'support.task22.e2e=1', '--name', 'support-e2e-run', '--network', 'support-e2e-network',
      '--ip', '93.184.216.34', '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1:3017:3017', '--env-file', '/tmp/support-e2e.env',
      '-v', '/tmp/support-e2e-runtime:/app/playwright/.runtime', 'support-dashboard-task22-e2e',
    ])
    expect(args.join(' ')).not.toContain('postgresql://')
    expect(args.join(' ')).not.toContain('AUTH_SECRET')
  })
})
