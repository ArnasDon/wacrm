/**
 * Test audience for load / throughput testing with the mock Meta API —
 * `npm run gen:csv -- 20000` writes test-contacts-20000.csv.
 *
 * Numbers are 91999XXXXXXX (fake, recognisable) so the test contacts can
 * be deleted afterwards:  DELETE FROM contacts WHERE phone LIKE '+91999%';
 * NEVER send these through a real channel — use them with `npm run mock:meta`.
 */
import { writeFileSync } from 'node:fs';

const n = Math.max(1, Number(process.argv[2] ?? 1000));
const rows = ['phone,name,city'];
for (let i = 0; i < n; i++) {
  rows.push(
    `91999${String(i).padStart(7, '0')},Test ${i + 1},City ${(i % 10) + 1}`
  );
}
const file = `test-contacts-${n}.csv`;
writeFileSync(file, rows.join('\n') + '\n');
console.log(`Wrote ${n} rows to ${file}`);

export {};
