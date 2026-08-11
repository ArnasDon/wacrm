const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetDeal() {
  try {
    const { data, error } = await supabase
      .from('deals')
      .update({ appointment_reminder_sent: false })
      .eq('title', '.');

    if (error) {
      console.error('Error resetting deal:', error);
      return;
    }

    console.log('Deal reset successfully!');
  } catch (err) {
    console.error('Catch error:', err);
  }
}

resetDeal();
