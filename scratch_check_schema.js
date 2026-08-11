const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  const { data, error } = await supabase.from('deals').select('*').limit(1);
  if (error) {
    console.log('Error querying deals:', error);
  } else {
    console.log('Successfully queried deals table. Rows:', data);
  }
}

checkSchema();
