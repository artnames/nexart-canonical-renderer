-- Migration: 004_accounts_quota
-- Creates accounts table and links api_keys for account-level quota enforcement

-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
    user_id VARCHAR(255) PRIMARY KEY,
    plan VARCHAR(50) NOT NULL DEFAULT 'free',
    monthly_limit INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add user_id column to api_keys if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'api_keys' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE api_keys ADD COLUMN user_id VARCHAR(255);
    END IF;
END $$;

-- Create index for quota lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- Create index on usage_events for efficient monthly counting
CREATE INDEX IF NOT EXISTS idx_usage_events_quota_lookup 
ON usage_events(api_key_id, endpoint, status_code, ts);
