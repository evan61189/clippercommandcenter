import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use service key for server-side operations (bypasses RLS)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { projectId } = JSON.parse(event.body || '{}');

    if (!projectId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'projectId is required' }),
      };
    }

    console.log('Deleting project and associated data:', projectId);

    // First get all reports for this project
    const { data: reports, error: reportsQueryError } = await supabase
      .from('reconciliation_reports')
      .select('id')
      .eq('project_id', projectId);

    if (reportsQueryError) {
      console.error('Error querying reports:', reportsQueryError);
      throw reportsQueryError;
    }

    console.log(`Found ${reports?.length || 0} reports to delete`);

    // Delete associated data for each report
    for (const report of reports || []) {
      console.log('Deleting data for report:', report.id);

      const { error: resultsError } = await supabase
        .from('reconciliation_results')
        .delete()
        .eq('report_id', report.id);
      if (resultsError) console.error('Error deleting results:', resultsError);

      const { error: closeoutError } = await supabase
        .from('closeout_items')
        .delete()
        .eq('report_id', report.id);
      if (closeoutError) console.error('Error deleting closeout items:', closeoutError);

      const { error: commitmentsError } = await supabase
        .from('commitments')
        .delete()
        .eq('report_id', report.id);
      if (commitmentsError) console.error('Error deleting commitments:', commitmentsError);
    }

    // Delete all reports for this project
    const { error: reportsDeleteError } = await supabase
      .from('reconciliation_reports')
      .delete()
      .eq('project_id', projectId);

    if (reportsDeleteError) {
      console.error('Error deleting reports:', reportsDeleteError);
      throw reportsDeleteError;
    }

    console.log('Deleted all reports, now deleting project');

    // Delete the project itself
    const { error: projectError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (projectError) {
      console.error('Error deleting project:', projectError);
      throw projectError;
    }

    console.log('Project deleted successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Project and all associated data deleted' }),
    };
  } catch (error: any) {
    console.error('Delete error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to delete project' }),
    };
  }
};
