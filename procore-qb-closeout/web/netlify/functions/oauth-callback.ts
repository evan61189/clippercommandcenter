import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROCORE_TOKEN_URL = 'https://api.procore.com/oauth/token';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export const handler: Handler = async (event) => {
  const { provider } = event.queryStringParameters || {};
  const code = event.queryStringParameters?.code;
  const rawState = event.queryStringParameters?.state;
  const realmId = event.queryStringParameters?.realmId; // QuickBooks company ID

  if (!provider || !code || !rawState) {
    return {
      statusCode: 302,
      headers: { Location: '/?error=missing_params' },
      body: '',
    };
  }

  // Parse CSRF state — supports both new JSON format and legacy plain userId
  let state: string;
  try {
    const decoded = JSON.parse(Buffer.from(rawState, 'base64').toString('utf-8'));
    if (!decoded.userId || !decoded.nonce) {
      console.error('Invalid CSRF state: missing fields');
      return { statusCode: 302, headers: { Location: '/?error=csrf_invalid' }, body: '' };
    }
    state = decoded.userId;
    console.log(`OAuth callback with CSRF nonce for provider=${decoded.provider}, userId=${state}`);
  } catch {
    // Legacy fallback: state is just the raw userId string
    state = rawState;
    console.log('OAuth callback with legacy state (no CSRF nonce)');
  }

  try {
    let tokens: any;
    let credentials: any;

    if (provider === 'procore') {
      // Hardcoded Procore credentials as fallback
      const clientId = process.env.PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k';
      const clientSecret = process.env.PROCORE_CLIENT_SECRET || 'z-aqwtz7agk1fyEyXW10zsV4SGKrjNP58bGqXgD4vd0';
      const redirectUri = process.env.PROCORE_REDIRECT_URI || `${process.env.URL}/.netlify/functions/oauth-callback?provider=procore`;

      console.log('Procore OAuth - clientId exists:', !!clientId, 'clientSecret exists:', !!clientSecret);

      if (!clientId || !clientSecret) {
        console.error('Missing Procore credentials in environment');
        return {
          statusCode: 302,
          headers: { Location: '/?error=missing_procore_credentials' },
          body: '',
        };
      }

      const response = await fetch(PROCORE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
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
      console.log('Procore tokens received, fetching companies...');

      // Get company ID from Procore
      const companiesResponse = await fetch('https://api.procore.com/rest/v1.0/companies', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!companiesResponse.ok) {
        const errorText = await companiesResponse.text();
        console.error('Failed to fetch Procore companies:', errorText);
        return {
          statusCode: 302,
          headers: { Location: '/?error=procore_companies_failed' },
          body: '',
        };
      }

      const companies = await companiesResponse.json();
      console.log('Procore companies:', JSON.stringify(companies));

      if (!companies || companies.length === 0) {
        console.error('No Procore companies found');
        return {
          statusCode: 302,
          headers: { Location: '/?error=no_procore_companies' },
          body: '',
        };
      }

      const companyId = companies[0]?.id;
      console.log('Using Procore company ID:', companyId);

      credentials = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        company_id: String(companyId),
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      };
    } else if (provider === 'quickbooks') {
      // Hardcoded QuickBooks credentials as fallback
      const clientId = process.env.QBO_CLIENT_ID || 'ABE01lFAdrTOVwsFkI5YwJoUPD1OpG8pwMbW9FEGjVf4bgT6Y7';
      const clientSecret = process.env.QBO_CLIENT_SECRET || 'BIugIZAZB4R4o49eSvqQFIEBi6S2rnn3K5jhXfqZ';
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
