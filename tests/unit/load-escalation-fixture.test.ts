import { describe, expect, it, vi } from 'vitest'

import {
  buildPortalEnvironment,
  buildPortalProcesses,
  buildProxyHeaders,
  coordinateDisposableLoadFixture,
  coordinatePortalStartup,
  fixtureSeedStatements,
  requireDisposableTestDatabaseUrl,
} from '@/scripts/run-load-escalation-fixture'

describe('disposable escalation load fixture', () => {
  it('accepts only an explicitly marked local disposable database', () => {
    expect(requireDisposableTestDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55442/support_release_test?support_test=1',
    })).toBe('postgresql://postgres@127.0.0.1:55442/support_release_test?support_test=1')

    for (const value of [
      undefined,
      'postgresql://postgres@127.0.0.1:55442/support_release',
      'postgresql://postgres@127.0.0.1:55442/support_release_test',
      'postgresql://postgres@db.example.test/support_release_test?support_test=1',
      'postgresql://postgres@127.0.0.1:55442/support_release_test?support_test=1&host=remote-db.example.test',
      'postgresql://postgres@127.0.0.1:55442/support_release_test?support_test=1&port=5433',
      'postgresql://postgres@127.0.0.1:55442/support_release_test?support_test=1&sslmode=require',
    ]) {
      expect(() => requireDisposableTestDatabaseUrl({ TEST_DATABASE_URL: value })).toThrow(
        'Disposable load verification requires a marked local test database',
      )
    }
  })

  it('seeds, starts, verifies, and tears down in order', async () => {
    const calls: string[] = []

    await coordinateDisposableLoadFixture({
      prepare: async () => { calls.push('prepare'); return { fixture: true } },
      seed: async () => { calls.push('seed') },
      start: async () => { calls.push('start'); return { stop: async () => { calls.push('stop') } } },
      ready: async () => { calls.push('ready') },
      verify: async () => { calls.push('verify') },
      cleanupFixture: async () => { calls.push('cleanup-fixture') },
      cleanupFiles: async () => { calls.push('cleanup-files') },
    })

    expect(calls).toEqual([
      'prepare', 'seed', 'start', 'ready', 'verify', 'stop', 'cleanup-fixture', 'cleanup-files',
    ])
  })

  it('stops the server and removes fixture data and files after a failed verification', async () => {
    const stop = vi.fn(async () => undefined)
    const cleanupFixture = vi.fn(async () => undefined)
    const cleanupFiles = vi.fn(async () => undefined)

    await expect(coordinateDisposableLoadFixture({
      prepare: async () => ({ fixture: true }),
      seed: async () => undefined,
      start: async () => ({ stop }),
      ready: async () => undefined,
      verify: async () => { throw new Error('injected load failure') },
      cleanupFixture,
      cleanupFiles,
    })).rejects.toThrow('injected load failure')

    expect(stop).toHaveBeenCalledOnce()
    expect(cleanupFixture).toHaveBeenCalledOnce()
    expect(cleanupFiles).toHaveBeenCalledOnce()
  })

  it('closes a listening proxy when the application process cannot start', async () => {
    const stopProxy = vi.fn(async () => undefined)

    await expect(coordinatePortalStartup({
      startProxy: async () => ({ stop: stopProxy }),
      startChild: async () => { throw new Error('injected spawn failure') },
    })).rejects.toThrow('injected spawn failure')

    expect(stopProxy).toHaveBeenCalledOnce()
  })

  it('returns one stop handle that settles both successful startup resources', async () => {
    const stopProxy = vi.fn(async () => undefined)
    const stopChild = vi.fn(async () => undefined)
    const server = await coordinatePortalStartup({
      startProxy: async () => ({ stop: stopProxy }),
      startChild: async () => ({ stop: stopChild }),
    })

    await server.stop()
    expect(stopProxy).toHaveBeenCalledOnce()
    expect(stopChild).toHaveBeenCalledOnce()
  })

  it('still stops the application process when proxy shutdown fails', async () => {
    const stopChild = vi.fn(async () => undefined)
    const server = await coordinatePortalStartup({
      startProxy: async () => ({ stop: async () => { throw new Error('injected proxy close failure') } }),
      startChild: async () => ({ stop: stopChild }),
    })

    await expect(server.stop()).rejects.toThrow('injected proxy close failure')
    expect(stopChild).toHaveBeenCalledOnce()
  })

  it('seeds only randomized fixture rows without broad database mutations', () => {
    const statements = fixtureSeedStatements({
      appId: 'load-test-random-app',
      credentialId: 'load-credential-random',
      groupId: 'load-group-random',
      channelId: 'load-channel-random',
      publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'fictional' },
      publicKeyThumbprint: 'fictional-thumbprint',
    })

    expect(statements).toHaveLength(4)
    expect(statements.every(({ text }) => /^\s*insert into /i.test(text))).toBe(true)
    expect(statements.map(({ values }) => values[0])).toEqual([
      'load-group-random',
      'load-test-random-app',
      'load-credential-random',
      'load-channel-random',
    ])
    expect(statements.map(({ text }) => text.toLowerCase().includes('truncate'))).not.toContain(true)
    expect(statements.map(({ text }) => text.toLowerCase().includes('delete from'))).not.toContain(true)
  })

  it('passes only explicit system values and generated fixture configuration to Next', () => {
    const environment = buildPortalEnvironment({
      PATH: '/safe/bin',
      HOME: '/safe/home',
      CI: '1',
      PUSHOVER_APP_TOKEN: 'live-pushover-secret',
      PUSHOVER_USER_KEY: 'live-pushover-user',
      RESEND_API_KEY: 'live-email-secret',
      SUPPORT_TOWER_CHANNEL_KEYRING_JSON: 'live-channel-keyring',
      SUPPORT_TOWER_SOURCE_APP_PULL_JSON: 'live-source-pull-token',
      CRON_SECRET: 'live-cron-secret',
      DATABASE_URL: 'live-database',
    }, {
      databaseUrl: 'postgresql://localhost/release_test?support_test=1',
      authSecret: 'generated-auth',
      signingJwk: '{"d":"generated-signing-key"}',
      publicUrl: 'https://localhost:3443',
    })

    expect(environment).toEqual({
      PATH: '/safe/bin',
      HOME: '/safe/home',
      CI: '1',
      DATABASE_URL: 'postgresql://localhost/release_test?support_test=1',
      AUTH_SECRET: 'generated-auth',
      AUTH_TRUST_HOST: 'true',
      SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK: '{"d":"generated-signing-key"}',
      SUPPORT_TOWER_PUBLIC_URL: 'https://localhost:3443',
      DATABASE_POOL_MAX: '5',
    })
  })

  it('serves the production build through a bounded localhost HTTPS proxy', () => {
    expect(buildPortalProcesses({ appPort: 3101, httpsPort: 3443 })).toEqual({
      build: { command: 'npm', args: ['run', 'build'] },
      app: { command: 'node_modules/.bin/next', args: ['start', '--hostname', '127.0.0.1', '--port', '3101'] },
      proxy: { upstreamOrigin: 'http://127.0.0.1:3101', listenHost: '127.0.0.1', listenPort: 3443 },
    })
    expect(buildProxyHeaders({ host: 'localhost:3443', authorization: 'Bearer fictional' }, 3443)).toEqual({
      host: 'localhost:3443',
      authorization: 'Bearer fictional',
      'x-forwarded-host': 'localhost:3443',
      'x-forwarded-proto': 'https',
    })
  })
})
