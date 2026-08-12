import { describe, expect, it, vi } from 'vitest'
import { feedbackIngestSchema } from '@/lib/feedback/ingest'
import {
  canonicalEscalationDigest,
  escalationV1Schema,
  legacyPayloadToCommand,
  MAX_ESCALATION_V1_BODY_BYTES,
} from '@/lib/escalations/contract'

const validV1 = {
  schemaVersion: 1,
  externalId: 'FEEDBACK-1842',
  classification: 'FEATURE_REQUEST',
  status: 'NEW',
  priority: 'HIGH',
  title: 'Add regional filters',
  description: 'Teams need to filter the dashboard by region.',
  sourceUrl: 'https://source.example.com/admin/feedback/FEEDBACK-1842',
  triage: {
    ownerRef: 'business-owner-42',
    ownerName: 'Camille Renard',
    escalatedAt: '2026-08-12T10:15:00.000Z',
  },
  reporter: {
    name: 'Elodie Martin',
    email: 'elodie@example.test',
    sourceId: 'reporter-98',
  },
  browserInfo: 'Safari 20 on macOS',
  markdownSpec: null,
  transcript: [{ role: 'user', content: 'I need a region filter.' }],
  remoteCreatedAt: '2026-08-12T09:50:00.000Z',
  remoteUpdatedAt: '2026-08-12T10:15:00.000Z',
  metadata: { source: { category: 'analytics' }, labels: ['dashboard'] },
} as const

const validCommand = {
  externalId: 'FEEDBACK-1842',
  kind: 'EVOLUTION' as const,
  status: 'NEW' as const,
  priority: 'HIGH' as const,
  title: 'Add regional filters',
  description: 'Teams need to filter the dashboard by region.',
  sourceUrl: 'https://source.example.com/admin/feedback/FEEDBACK-1842',
  triage: {
    ownerRef: 'business-owner-42',
    ownerName: 'Camille Renard',
    escalatedAt: '2026-08-12T10:15:00.000Z',
  },
  reporter: {
    name: 'Elodie Martin',
    email: 'elodie@example.test',
    sourceId: 'reporter-98',
  },
  browserInfo: 'Safari 20 on macOS',
  markdownSpec: null,
  transcript: [{ role: 'user', content: 'I need a region filter.' }],
  remoteCreatedAt: '2026-08-12T09:50:00.000Z',
  remoteUpdatedAt: '2026-08-12T10:15:00.000Z',
  metadata: { source: { category: 'analytics' }, labels: ['dashboard'] },
}

describe('version 1 escalation contract', () => {
  it('maps FEATURE_REQUEST to the stored EVOLUTION kind', () => {
    const command = escalationV1Schema.parse(validV1)

    expect(command.kind).toBe('EVOLUTION')
  })

  it('does not accept application identity in a version 1 payload', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      app: { slug: 'other' },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown root field', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      deliveryHint: 'central',
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects a legacy status alias', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      status: 'fixed',
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects a legacy priority alias', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      priority: 'critical',
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown triage field', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      triage: { ...validV1.triage, sourceApp: 'other' },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown reporter field', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      reporter: { ...validV1.reporter, accountId: 'other' },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown transcript-message field', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      transcript: [
        { ...validV1.transcript[0], authorId: 'payload-controlled' },
      ],
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects a payload larger than the decoded 256 KB route limit', () => {
    const parsed = escalationV1Schema.safeParse({
      ...validV1,
      description: 'x'.repeat(MAX_ESCALATION_V1_BODY_BYTES),
    })

    expect(parsed.success).toBe(false)
  })

  it('produces the same digest for objects with different key order', () => {
    const reorderedCommand = {
      metadata: { labels: ['dashboard'], source: { category: 'analytics' } },
      remoteUpdatedAt: validCommand.remoteUpdatedAt,
      remoteCreatedAt: validCommand.remoteCreatedAt,
      transcript: validCommand.transcript,
      markdownSpec: validCommand.markdownSpec,
      browserInfo: validCommand.browserInfo,
      reporter: {
        sourceId: validCommand.reporter.sourceId,
        email: validCommand.reporter.email,
        name: validCommand.reporter.name,
      },
      triage: {
        escalatedAt: validCommand.triage.escalatedAt,
        ownerName: validCommand.triage.ownerName,
        ownerRef: validCommand.triage.ownerRef,
      },
      sourceUrl: validCommand.sourceUrl,
      description: validCommand.description,
      title: validCommand.title,
      priority: validCommand.priority,
      status: validCommand.status,
      kind: validCommand.kind,
      externalId: validCommand.externalId,
    }

    expect(canonicalEscalationDigest(validCommand)).toBe(
      canonicalEscalationDigest(reorderedCommand),
    )
  })
})

