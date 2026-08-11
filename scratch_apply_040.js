const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  console.log('Testing column existence on public.deals...');
  const { data, error } = await supabase.from('deals').select('id, appointment_at, appointment_reminder_sent').limit(1);
  if (error) {
    console.log('Columns might not exist yet or REST query error:', error.message);
  } else {
    console.log('Columns appointment_at and appointment_reminder_sent are accessible on deals table!');
  }
}

applyMigration();
