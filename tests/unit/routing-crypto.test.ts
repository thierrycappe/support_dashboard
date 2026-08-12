import { describe, expect, it } from 'vitest'
import {
  decryptChannelConfig,
  encryptChannelConfig,
  parseChannelKeyring,
  type ChannelCryptoContext,
} from '@/lib/routing/crypto'
import { parseChannelConfig, validateChannelConfigForPersistence } from '@/lib/routing/channel-schemas'
import { validateWebhookTarget } from '@/lib/delivery/webhook-target'

const keyring = parseChannelKeyring(JSON.stringify({
  active: 'v1',
  keys: { v1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
}))
const context: ChannelCryptoContext = { channelId: 'channel-1', type: 'EMAIL' }
const config = { type: 'EMAIL' as const, to: ['alerts@example.test'] }

describe('channel configuration encryption', () => {
  it('matches the AES-256-GCM known answer and round trips the strict config', () => {
    const encrypted = encryptChannelConfig(config, context, keyring, Buffer.from('000102030405060708090a0b', 'hex'))

    expect(encrypted).toEqual({
      keyVersion: 'v1',
      nonce: 'AAECAwQFBgcICQoL',
      ciphertext: 'PCCidOffmTnsLfL5xZo4CPu36kScHnEIXRSRp0AU',
      authTag: 'zBJO0wTXPd4BC14JOM/HQA==',
    })
    expect(decryptChannelConfig(encrypted, context, keyring)).toEqual(config)
  })

  it('rejects a tampered ciphertext or changed channel/type AAD', () => {
    const encrypted = encryptChannelConfig(config, context, keyring, Buffer.from('000102030405060708090a0b', 'hex'))
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}B` }

    expect(() => decryptChannelConfig(tampered, context, keyring)).toThrow('Invalid encrypted channel configuration')
    expect(() => decryptChannelConfig(encrypted, { channelId: 'channel-2', type: 'EMAIL' }, keyring)).toThrow('Invalid encrypted channel configuration')
    expect(() => decryptChannelConfig(encrypted, { channelId: 'channel-1', type: 'PUSHOVER' }, keyring)).toThrow('Invalid encrypted channel configuration')
  })

  it('rejects an unknown key version and malformed strict adapter configuration', () => {
    const encrypted = encryptChannelConfig(config, context, keyring, Buffer.from('000102030405060708090a0b', 'hex'))

    expect(() => decryptChannelConfig({ ...encrypted, keyVersion: 'v9' }, context, keyring)).toThrow('Unknown channel key version')
    expect(() => encryptChannelConfig({ type: 'EMAIL', to: ['alerts@example.test'], extra: true } as never, context, keyring)).toThrow('Invalid channel configuration')
    expect(() => encryptChannelConfig({ type: 'PUSHOVER', appToken: 'token', userKey: 'user' }, context, keyring)).toThrow('Invalid channel configuration')
  })

  it.each(['blue', 'v0', 'v01', 'v-1', 'V1'])('rejects non-canonical key version %s', (version) => {
    expect(() => parseChannelKeyring(JSON.stringify({
      active: version,
      keys: { [version]: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
    }))).toThrow('Invalid channel encryption keyring')
  })

  it.each(['v2147483648', 'v999999999999999999999999999999999999999999999999'])('rejects out-of-range key version %s', (version) => {
    expect(() => parseChannelKeyring(JSON.stringify({
      active: version,
      keys: { [version]: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
    }))).toThrow('Invalid channel encryption keyring')
  })

  it('worker structural parsing accepts a public hostname without live DNS lookup', () => {
    expect(parseChannelConfig('WEBHOOK', {
      url: 'https://does-not-resolve.invalid/hook',
      signingSecret: 'secret',
    })).toEqual({ type: 'WEBHOOK', url: 'https://does-not-resolve.invalid/hook', signingSecret: 'secret' })
  })

  it.each([
    'http://public.example.test/hook',
    'https://user:password@public.example.test/hook',
    'https://public.example.test:8443/hook',
  ])('rejects structurally unsafe webhook URL %s before dispatch', (url) => {
    expect(() => parseChannelConfig('WEBHOOK', { url, signingSecret: 'secret' })).toThrow('Invalid channel configuration')
  })

  it.each([
    ['https://127.0.0.1/hook', async () => ['93.184.216.34']],
    ['https://hook.example.test/hook', async () => ['93.184.216.34', '10.0.0.1']],
    ['https://hook.example.test/hook', async () => { throw new Error('ENOTFOUND') }],
  ])('persistence validation fails closed for unsafe or unresolvable webhook target %s', async (url, lookup) => {
    await expect(validateChannelConfigForPersistence('WEBHOOK', { url, signingSecret: 'secret' }, {
      validateWebhookTarget: (target) => validateWebhookTarget(target, { lookup }),
    })).rejects.toThrow('Invalid channel configuration')
  })

  it('persistence validation pins a rebinding hostname while saving', async () => {
    let calls = 0
    await expect(validateChannelConfigForPersistence('WEBHOOK', {
      url: 'https://hook.example.test/hook', signingSecret: 'secret',
    }, {
      validateWebhookTarget: (target) => validateWebhookTarget(target, {
        lookup: async () => {
          calls += 1
          return calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']
        },
      }),
    })).resolves.toEqual({ type: 'WEBHOOK', url: 'https://hook.example.test/hook', signingSecret: 'secret' })
    expect(calls).toBe(1)
  })
})
