-- Migration: 002_usage_events
-- Creates the usage_events table for tracking API usage

CREATE TABLE IF NOT EXISTS usage_events (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    api_key_id INTEGER REFERENCES api_keys(id),
    endpoint VARCHAR(100) NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    sdk_version VARCHAR(20),
    protocol_version VARCHAR(20),
    runtime_hash VARCHAR(64),
    output_hash_prefix VARCHAR(16),
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts);
CREATE INDEX IF NOT EXISTS idx_usage_events_api_key_id ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_endpoint ON usage_events(endpoint);
