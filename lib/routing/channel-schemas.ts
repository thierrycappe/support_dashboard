import { z } from 'zod'
import type { ChannelConfig, DeliveryChannelType } from '@/lib/delivery/types'

const emailConfigSchema = z.object({
  to: z.array(z.string().email()).min(1),
}).strict()

const pushoverConfigSchema = z.object({
  appToken: z.string().min(1),
  userKey: z.string().min(1),
}).strict()

const webhookConfigSchema = z.object({
  url: z.string().url(),
  signingSecret: z.string().min(1),
}).strict().superRefine(({ url }, context) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    context.addIssue({ code: 'custom', message: 'Unsafe webhook configuration' })
  }
})

export function parseChannelConfig(type: DeliveryChannelType, value: unknown): ChannelConfig {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'type' in value && value.type !== type) {
    throw new Error('Invalid channel configuration')
  }
  const payload = payloadWithoutType(value)
  const config = type === 'EMAIL'
    ? emailConfigSchema.safeParse(payload)
    : type === 'PUSHOVER'
      ? pushoverConfigSchema.safeParse(payload)
      : webhookConfigSchema.safeParse(payload)
  if (!config.success) throw new Error('Invalid channel configuration')
  return { type, ...config.data } as ChannelConfig
}

export async function validateChannelConfig(type: DeliveryChannelType, value: unknown): Promise<ChannelConfig> {
  return parseChannelConfig(type, value)
}

export function serializeChannelConfig(config: ChannelConfig): string {
  return JSON.stringify(payloadWithoutType(config))
}

function payloadWithoutType(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('type' in value)) return value
  const payload = { ...(value as Record<string, unknown>) }
  delete payload.type
  return payload
}
