import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * QuickBooks Disconnect Webhook
 *
 * This endpoint is called by QuickBooks/Intuit when a user disconnects the app
 * from their QuickBooks account (either from within QuickBooks or from the Intuit
 * developer portal).
 *
 * The webhook receives the realmId (company ID) of the disconnected account.
 * We use this to find and delete the stored credentials.
 */
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // QuickBooks sends disconnect notifications via POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('QuickBooks disconnect webhook received');
    console.log('Headers:', JSON.stringify(event.headers));
    console.log('Body:', event.body);

    // Parse the webhook payload
    // QuickBooks sends: { "eventNotifications": [{ "realmId": "...", "dataChangeEvent": {...} }] }
    // Or for disconnect: the realmId in the payload
    const payload = JSON.parse(event.body || '{}');

    let realmId: string | null = null;

    // Handle different payload formats
    if (payload.realmId) {
      realmId = payload.realmId;
    } else if (payload.eventNotifications && payload.eventNotifications.length > 0) {
      realmId = payload.eventNotifications[0].realmId;
    }

    if (!realmId) {
      console.log('No realmId found in disconnect payload');
      // Still return 200 to acknowledge receipt
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Acknowledged, no realmId provided' }),
      };
    }

    console.log('Processing disconnect for realmId:', realmId);

    // Find and delete credentials with this realmId
    // The realmId is stored in credentials.realm_id
    const { data: credentials, error: findError } = await supabase
      .from('api_credentials')
      .select('*')
      .eq('provider', 'quickbooks');

    if (findError) {
      console.error('Error finding credentials:', findError);
      return {
        statusCode: 200, // Return 200 to prevent retries
        headers,
        body: JSON.stringify({ message: 'Acknowledged with error', error: findError.message }),
      };
    }

    // Find credentials matching this realmId
    const matchingCredentials = credentials?.filter(
      (cred: any) => cred.credentials?.realm_id === realmId
    );

    if (matchingCredentials && matchingCredentials.length > 0) {
      for (const cred of matchingCredentials) {
        console.log('Deleting credentials for user:', cred.user_id);

        const { error: deleteError } = await supabase
          .from('api_credentials')
          .delete()
          .eq('user_id', cred.user_id)
          .eq('provider', 'quickbooks');

        if (deleteError) {
          console.error('Error deleting credentials:', deleteError);
        } else {
          console.log('Successfully deleted QuickBooks credentials for user:', cred.user_id);
        }
      }
    } else {
      console.log('No matching credentials found for realmId:', realmId);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Disconnect processed successfully' }),
    };
  } catch (error: any) {
    console.error('QuickBooks disconnect webhook error:', error);
    // Return 200 to prevent QuickBooks from retrying
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Acknowledged with error', error: error.message }),
    };
  }
};
