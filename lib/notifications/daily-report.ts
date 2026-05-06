import type { DashboardData } from '@/lib/feedback/dashboard'
import { getAllowedAdminEmails } from '@/lib/auth/admin'
import {
  getResendConfig,
  sendResendEmail,
  type ResendEmail,
} from '@/lib/email/resend'
import { getTowerPublicUrl } from '@/lib/notifications/pushover'

const MAX_TEXT_LENGTH = 8000
const MAX_LISTED_APPS = 6
const MAX_LISTED_TICKETS = 6

type Env = Record<string, string | undefined>

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

interface SendDailyReportOptions {
  data: DashboardData
  env?: Env
  fetchImpl?: FetchLike
  logger?: Pick<Console, 'warn'>
}

export interface ResendEmailConfig {
  apiKey: string
  from: string
  to: string[]
}

export type DailyReportEmail = ResendEmail

export type EmailDeliveryResult = 'disabled' | 'sent' | 'failed'

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function buildAppLines(data: DashboardData): string[] {
  const appLines = data.apps
    .filter((app) => app.openCount > 0)
    .slice(0, MAX_LISTED_APPS)
    .map((app) => `- ${app.name}: ${app.openCount}`)

  const remainingApps = data.apps.filter((app) => app.openCount > 0).length - appLines.length
  if (remainingApps > 0) appLines.push(`- +${pluralize(remainingApps, 'other app')}`)

  return appLines
}

function buildTicketLines(data: DashboardData): string[] {
  const importantTickets = [...data.tickets]
    .sort((first, second) => {
      const priorityOrder: Record<string, number> = {
        URGENT: 4,
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
      }
      return (
        (priorityOrder[second.priority] ?? 0) -
        (priorityOrder[first.priority] ?? 0)
      )
    })
    .slice(0, MAX_LISTED_TICKETS)
    .map(
      (ticket) =>
        `- ${ticket.priority} ${ticket.appName}: ${ticket.title} (${ticket.status})`,
    )

  const remainingTickets = data.tickets.length - importantTickets.length
  if (remainingTickets > 0) {
    importantTickets.push(`- +${pluralize(remainingTickets, 'other open ticket')}`)
  }

  return importantTickets
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function paragraph(value: string): string {
  return `<p>${escapeHtml(value)}</p>`
}

function list(items: string[]): string {
  if (items.length === 0) return '<p>None.</p>'
  return `<ul>${items.map((item) => `<li>${escapeHtml(item.replace(/^- /, ''))}</li>`).join('')}</ul>`
}

export function getDailyReportEmailConfig(
  env: Env = process.env,
): ResendEmailConfig | null {
  const resend = getResendConfig(env)
  const to = (
    env.SUPPORT_TOWER_DIGEST_EMAIL_TO?.trim()
      ? env.SUPPORT_TOWER_DIGEST_EMAIL_TO
      : getAllowedAdminEmails(env).join(',')
  )
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)

  if (!resend || to.length === 0) return null
  return { ...resend, to }
}

export function buildDailyReportEmail(
  data: DashboardData,
  config: Pick<ResendEmailConfig, 'from' | 'to'>,
  env: Env = process.env,
): DailyReportEmail {
  const towerUrl = getTowerPublicUrl(env)
  const subject = `Support Tower daily report: ${data.totals.open} open`

  if (data.totals.open === 0) {
    const text = [
      'No open support tickets are currently mirrored in the tower.',
      towerUrl ? `Open Support Tower: ${towerUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      from: config.from,
      to: config.to,
      subject,
      text,
      html: [
        '<h1>Support Tower daily report</h1>',
        paragraph('No open support tickets are currently mirrored in the tower.'),
        towerUrl ? `<p><a href="${escapeHtml(towerUrl)}">Open Support Tower</a></p>` : '',
      ].join(''),
    }
  }

  const appLines = buildAppLines(data)
  const ticketLines = buildTicketLines(data)
  const lines = [
    `${pluralize(data.totals.open, 'open ticket')}: ${data.totals.bugs} bugs, ${data.totals.evolutions} evolutions, ${data.totals.urgent} urgent.`,
    '',
    'By app:',
    ...appLines,
    '',
    'Top queue:',
    ...ticketLines,
    '',
    towerUrl ? `Open Support Tower: ${towerUrl}` : null,
  ].filter(Boolean)

  const html = [
    '<h1>Support Tower daily report</h1>',
    paragraph(
      `${pluralize(data.totals.open, 'open ticket')}: ${data.totals.bugs} bugs, ${data.totals.evolutions} evolutions, ${data.totals.urgent} urgent.`,
    ),
    '<h2>By app</h2>',
    list(appLines),
    '<h2>Top queue</h2>',
    list(ticketLines),
    towerUrl ? `<p><a href="${escapeHtml(towerUrl)}">Open Support Tower</a></p>` : '',
  ]

  return {
    from: config.from,
    to: config.to,
    subject,
    text: truncate(lines.join('\n'), MAX_TEXT_LENGTH),
    html: html.join(''),
  }
}

export async function sendDailyOpenTicketReport({
  data,
  env = process.env,
  fetchImpl = fetch,
  logger = console,
}: SendDailyReportOptions): Promise<EmailDeliveryResult> {
  const config = getDailyReportEmailConfig(env)
  if (!config) return 'disabled'

  const email = buildDailyReportEmail(data, config, env)

  try {
    const response = await sendResendEmail({ config, email, fetchImpl })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Support tower daily email report failed', {
        status: response.status,
        body,
        openTickets: data.totals.open,
      })
      return 'failed'
    }

    return 'sent'
  } catch (error) {
    logger.warn('Support tower daily email report failed', {
      error,
      openTickets: data.totals.open,
    })
    return 'failed'
  }
}
