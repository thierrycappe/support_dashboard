import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { parseChannelConfig, serializeChannelConfig } from '@/lib/routing/channel-schemas'
import type { ChannelConfig, DeliveryChannelType } from '@/lib/delivery/types'

export interface EncryptedConfig {
  keyVersion: string
  nonce: string
  ciphertext: string
  authTag: string
}

export interface ChannelKeyring {
  activeVersion: string
  keys: Record<string, Buffer>
}

export interface ChannelCryptoContext {
  channelId: string
  type: DeliveryChannelType
}

const keyVersionSchema = z.string()
  .regex(/^v[1-9]\d*$/)
  .refine((version) => /^v[1-9]\d*$/.test(version) && BigInt(version.slice(1)) <= 2_147_483_647n)

const keyringSchema = z.object({
  active: keyVersionSchema,
  keys: z.record(keyVersionSchema, z.string().min(1)),
}).strict()

export function parseChannelKeyring(value: string): ChannelKeyring {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    throw new Error('Invalid channel encryption keyring')
  }
  const parsed = keyringSchema.safeParse(raw)
  if (!parsed.success || !parsed.data.keys[parsed.data.active]) throw new Error('Invalid channel encryption keyring')
  const keys: Record<string, Buffer> = {}
  for (const [version, encoded] of Object.entries(parsed.data.keys)) {
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Invalid channel encryption keyring')
    keys[version] = key
  }
  return { activeVersion: parsed.data.active, keys }
}

export function loadChannelKeyring(env: Record<string, string | undefined> = process.env): ChannelKeyring | null {
  const encoded = env.SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON?.trim()
  return encoded ? parseChannelKeyring(encoded) : null
}

export function encryptChannelConfig(
  config: ChannelConfig,
  context: ChannelCryptoContext,
  keyring: ChannelKeyring,
  nonce: Buffer = randomBytes(12),
): EncryptedConfig {
  if (config.type !== context.type || nonce.length !== 12) throw new Error('Invalid channel configuration')
  const key = keyring.keys[keyring.activeVersion]
  if (!key) throw new Error('Invalid channel encryption keyring')
  const payload = parseChannelConfig(context.type, configWithoutType(config))
  const plaintext = Buffer.from(serializeChannelConfig(payload), 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(context, keyring.activeVersion))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    keyVersion: keyring.activeVersion,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptChannelConfig(record: EncryptedConfig, context: ChannelCryptoContext, keyring: ChannelKeyring): ChannelConfig {
  const key = keyring.keys[record.keyVersion]
  if (!key) throw new Error('Unknown channel key version')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'))
    decipher.setAAD(aad(context, record.keyVersion))
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()])
    return parseChannelConfig(context.type, JSON.parse(plaintext.toString('utf8')))
  } catch {
    throw new Error('Invalid encrypted channel configuration')
  }
}

function configWithoutType(config: ChannelConfig): Record<string, unknown> {
  const payload = { ...config } as Record<string, unknown>
  delete payload.type
  return payload
}

function aad(context: ChannelCryptoContext, keyVersion: string): Buffer {
  return Buffer.from(`support-tower-channel:${context.channelId}:${context.type}:${keyVersion}`, 'utf8')
}
