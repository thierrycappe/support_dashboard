import type { FeedbackPriority } from '@/lib/feedback/status'

export type DeliveryChannelType = 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'

export type ChannelConfig =
  | { type: 'EMAIL'; to: string[] }
  | { type: 'PUSHOVER'; appToken: string; userKey: string }
  | { type: 'WEBHOOK'; url: string; signingSecret: string }

export interface DeliveryTarget {
  targetKey: string
  channelId: string | null
  channelType: DeliveryChannelType
  configSource: 'DATABASE' | 'LEGACY_ENV'
  includeReporterContext: boolean
}

export interface RoutableChannel extends DeliveryTarget {
  status: 'ACTIVE' | 'DISABLED' | 'UNHEALTHY'
  minimumPriority: FeedbackPriority
}

export interface RoutingInput {
  priority: FeedbackPriority
  appChannels: RoutableChannel[]
  centralChannels: RoutableChannel[]
}

export interface RoutingDecision {
  targets: DeliveryTarget[]
  incident: null | { code: 'NO_VALID_DELIVERY_TARGET' }
}

export interface DeliveryEvent {
  ticketId: string
  appName: string
  kind: 'BUG' | 'EVOLUTION'
  priority: FeedbackPriority
  title: string
  portalUrl: string
  reporterContext?: { name: string | null; email: string | null }
}

export interface DeliveryEventInput {
  ticketId: string
  appName: string
  kind: 'BUG' | 'EVOLUTION'
  priority: FeedbackPriority
  title: string
  description: string
  portalUrl: string
  reporter: { name: string | null; email: string | null }
  includeReporterContext: boolean
}
