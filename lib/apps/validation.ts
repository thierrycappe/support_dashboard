export type ApplicationBaseUrlIssue = 'INVALID_URL' | 'HTTPS_REQUIRED' | 'CREDENTIALS_FORBIDDEN'

export function applicationBaseUrlIssue(value: string): ApplicationBaseUrlIssue | null {
  let url: URL
  try { url = new URL(value) } catch { return 'INVALID_URL' }
  if (url.protocol !== 'https:') return 'HTTPS_REQUIRED'
  if (url.username || url.password) return 'CREDENTIALS_FORBIDDEN'
  return null
}

export function safeApplicationBaseUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    if (applicationBaseUrlIssue(value) !== null) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function requireSafeApplicationBaseUrl(value: string): string {
  const normalized = safeApplicationBaseUrl(value)
  if (!normalized) throw new Error('Invalid application URL')
  return normalized
}
