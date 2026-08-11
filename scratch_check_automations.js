const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAutomations() {
  try {
    const { data, error } = await supabase
      .from('automations')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching automations:', error);
      return;
    }

    console.log('Active Automations:', data.length);
    for (const aut of data) {
      console.log(`- "${aut.name}" (ID: ${aut.id}), Trigger: ${aut.trigger_type}`);
    }
  } catch (err) {
    console.error('Catch error:', err);
  }
}

checkAutomations();
