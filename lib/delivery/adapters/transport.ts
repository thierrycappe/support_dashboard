export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000

class ProviderTimeoutError extends Error {
  constructor() {
    super('Provider request timed out')
    this.name = 'ProviderTimeoutError'
  }
}

export async function fetchWithProviderTimeout(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError()
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function sanitizedTransportError(error: unknown): string {
  if (error instanceof ProviderTimeoutError) return 'PROVIDER_TIMEOUT'
  return error instanceof Error && error.name ? error.name : 'NETWORK_ERROR'
}
