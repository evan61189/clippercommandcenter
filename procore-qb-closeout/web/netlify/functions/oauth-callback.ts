import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROCORE_TOKEN_URL = 'https://api.procore.com/oauth/token';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export const handler: Handler = async (event) => {
  const { provider } = event.queryStringParameters || {};
  const code = event.queryStringParameters?.code;
  const state = event.queryStringParameters?.state; // Contains userId
  const realmId = event.queryStringParameters?.realmId; // QuickBooks company ID

  if (!provider || !code || !state) {
    return {
      statusCode: 302,
      headers: { Location: '/?error=missing_params' },
      body: '',
    };
  }

  try {
    let tokens: any;
    let credentials: any;

    if (provider === 'procore') {
      const clientId = process.env.PROCORE_CLIENT_ID;
      const clientSecret = process.env.PROCORE_CLIENT_SECRET;
      const redirectUri = process.env.PROCORE_REDIRECT_URI || `${process.env.URL}/.netlify/functions/oauth-callback?provider=procore`;

      const response = await fetch(PROCORE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Procore token error:', error);
        return {
          statusCode: 302,
          headers: { Location: '/?error=procore_token_failed' },
          body: '',
        };
      }

      tokens = await response.json();

      // Get company ID from Procore
      const companiesResponse = await fetch('https://api.procore.com/rest/v1.0/companies', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const companies = await companiesResponse.json();
      const companyId = companies[0]?.id;

      credentials = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        company_id: String(companyId),
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      };
    } else if (provider === 'quickbooks') {
      const clientId = process.env.QBO_CLIENT_ID;
      const clientSecret = process.env.QBO_CLIENT_SECRET;
      const redirectUri = process.env.QBO_REDIRECT_URI || `${process.env.URL}/.netlify/functions/oauth-callback?provider=quickbooks`;

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const response = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('QuickBooks token error:', error);
        return {
          statusCode: 302,
          headers: { Location: '/?error=qbo_token_failed' },
          body: '',
        };
      }

      tokens = await response.json();

      credentials = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        realm_id: realmId,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      };
    } else {
      return {
        statusCode: 302,
        headers: { Location: '/?error=invalid_provider' },
        body: '',
      };
    }

    // Store credentials in Supabase
    const { error } = await supabase.from('api_credentials').upsert(
      {
        user_id: state,
        provider,
        credentials,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    );

    if (error) {
      console.error('Supabase error:', error);
      return {
        statusCode: 302,
        headers: { Location: '/?error=storage_failed' },
        body: '',
      };
    }

    return {
      statusCode: 302,
      headers: { Location: `/settings?connected=${provider}` },
      body: '',
    };
  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return {
      statusCode: 302,
      headers: { Location: `/?error=${error.message}` },
      body: '',
    };
  }
};
