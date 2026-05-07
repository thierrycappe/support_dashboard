const LOCALHOST_NAMES = new Set(['localhost', '0.0.0.0', '::1'])

function isLocalhostHostname(hostname: string): boolean {
  return LOCALHOST_NAMES.has(hostname) || hostname.startsWith('127.')
}

export function normalizeSourceTicketUrl(
  ticketUrl: string | null | undefined,
  appBaseUrl: string | null | undefined,
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

  if (!appBaseUrl) return null

  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(appBaseUrl)
  } catch {
    return null
  }

  if (isLocalhostHostname(parsedBaseUrl.hostname)) return null

  return new URL(
    `${parsedTicketUrl.pathname}${parsedTicketUrl.search}${parsedTicketUrl.hash}`,
    parsedBaseUrl,
  ).toString()
}