describe('legacy escalation adapter', () => {
  it('preserves legacy aliases while mapping the payload to the shared command', () => {
    const { authoritativeAppId, command } = legacyPayloadToCommand(
      feedbackIngestSchema.parse({
        app: {
          slug: 'sales-portal',
          name: 'Sales Portal',
          baseUrl: 'https://sales.example.com',
          metadata: { region: 'eu' },
        },
        ticket: {
          externalId: 'fb_123',
          kind: 'EVOLUTION',
          status: 'corrigé',
          priority: 'critical',
          title: 'Regional filters',
          description: 'Needed by regional teams.',
          reporterName: 'Ariane',
          reporterEmail: 'ariane@example.test',
          reporterId: 'reporter-7',
          url: 'https://sales.example.com/feedback/fb_123',
          remoteUpdatedAt: '2026-08-12T12:00:00.000Z',
        },
      }),
      'app_authoritative',
    )

    expect(authoritativeAppId).toBe('app_authoritative')
    expect(command).toMatchObject({
      externalId: 'fb_123',
      kind: 'EVOLUTION',
      status: 'FIXED',
      priority: 'URGENT',
      triage: {
        ownerRef: 'legacy-source',
        ownerName: null,
        escalatedAt: '2026-08-12T12:00:00.000Z',
      },
      metadata: { region: 'eu' },
    })
  })

  it('keeps supplied authority separate from payload-controlled app identity', () => {
    const first = legacyPayloadToCommand(
      feedbackIngestSchema.parse({
        app: {
          slug: 'payload-app-one',
          name: 'Payload App One',
          metadata: { claimedApp: 'one' },
        },
        ticket: {
          externalId: 'fb_125',
          title: 'First payload identity',
          description: 'Payload app fields are descriptive only.',
        },
      }),
      'registered-app-id',
    )
    const second = legacyPayloadToCommand(
      feedbackIngestSchema.parse({
        app: {
          slug: 'payload-app-two',
          name: 'Payload App Two',
          metadata: { claimedApp: 'two' },
        },
        ticket: {
          externalId: 'fb_125',
          title: 'Second payload identity',
          description: 'Payload app fields still cannot replace authority.',
        },
      }),
      'registered-app-id',
    )

    expect(first.authoritativeAppId).toBe('registered-app-id')
    expect(second.authoritativeAppId).toBe('registered-app-id')
    expect(first.command).not.toHaveProperty('authoritativeAppId')
    expect(second.command).not.toHaveProperty('authoritativeAppId')
    expect(first.command.metadata).toEqual({ claimedApp: 'one' })
    expect(second.command.metadata).toEqual({ claimedApp: 'two' })
  })

  it('uses receipt time when a legacy ticket has no remote update time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T13:00:00.000Z'))

    const { command } = legacyPayloadToCommand(
      feedbackIngestSchema.parse({
        app: { slug: 'sales-portal', name: 'Sales Portal' },
        ticket: {
          externalId: 'fb_124',
          title: 'Missing timestamps',
          description: 'The source did not provide an update timestamp.',
        },
      }),
      'app_authoritative',
    )

    expect(command.triage.escalatedAt).toBe('2026-08-12T13:00:00.000Z')
    vi.useRealTimers()
  })
})
