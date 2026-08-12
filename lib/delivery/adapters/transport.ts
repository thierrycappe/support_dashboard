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
  readBody: (response: Response) => Promise<string>,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<{ response: Response; body: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await abortWhenTimedOut(fetchImpl(input, { ...init, signal: controller.signal }), controller.signal)
    const body = await abortWhenTimedOut(readBody(response), controller.signal)
    return { response, body }
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError()
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function abortWhenTimedOut<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new ProviderTimeoutError()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProviderTimeoutError())
    signal.addEventListener('abort', onAbort, { once: true })
    void value.then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function sanitizedTransportError(error: unknown): string {
  if (error instanceof ProviderTimeoutError) return 'PROVIDER_TIMEOUT'
  return error instanceof Error && error.name ? error.name : 'NETWORK_ERROR'
}
