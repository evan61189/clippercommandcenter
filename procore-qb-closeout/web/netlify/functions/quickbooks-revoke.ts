import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

// From Intuit discovery document
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { userId } = JSON.parse(event.body || '{}');
    if (!userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId required' }) };

    // Get stored tokens
    const { data, error } = await supabase
      .from('api_credentials')
      .select('credentials')
      .eq('user_id', userId)
      .eq('provider', 'quickbooks')
      .single();

    if (error || !data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No QB credentials found' }) };
    }

    const tokens = data.credentials as { access_token: string; refresh_token: string };
    const clientId = process.env.QBO_CLIENT_ID || 'ABenQKVtNNzyfGlYzpNUsu5CF3O8t9PzrQw2LnxcgpnHEVAe2F';
    const clientSecret = process.env.QBO_CLIENT_SECRET || 'e2TkJJWomPMvwcN0CfYfLHnPhaINK2WA9eiIXl0L';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // Revoke the refresh token (this also invalidates the access token)
    const revokeRes = await fetch(QBO_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: tokens.refresh_token }),
    });

    if (!revokeRes.ok) {
      const errBody = await revokeRes.text();
      console.error('QB revoke failed:', revokeRes.status, errBody);
      // Continue anyway — we'll still delete local credentials
    } else {
      console.log('QB token revoked successfully');
    }

    // Delete local credentials
    await supabase
      .from('api_credentials')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'quickbooks');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (error: any) {
    console.error('QB revoke error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
