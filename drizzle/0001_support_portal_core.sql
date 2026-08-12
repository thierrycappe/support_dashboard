-- Additive support portal core. This migration intentionally never drops, renames,
-- or rewrites legacy rows.
DO $$ BEGIN
  CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "CredentialMode" AS ENUM ('LEGACY_BEARER', 'PUBLIC_KEY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "CredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ChannelType" AS ENUM ('EMAIL', 'PUSHOVER', 'WEBHOOK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'DISABLED', 'UNHEALTHY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'LEASED', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS support_groups (
  id text PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE',
  is_central_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS support_groups_name_idx ON support_groups (name);
CREATE UNIQUE INDEX IF NOT EXISTS support_groups_one_central_fallback_idx ON support_groups (is_central_fallback) WHERE is_central_fallback;

ALTER TABLE source_apps ADD COLUMN IF NOT EXISTS enrollment_status "EnrollmentStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE source_apps ADD COLUMN IF NOT EXISTS credential_mode "CredentialMode" NOT NULL DEFAULT 'LEGACY_BEARER';
ALTER TABLE source_apps ADD COLUMN IF NOT EXISTS technical_group_id text;
ALTER TABLE source_apps ADD COLUMN IF NOT EXISTS last_authenticated_at timestamptz(3);
ALTER TABLE source_apps ADD COLUMN IF NOT EXISTS last_ingested_at timestamptz(3);
DO $$ BEGIN
  ALTER TABLE source_apps ADD CONSTRAINT source_apps_technical_group_id_support_groups_id_fk
    FOREIGN KEY (technical_group_id) REFERENCES support_groups(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS source_apps_group_idx ON source_apps (technical_group_id);
CREATE INDEX IF NOT EXISTS source_apps_last_ingested_idx ON source_apps (id, last_ingested_at);

ALTER TABLE feedback_tickets ADD COLUMN IF NOT EXISTS triage jsonb;
CREATE INDEX IF NOT EXISTS feedback_tickets_open_queue_idx ON feedback_tickets (status, priority, updated_at, id);

CREATE TABLE IF NOT EXISTS app_enrollment_grants (
  id text PRIMARY KEY, source_app_id text NOT NULL REFERENCES source_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_digest text NOT NULL, token_prefix text NOT NULL, expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3), revoked_at timestamptz(3),
  created_by_user_id text REFERENCES support_users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_enrollment_grants_token_digest_idx ON app_enrollment_grants (token_digest);
CREATE INDEX IF NOT EXISTS app_enrollment_grants_app_idx ON app_enrollment_grants (source_app_id);

CREATE TABLE IF NOT EXISTS app_credentials (
  id text PRIMARY KEY, source_app_id text NOT NULL REFERENCES source_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
  public_jwk jsonb NOT NULL, public_key_thumbprint text NOT NULL, status "CredentialStatus" NOT NULL DEFAULT 'PENDING',
  valid_from timestamptz(3) NOT NULL, valid_until timestamptz(3), revoked_at timestamptz(3),
  revoked_by_user_id text REFERENCES support_users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  rotation_parent_id text REFERENCES app_credentials(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_credentials_thumbprint_idx ON app_credentials (public_key_thumbprint);
CREATE INDEX IF NOT EXISTS app_credentials_app_status_idx ON app_credentials (source_app_id, status);

CREATE TABLE IF NOT EXISTS service_assertion_replays (
  id text PRIMARY KEY, credential_id text NOT NULL REFERENCES app_credentials(id) ON UPDATE CASCADE ON DELETE CASCADE,
  assertion_jti text NOT NULL, expires_at timestamptz(3) NOT NULL, created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS service_assertion_replays_credential_jti_idx ON service_assertion_replays (credential_id, assertion_jti);
CREATE INDEX IF NOT EXISTS service_assertion_replays_expires_idx ON service_assertion_replays (expires_at);

CREATE TABLE IF NOT EXISTS ingest_receipts (
  id text PRIMARY KEY, source_app_id text NOT NULL REFERENCES source_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
  idempotency_key text NOT NULL, canonical_digest text NOT NULL,
  ticket_id text REFERENCES feedback_tickets(id) ON UPDATE CASCADE ON DELETE SET NULL,
  result text NOT NULL, response_snapshot jsonb NOT NULL, created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_receipts_app_idempotency_idx ON ingest_receipts (source_app_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ingest_receipts_ticket_idx ON ingest_receipts (ticket_id);

CREATE TABLE IF NOT EXISTS escalation_events (
  id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES feedback_tickets(id) ON UPDATE CASCADE ON DELETE CASCADE,
  generation integer NOT NULL, event_key text NOT NULL, payload jsonb NOT NULL, created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS escalation_events_ticket_generation_idx ON escalation_events (ticket_id, generation);
CREATE UNIQUE INDEX IF NOT EXISTS escalation_events_event_key_idx ON escalation_events (event_key);
CREATE INDEX IF NOT EXISTS escalation_events_ticket_created_idx ON escalation_events (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS routing_incidents (
  id text PRIMARY KEY, escalation_event_id text NOT NULL REFERENCES escalation_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reason text NOT NULL, details jsonb, created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS routing_incidents_event_idx ON routing_incidents (escalation_event_id);

CREATE TABLE IF NOT EXISTS support_group_members (
  id text PRIMARY KEY, group_id text NOT NULL REFERENCES support_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  support_user_id text REFERENCES support_users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  recipient_ref text, role text NOT NULL DEFAULT 'MEMBER', status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS support_group_members_group_user_idx ON support_group_members (group_id, support_user_id);
CREATE INDEX IF NOT EXISTS support_group_members_group_idx ON support_group_members (group_id);

CREATE TABLE IF NOT EXISTS notification_channels (
  id text PRIMARY KEY, group_id text NOT NULL REFERENCES support_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL, type "ChannelType" NOT NULL, status "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
  encrypted_config text NOT NULL, config_nonce text NOT NULL, config_auth_tag text NOT NULL, key_version integer NOT NULL,
  recipient_display text, redacted_destination text, last_succeeded_at timestamptz(3), last_failed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_group_name_idx ON notification_channels (group_id, name);
CREATE INDEX IF NOT EXISTS notification_channels_group_status_idx ON notification_channels (group_id, status);

CREATE TABLE IF NOT EXISTS app_notification_policies (
  id text PRIMARY KEY, source_app_id text NOT NULL REFERENCES source_apps(id) ON UPDATE CASCADE ON DELETE CASCADE,
  minimum_priority "FeedbackPriority" NOT NULL DEFAULT 'MEDIUM', urgent_central_copy boolean NOT NULL DEFAULT true,
  fallback_to_central boolean NOT NULL DEFAULT true, created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_notification_policies_app_idx ON app_notification_policies (source_app_id);

CREATE TABLE IF NOT EXISTS delivery_outbox (
  id text PRIMARY KEY, escalation_event_id text NOT NULL REFERENCES escalation_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
  event_key text NOT NULL, target_key text NOT NULL, generation integer NOT NULL,
  channel_id text REFERENCES notification_channels(id) ON UPDATE CASCADE ON DELETE SET NULL,
  channel_type "ChannelType" NOT NULL, config_source text NOT NULL, rendered_payload jsonb NOT NULL,
  status "DeliveryStatus" NOT NULL DEFAULT 'PENDING', next_attempt_at timestamptz(3) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0, lease_token text, lease_expires_at timestamptz(3), sent_at timestamptz(3),
  created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL,
  CONSTRAINT delivery_outbox_target_source_check CHECK (
    (config_source = 'DATABASE' AND channel_id IS NOT NULL AND target_key = 'channel:' || channel_id)
    OR (config_source = 'LEGACY_ENV' AND channel_id IS NULL AND target_key = 'legacy:central-pushover' AND channel_type = 'PUSHOVER')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_outbox_event_target_generation_idx ON delivery_outbox (event_key, target_key, generation);
CREATE INDEX IF NOT EXISTS delivery_outbox_claim_idx ON delivery_outbox (status, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS delivery_outbox_channel_created_idx ON delivery_outbox (channel_id, created_at);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id text PRIMARY KEY, outbox_id text REFERENCES delivery_outbox(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ordinal integer NOT NULL, target_key text NOT NULL, started_at timestamptz(3) NOT NULL, finished_at timestamptz(3),
  result_class text NOT NULL, provider_status text, sanitized_error text, provider_message_id text,
  created_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_attempts_outbox_ordinal_idx ON delivery_attempts (outbox_id, ordinal);
CREATE INDEX IF NOT EXISTS delivery_attempts_target_created_idx ON delivery_attempts (target_key, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY, actor_type text NOT NULL, actor_id text, action text NOT NULL, subject_type text NOT NULL,
  subject_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, request_correlation_id text, created_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_subject_created_idx ON audit_events (subject_type, subject_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at);

CREATE TABLE IF NOT EXISTS service_rate_limit_buckets (
  id text PRIMARY KEY, scope text NOT NULL, subject text NOT NULL, window_start timestamptz(3) NOT NULL,
  count integer NOT NULL DEFAULT 0, created_at timestamptz(3) NOT NULL, updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS service_rate_limit_buckets_scope_subject_window_idx ON service_rate_limit_buckets (scope, subject, window_start);

CREATE TABLE IF NOT EXISTS support_settings (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz(3) NOT NULL
);

-- `support_settings.key = 'legacy_pushover_bridge_retired_at'` is the explicit
-- cutover marker. Until then, bridge outbox rows use target_key
-- `legacy:central-pushover`, config_source `LEGACY_ENV`, and no credentials.
