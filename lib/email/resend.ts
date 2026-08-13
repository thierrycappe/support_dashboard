const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

type Env = Record<string, string | undefined>

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type ResendFailureClass = 'PROVIDER_REJECTED' | 'TRANSPORT_FAILURE'

interface ResendFailureLog {
  failureClass: ResendFailureClass
  status: number | null
  requestId: string | null
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface ResendConfig {
  apiKey: string
  from: string
}

export interface ResendEmail {
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}

function getSafeRequestId(response: Response): string | null {
  const requestId = response.headers.get('x-request-id')
  return requestId && SAFE_REQUEST_ID.test(requestId) ? requestId : null
}

export async function logResendFailure({
  logger,
  message,
  response,
}: {
  logger: Pick<Console, 'warn'>
  message: string
  response?: Response
}): Promise<void> {
  if (response?.body) {
    await response.body.cancel().catch(() => undefined)
  }

  const details: ResendFailureLog = response
    ? {
        failureClass: 'PROVIDER_REJECTED',
        status: response.status,
        requestId: getSafeRequestId(response),
      }
    : {
        failureClass: 'TRANSPORT_FAILURE',
        status: null,
        requestId: null,
      }

  logger.warn(message, details)
}

export function getResendConfig(env: Env = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.RESEND_FROM?.trim()

  if (!apiKey || !from) return null
  return { apiKey, from }
}

export async function sendResendEmail({
  config,
  email,
  fetchImpl = fetch,
}: {
  config: ResendConfig
  email: ResendEmail
  fetchImpl?: FetchLike
}): Promise<Response> {
  return fetchImpl(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(email),
  })
}
