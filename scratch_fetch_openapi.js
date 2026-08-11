require('dotenv').config({ path: '.env.local' });

async function fetchOpenApi() {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
    const res = await fetch(url);
    const text = await res.text();
    console.log('API Response snippet:', text.slice(0, 500));
    const data = JSON.parse(text);
    if (data.definitions) {
      console.log('Tables in Schema:', Object.keys(data.definitions));
    }
  } catch (err) {
    console.error('Error fetching OpenAPI schema:', err.message);
  }
}

fetchOpenApi();
