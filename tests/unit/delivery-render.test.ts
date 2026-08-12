import { describe, expect, it } from 'vitest'
import { renderDeliveryEvent } from '@/lib/delivery/render'

const renderFixture = {
  ticketId: 'ticket-1',
  appName: 'Atelier Planning',
  kind: 'BUG' as const,
  priority: 'HIGH' as const,
  title: 'Cannot publish a schedule',
  description: 'private diagnostic description',
  reporter: { name: 'Élodie Martin', email: 'reporter@example.test' },
  includeReporterContext: false,
}

const trustedPortalContext = {
  portalOrigin: 'https://support.example.test',
}

describe('renderDeliveryEvent', () => {
  it('excludes reporter and description from default alert content', () => {
    const event = renderDeliveryEvent(renderFixture, trustedPortalContext)

    expect(JSON.stringify(event)).not.toContain('reporter@example.test')
    expect(JSON.stringify(event)).not.toContain('private diagnostic description')
    expect(event).toMatchObject({
      appName: 'Atelier Planning',
      priority: 'HIGH',
      title: 'Cannot publish a schedule',
    })
  })

  it('includes only the opted-in reporter context', () => {
    expect(renderDeliveryEvent({ ...renderFixture, includeReporterContext: true }, trustedPortalContext)).toEqual({
      ticketId: 'ticket-1',
      appName: 'Atelier Planning',
      kind: 'BUG',
      priority: 'HIGH',
      title: 'Cannot publish a schedule',
      portalUrl: 'https://support.example.test/feedback/ticket-1',
      reporterContext: { name: 'Élodie Martin', email: 'reporter@example.test' },
    })
  })

  it('builds an encoded feedback path below the trusted portal origin', () => {
    expect(renderDeliveryEvent({
      ...renderFixture,
      ticketId: 'ticket/../?next=https://attacker.example.test',
    }, trustedPortalContext).portalUrl).toBe(
      'https://support.example.test/feedback/ticket%2F..%2F%3Fnext%3Dhttps%3A%2F%2Fattacker.example.test',
    )
  })

  it('ignores an attacker-controlled external portal URL on the event input', () => {
    const attackerControlledInput = {
      ...renderFixture,
      portalUrl: 'https://attacker.example.test/feedback/ticket-1',
    }

    expect(renderDeliveryEvent(attackerControlledInput, trustedPortalContext).portalUrl).toBe(
      'https://support.example.test/feedback/ticket-1',
    )
  })
})
