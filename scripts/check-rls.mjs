import postgres from 'postgres';
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:5432/postgres');
async function run() {
  try {
    const policies = await sql`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename IN ('orders', 'order_items')`;
    console.log('POLICIES:', JSON.stringify(policies, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}
run();
