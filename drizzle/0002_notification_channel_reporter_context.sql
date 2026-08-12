-- Target-scoped alert privacy control. Existing channels remain opted out.
ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS include_reporter_context boolean NOT NULL DEFAULT false;
