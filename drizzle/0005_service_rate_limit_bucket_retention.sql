-- Cleanup scans every expired fixed-window bucket, so lead with window_start.
-- Existing migration files stay immutable: this ordered migration is additive.
CREATE INDEX IF NOT EXISTS service_rate_limit_buckets_window_start_idx
  ON service_rate_limit_buckets (window_start, id);
