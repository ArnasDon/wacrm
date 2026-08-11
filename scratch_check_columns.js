require('dotenv').config({ path: '.env.local' });

async function checkAllTableColumns() {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log('--- Table Column Check ---');
    for (const [tableName, definition] of Object.entries(data.definitions)) {
      const columns = Object.keys(definition.properties || {});
      console.log(`Table "${tableName}": [${columns.join(', ')}]`);
    }
  } catch (err) {
    console.error('Error checking columns:', err.message);
  }
}

checkAllTableColumns();
