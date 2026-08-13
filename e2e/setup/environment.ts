import { isIP } from 'node:net'

type Environment = Record<string, string | undefined>

const CHILD_ENVIRONMENT_ALLOWLIST = [
  'CI',
  'FORCE_COLOR',
  'LANG',
  'LC_ALL',
  'NEXT_TELEMETRY_DISABLED',
  'PATH',
  'TERM',
  'TMPDIR',
] as const

export function resolveSupportE2eBaseUrl(env: Environment = process.env): string {
  const raw = env.PLAYWRIGHT_BASE_URL?.trim() || `http://127.0.0.1:${env.PORT?.trim() || '3000'}`
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Refusing support E2E target') }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const loopback = hostname === 'localhost' || hostname === '::1'
    || (isIP(hostname) === 4 && hostname.startsWith('127.'))
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !loopback
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Refusing support E2E target')
  }
  return url.origin
}

export function resolveSupportE2ePort(env: Environment = process.env): string {
  const url = new URL(resolveSupportE2eBaseUrl(env))
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

export function buildSupportE2eEnvironment(
  source: Environment,
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { NODE_ENV: 'development' }
  for (const key of CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = source[key]
    if (value !== undefined) child[key] = value
  }
  return { ...child, ...overrides }
}
