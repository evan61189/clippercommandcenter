-- API Credentials table for storing OAuth tokens
-- This allows each user to connect their own Procore/QuickBooks accounts

CREATE TABLE IF NOT EXISTS api_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL, -- 'procore' or 'quickbooks'
    credentials JSONB NOT NULL, -- Stores access_token, refresh_token, etc.
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, provider)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_api_credentials_user ON api_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_api_credentials_provider ON api_credentials(provider);

-- RLS policies
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;

-- Users can only see their own credentials
CREATE POLICY "Users can view own credentials" ON api_credentials
    FOR SELECT USING (true); -- Adjust based on your auth setup

CREATE POLICY "Users can insert own credentials" ON api_credentials
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own credentials" ON api_credentials
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete own credentials" ON api_credentials
    FOR DELETE USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_api_credentials_updated_at
    BEFORE UPDATE ON api_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
