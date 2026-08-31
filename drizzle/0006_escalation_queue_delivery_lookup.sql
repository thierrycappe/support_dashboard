-- Queue delivery state is computed from the latest generation for each target.
-- Existing migrations remain immutable; these indexes are additive.
CREATE INDEX IF NOT EXISTS escalation_events_ticket_generation_desc_idx
  ON escalation_events (ticket_id, generation DESC, id);

CREATE INDEX IF NOT EXISTS delivery_outbox_event_target_generation_desc_idx
  ON delivery_outbox (escalation_event_id, target_key, generation DESC, created_at DESC, id);
