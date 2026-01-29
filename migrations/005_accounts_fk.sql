-- Migration: 005_accounts_fk
-- Adds foreign key constraint from api_keys.user_id to accounts.user_id

-- Only add FK if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_api_keys_accounts_user_id'
    ) THEN
        ALTER TABLE api_keys 
        ADD CONSTRAINT fk_api_keys_accounts_user_id 
        FOREIGN KEY (user_id) 
        REFERENCES accounts(user_id) 
        ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'FK constraint not added: %', SQLERRM;
END $$;
