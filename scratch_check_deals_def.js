require('dotenv').config({ path: '.env.local' });

async function fetchDealsDefinition() {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log('Deals Definition:');
    console.log(data.definitions.deals);
  } catch (err) {
    console.error('Error fetching Deals definition:', err.message);
  }
}

fetchDealsDefinition();
