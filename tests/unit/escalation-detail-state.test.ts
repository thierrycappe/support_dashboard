import { describe, expect, it } from 'vitest'
import { buildCurrentDeliveryState } from '@/lib/escalations/detail'

describe('current delivery projection', () => {
  it('deduplicates targets and keeps the latest routing incident when a query result repeats rows', () => {
    const state = buildCurrentDeliveryState([
      { eventGeneration: 4, target: 'Release alerts', status: 'RETRYING', routingIncident: 'Earlier incident', routingIncidentCreatedAt: new Date('2026-08-12T09:00:00.000Z') },
      { eventGeneration: 4, target: 'Release alerts', status: 'RETRYING', routingIncident: 'Latest incident', routingIncidentCreatedAt: new Date('2026-08-12T09:10:00.000Z') },
      { eventGeneration: 4, target: 'Central fallback', status: 'PENDING', routingIncident: 'Latest incident', routingIncidentCreatedAt: new Date('2026-08-12T09:10:00.000Z') },
    ])

    expect(state).toEqual({
      eventGeneration: 4,
      targets: [
        { target: 'Central fallback', status: 'PENDING' },
        { target: 'Release alerts', status: 'RETRYING' },
      ],
      routingIncident: 'Latest incident',
    })
  })
})
