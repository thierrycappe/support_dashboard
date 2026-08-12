import type { DeliveryEvent, DeliveryEventInput } from '@/lib/delivery/types'

export function renderDeliveryEvent(input: DeliveryEventInput): DeliveryEvent {
  const event: DeliveryEvent = {
    ticketId: input.ticketId,
    appName: input.appName,
    kind: input.kind,
    priority: input.priority,
    title: input.title,
    portalUrl: input.portalUrl,
  }

  if (input.includeReporterContext) {
    event.reporterContext = {
      name: input.reporter.name,
      email: input.reporter.email,
    }
  }

  return event
}
