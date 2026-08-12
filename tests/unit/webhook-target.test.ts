import { describe, expect, it } from 'vitest'
import { validateWebhookTarget } from '@/lib/delivery/webhook-target'

describe('validateWebhookTarget', () => {
  it.each([
    'http://public.example.test/hook',
    'https://user:password@public.example.test/hook',
    'https://127.0.0.1/hook',
    'https://2130706433/hook',
    'https://0x7f000001/hook',
    'https://0177.0.0.1/hook',
    'https://%31%32%37.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://192.0.2.1/hook',
    'https://100.64.0.1/hook',
    'https://[::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[fc00::1]/hook',
    'https://[2001:db8::1]/hook',
  ])('rejects direct or encoded unsafe webhook target %s', async (url) => {
    await expect(validateWebhookTarget(url)).rejects.toThrow('Unsafe webhook target')
  })

  it('rejects a hostname with mixed public and private DNS answers', async () => {
    await expect(validateWebhookTarget('https://hook.example.test', {
      lookup: async () => ['93.184.216.34', '10.0.0.1'],
    })).rejects.toThrow('Unsafe webhook target')
  })

  it('rejects hostname answers in private, link-local, documentation, multicast, and reserved ranges', async () => {
    for (const address of ['10.0.0.1', '169.254.1.1', '198.51.100.1', '224.0.0.1', '::1', 'fe80::1', 'ff02::1']) {
      await expect(validateWebhookTarget('https://hook.example.test', {
        lookup: async () => [address],
      })).rejects.toThrow('Unsafe webhook target')
    }
  })

  it('pins the validated DNS answers and does not re-resolve a rebinding hostname', async () => {
    let calls = 0
    const target = await validateWebhookTarget('https://hook.example.test/path', {
      lookup: async () => {
        calls += 1
        return calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']
      },
    })
    expect(target.addresses).toEqual(['93.184.216.34'])
    expect(target.url.hostname).toBe('hook.example.test')
    expect(calls).toBe(1)
    await target.dispatcher.close()
  })
})
