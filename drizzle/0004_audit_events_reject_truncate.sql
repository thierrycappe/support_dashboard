-- Preserve audit evidence from destructive statement-level cleanup.
DROP TRIGGER IF EXISTS audit_events_reject_truncate ON audit_events;
CREATE TRIGGER audit_events_reject_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION support_tower_reject_audit_event_mutation();
