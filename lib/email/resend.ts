const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

type Env = Record<string, string | undefined>

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

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
