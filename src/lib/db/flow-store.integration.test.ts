import { beforeAll, afterAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { FlowStore } from './flow-store';
import { writeWorkerTag } from '@/lib/contacts/tag-worker';
import { timeoutFlowRuns } from './jobs';
let db: PGlite;
let account: string;
let other: string;
let flowId: string;
let contactId: string;
let conversationId: string;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','flowstore@test.local'),('10000000-0000-4000-8000-000000000002','Other','otherflowstore@test.local')",
    [user]
  );
  const rows = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles ORDER BY user_id'
    )
  ).rows;
  account = rows[0].account_id;
  other = rows[1].account_id;
  flowId = (
    await db.query<{ id: string }>(
      "INSERT INTO public.flows(account_id,user_id,name,status,entry_node_id,trigger_type) VALUES($1,$2,'Orders','active','start','manual') RETURNING id",
      [account, user]
    )
  ).rows[0].id;
  contactId = (
    await db.query<{ id: string }>(
      "INSERT INTO public.contacts(account_id,user_id,phone) VALUES($1,$2,'15551234567') RETURNING id",
      [account, user]
    )
  ).rows[0].id;
  conversationId = (
    await db.query<{ id: string }>(
      'INSERT INTO public.conversations(account_id,user_id,contact_id) VALUES($1,$2,$3) RETURNING id',
      [account, user, contactId]
    )
  ).rows[0].id;
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('scopes graphs/runs, starts once, checks node transitions, and increments counters atomically', async () => {
  const store = new FlowStore(db, account);
  const foreign = new FlowStore(db, other);
  expect(await foreign.flow(flowId)).toBeNull();
  expect(await foreign.nodes(flowId)).toEqual([]);
  const run = await store.start(flowId, contactId, conversationId);
  expect(run).toMatchObject({
    account_id: account,
    current_node_key: 'start',
    status: 'active',
  });
  expect(await store.start(flowId, contactId, conversationId)).toBeNull();
  expect(
    (
      await db.query('SELECT execution_count FROM public.flows WHERE id=$1', [
        flowId,
      ])
    ).rows[0]
  ).toEqual({ execution_count: 1 });
  expect(await foreign.advance(run!.id, 'start', 'collect')).toBe(false);
  expect(await store.advance(run!.id, 'wrong', 'collect')).toBe(false);
  expect(await store.advance(run!.id, 'start', 'collect')).toBe(true);
  await store.capture(run!.id, { order_number: '123' });
  expect(await store.activeRun(contactId)).toMatchObject({
    vars: { order_number: '123' },
    current_node_key: 'collect',
  });
  await store.event(run!.id, 'reply_received', 'collect', {
    meta_message_id: 'wamid.reply',
  });
  expect(await store.duplicate(contactId, 'wamid.reply')).toBe(true);
  expect(await foreign.duplicate(contactId, 'wamid.reply')).toBe(false);
  await foreign.end(run!.id, 'failed', 'forged');
  expect(await store.activeRun(contactId)).not.toBeNull();
  await store.end(run!.id, 'completed', 'finished');
  expect(await store.activeRun(contactId)).toBeNull();
});
it('validates contact and tag ownership and inserts each tag link once', async () => {
  const tag = (
    await db.query<{ id: string }>(
      "INSERT INTO public.tags(account_id,user_id,name) VALUES($1,$2,'Order') RETURNING id",
      [account, user]
    )
  ).rows[0].id;
  const input = { accountId: account, contactId, tagId: tag };
  expect(await writeWorkerTag(db, input)).toBe(true);
  expect(await writeWorkerTag(db, input)).toBe(false);
  await expect(
    writeWorkerTag(db, { ...input, accountId: other })
  ).rejects.toThrow();
});
it('expires stale flows once and records a timeout event', async () => {
  const run = await new FlowStore(db, account).start(
    flowId,
    contactId,
    conversationId
  );
  await db.query(
    "UPDATE public.flow_runs SET last_advanced_at=now()-interval '3 days' WHERE id=$1",
    [run!.id]
  );
  expect(await timeoutFlowRuns(db)).toBe(1);
  expect(await timeoutFlowRuns(db)).toBe(0);
  expect(
    (
      await db.query(
        "SELECT event_type FROM public.flow_run_events WHERE flow_run_id=$1 AND event_type='timeout'",
        [run!.id]
      )
    ).rows
  ).toEqual([{ event_type: 'timeout' }]);
});
