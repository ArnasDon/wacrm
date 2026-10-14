import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity } from './context-core';
import { importContacts } from './contact-import';
let db: PGlite;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3)',
    [user, 'Alice', 'import@example.test']
  );
  await db.exec('SET ROLE omni_app');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('imports normalized unique numbers and tags, and reports duplicates and invalid numbers', async () => {
  const result = await withIdentity(db, user, (sql) =>
    importContacts(sql, user, [
      { phone: '+1 555 123 4567', tagNames: ['Orders', 'orders'] },
      { phone: '15551234567', tagNames: [] },
      { phone: 'invalid', tagNames: [] },
    ])
  );
  expect(result).toMatchObject({
    imported: 1,
    skipped: 1,
    invalidPhone: 1,
    failed: 0,
    tagsAssigned: 1,
  });
  const again = await withIdentity(db, user, (sql) =>
    importContacts(sql, user, [{ phone: '15551234567', tagNames: [] }])
  );
  expect(again).toMatchObject({ imported: 0, skipped: 1 });
});
