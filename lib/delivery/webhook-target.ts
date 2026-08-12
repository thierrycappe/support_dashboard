import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'

export interface ValidatedWebhookTarget {
  url: URL
  addresses: string[]
  dispatcher: Agent
}

type Lookup = (hostname: string) => Promise<string[]>

export async function validateWebhookTarget(
  value: string,
  { lookup = resolveAllAddresses }: { lookup?: Lookup } = {},
): Promise<ValidatedWebhookTarget> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Unsafe webhook target')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Unsafe webhook target')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [hostname] : await lookup(hostname)
  if (addresses.length === 0 || addresses.some(isUnsafeAddress)) {
    throw new Error('Unsafe webhook target')
  }

  let cursor = 0
  const dispatcher = new Agent({
    connect: {
      // Connect to a vetted address but retain the original DNS name for SNI
      // and Node's normal certificate hostname verification.
      servername: hostname,
      lookup: (_hostname, _options, callback) => {
        const address = addresses[cursor++ % addresses.length]!
        callback(null, address, isIP(address) === 6 ? 6 : 4)
      },
    },
  })
  return { url, addresses, dispatcher }
}

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  return (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address }) => address)
}

function isUnsafeAddress(address: string): boolean {
  if (isIP(address) === 4) return isUnsafeIpv4(address)
  if (isIP(address) === 6) return isUnsafeIpv6(address)
  return true
}

function isUnsafeIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 240
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return true
  const parts = expandIpv6(normalized)
  if (!parts) return true
  const [first, second] = parts
  const isZero = parts.every((part) => part === 0)
  const isLoopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1
  return isZero
    || isLoopback
    || (first & 0xff00) === 0xff00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfec0
    || (first === 0x2001 && (second === 0x0db8 || second === 0x0002 || second === 0x0010))
    || first === 0x0100
    || first === 0x2002
    || (first === 0x0064 && second === 0xff9b)
}

function expandIpv6(address: string): number[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  const pieces = [...left, ...Array(missing).fill('0'), ...right]
  if (pieces.length !== 8 || pieces.some((piece) => !/^[0-9a-f]{1,4}$/i.test(piece))) return null
  return pieces.map((piece) => Number.parseInt(piece, 16))
}
