import type { DashboardData } from '@/lib/feedback/dashboard'
import {
  getPushoverConfig,
  getTowerPublicUrl,
  sendPushoverMessage,
  type NotificationResult,
  type PushoverMessage,
} from '@/lib/notifications/pushover'

const MAX_MESSAGE_LENGTH = 1024
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

export function buildDailyReportPushoverMessage(
  data: DashboardData,
  env: Env = process.env,
): PushoverMessage {
  const towerUrl = getTowerPublicUrl(env)
  const title = `Support Tower daily report: ${data.totals.open} open`

  if (data.totals.open === 0) {
    return {
      title,
      message: 'No open support tickets are currently mirrored in the tower.',
      priority: -1,
      url: towerUrl ?? undefined,
      url_title: towerUrl ? 'Open Support Tower' : undefined,
    }
  }

  const lines = [
    `${pluralize(data.totals.open, 'open ticket')}: ${data.totals.bugs} bugs, ${data.totals.evolutions} evolutions, ${data.totals.urgent} urgent.`,
    '',
    'By app:',
    ...buildAppLines(data),
    '',
    'Top queue:',
    ...buildTicketLines(data),
  ]

  return {
    title,
    message: truncate(lines.join('\n'), MAX_MESSAGE_LENGTH),
    priority: data.totals.urgent > 0 ? 1 : 0,
    url: towerUrl ?? undefined,
    url_title: towerUrl ? 'Open Support Tower' : undefined,
  }
}

export async function sendDailyOpenTicketReport({
  data,
  env = process.env,
  fetchImpl = fetch,
  logger = console,
}: SendDailyReportOptions): Promise<NotificationResult> {
  const config = getPushoverConfig(env)
  if (!config) return 'disabled'

  const message = buildDailyReportPushoverMessage(data, env)

  try {
    const response = await sendPushoverMessage({ config, message, fetchImpl })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Support tower daily Pushover report failed', {
        status: response.status,
        body,
        openTickets: data.totals.open,
      })
      return 'failed'
    }

    return 'sent'
  } catch (error) {
    logger.warn('Support tower daily Pushover report failed', {
      error,
      openTickets: data.totals.open,
    })
    return 'failed'
  }
}
