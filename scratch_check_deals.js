const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDeals() {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('id, title, appointment_at, appointment_reminder_sent, contact_id');

    if (error) {
      console.error('Error fetching deals:', error);
      return;
    }

    console.log('Deals found:', data.length);
    for (const d of data) {
      console.log(`- Deal "${d.title}": appointment_at = ${d.appointment_at}, reminder_sent = ${d.appointment_reminder_sent}, contact_id = ${d.contact_id}`);
    }
  } catch (err) {
    console.error('Catch error:', err);
  }
}

checkDeals();
