const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLogs() {
  try {
    const { data: logs, error } = await supabase
      .from('automation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching logs:', error);
      return;
    }

    console.log('Last logs found:', logs.length);
    for (const log of logs) {
      console.log(`- Log: Trigger Event: ${log.trigger_event}, Status: ${log.status}, Created At: ${log.created_at}, Error: ${log.error_message}`);
    }
  } catch (err) {
    console.error('Catch error:', err);
  }
}

checkLogs();
