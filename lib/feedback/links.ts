const LOCALHOST_NAMES = new Set(['localhost', '0.0.0.0', '::1'])
const DEFAULT_SOURCE_APP_PUBLIC_URLS: Record<string, string> = {
  pitchme: 'https://pitchme-pearl.vercel.app',
}

function isLocalhostHostname(hostname: string): boolean {
  return LOCALHOST_NAMES.has(hostname) || hostname.startsWith('127.')
}

export function normalizeSourceTicketUrl(
  ticketUrl: string | null | undefined,
  appBaseUrl: string | null | undefined,
  appSlug?: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!ticketUrl) return null

  let parsedTicketUrl: URL
  try {
    parsedTicketUrl = new URL(ticketUrl)
  } catch {
    return ticketUrl
  }

  if (!isLocalhostHostname(parsedTicketUrl.hostname)) {
    return parsedTicketUrl.toString()
  }

  const publicBaseUrl = getSourceAppPublicUrl(appSlug, appBaseUrl, env)
  if (!publicBaseUrl) return null

  return new URL(
    `${parsedTicketUrl.pathname}${parsedTicketUrl.search}${parsedTicketUrl.hash}`,
    publicBaseUrl,
  ).toString()
}

export function getSourceAppPublicUrl(
  appSlug: string | null | undefined,
  appBaseUrl: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configuredUrl = getConfiguredSourceAppPublicUrl(appSlug, env)
  if (configuredUrl) return configuredUrl

  if (appBaseUrl) {
    const parsedBaseUrl = parsePublicUrl(appBaseUrl)
    if (parsedBaseUrl) return parsedBaseUrl
  }

  if (!appSlug) return null
  return DEFAULT_SOURCE_APP_PUBLIC_URLS[appSlug] ?? null
}

function getConfiguredSourceAppPublicUrl(
  appSlug: string | null | undefined,
  env: Record<string, string | undefined>,
): string | null {
  if (!appSlug) return null

  const rawMap = env.SUPPORT_TOWER_SOURCE_APP_URLS_JSON?.trim()
  if (!rawMap) return null

  const parsed = JSON.parse(rawMap) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SUPPORT_TOWER_SOURCE_APP_URLS_JSON must be a JSON object')
  }

  const configuredUrl = (parsed as Record<string, unknown>)[appSlug]
  if (typeof configuredUrl !== 'string') return null

  return parsePublicUrl(configuredUrl)
}

function parsePublicUrl(value: string): string | null {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return null
  }

  if (isLocalhostHostname(parsedUrl.hostname)) return null
  return parsedUrl.toString().replace(/\/+$/, '')
}
