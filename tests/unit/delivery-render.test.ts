import { describe, expect, it } from 'vitest'
import { renderDeliveryEvent } from '@/lib/delivery/render'

const renderFixture = {
  ticketId: 'ticket-1',
  appName: 'Atelier Planning',
  kind: 'BUG' as const,
  priority: 'HIGH' as const,
  title: 'Cannot publish a schedule',
  description: 'private diagnostic description',
  portalUrl: 'https://support.example.test/feedback/ticket-1',
  reporter: { name: 'Élodie Martin', email: 'reporter@example.test' },
  includeReporterContext: false,
}

describe('renderDeliveryEvent', () => {
  it('excludes reporter and description from default alert content', () => {
    const event = renderDeliveryEvent(renderFixture)

    expect(JSON.stringify(event)).not.toContain('reporter@example.test')
    expect(JSON.stringify(event)).not.toContain('private diagnostic description')
    expect(event).toMatchObject({
      appName: 'Atelier Planning',
      priority: 'HIGH',
      title: 'Cannot publish a schedule',
    })
  })

  it('includes only the opted-in reporter context', () => {
    expect(renderDeliveryEvent({ ...renderFixture, includeReporterContext: true })).toEqual({
      ticketId: 'ticket-1',
      appName: 'Atelier Planning',
      kind: 'BUG',
      priority: 'HIGH',
      title: 'Cannot publish a schedule',
      portalUrl: 'https://support.example.test/feedback/ticket-1',
      reporterContext: { name: 'Élodie Martin', email: 'reporter@example.test' },
    })
  })
})
