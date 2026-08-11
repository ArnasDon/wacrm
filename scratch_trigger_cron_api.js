const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerCron() {
  try {
    console.log('1. Resetting deal status...');
    await supabase
      .from('deals')
      .update({ appointment_reminder_sent: false })
      .eq('title', '.');
    console.log('Deal reset.');

    console.log('2. Hitting Next.js cron API endpoint...');
    const res = await fetch('http://localhost:3000/api/automations/cron', {
      headers: {
        'x-cron-secret': 'mycronsecret123'
      }
    });
    const status = res.status;
    const body = await res.text();
    console.log(`API Response status: ${status}`);
    console.log(`API Response body:`, body);

    console.log('3. Waiting 3 seconds for async tasks...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('4. Checking database automation logs...');
    const { data: logs, error } = await supabase
      .from('automation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.error('Error fetching logs:', error);
      return;
    }

    console.log('Latest Logs:');
    for (const log of logs) {
      console.log(`- Time: ${log.created_at}, Event: ${log.trigger_event}, Status: ${log.status}, Error: ${log.error_message}`);
      console.log(`  Steps:`, JSON.stringify(log.steps_executed, null, 2));
    }
  } catch (err) {
    console.error('Error triggering cron:', err);
  }
}

triggerCron();
