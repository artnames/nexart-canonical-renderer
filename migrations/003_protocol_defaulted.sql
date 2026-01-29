-- Add protocol_defaulted column to track lenient defaulting behavior
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS protocol_defaulted BOOLEAN DEFAULT NULL;

-- Index for auditing defaulted requests
CREATE INDEX IF NOT EXISTS idx_usage_events_protocol_defaulted ON usage_events(protocol_defaulted) WHERE protocol_defaulted = true;
