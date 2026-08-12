import type {
  DeliveryEvent,
  DeliveryEventInput,
  DeliveryRenderContext,
} from '@/lib/delivery/types'

export function renderDeliveryEvent(
  input: DeliveryEventInput,
  context: DeliveryRenderContext,
): DeliveryEvent {
  const event: DeliveryEvent = {
    ticketId: input.ticketId,
    appName: input.appName,
    kind: input.kind,
    priority: input.priority,
    title: input.title,
    portalUrl: new URL(
      `/feedback/${encodeURIComponent(input.ticketId)}`,
      context.portalOrigin,
    ).toString(),
  }

  if (input.includeReporterContext) {
    event.reporterContext = {
      name: input.reporter.name,
      email: input.reporter.email,
    }
  }

  return event
}
