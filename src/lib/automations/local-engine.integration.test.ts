import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => state.db }));
import { runAutomationsForTrigger, resumePendingExecution } from './engine';
import { claimDueAutomations } from '@/lib/db/jobs';
let db: PGlite;
let account: string;
let contact: string;
let automation: string;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = state.db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','automationlocal@test.local')",
    [user]
  );
  account = (
    await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.profiles WHERE user_id=$1',
      [user]
    )
  ).rows[0].account_id;
  contact = (
    await db.query<{ id: string }>(
      "INSERT INTO public.contacts(account_id,user_id,phone,name) VALUES($1,$2,'15551234567','Before') RETURNING id",
      [account, user]
    )
  ).rows[0].id;
  automation = (
    await db.query<{ id: string }>(
      `INSERT INTO public.automations(account_id,user_id,name,is_active,trigger_type,trigger_config) VALUES($1,$2,'Orders',true,'keyword_match','{"keywords":["order status"]}') RETURNING id`,
      [account, user]
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.automation_steps(automation_id,step_type,step_config,position) VALUES($1,'update_contact_field','{"field":"company","value":"{{message.text}}"}',0),($1,'wait','{"amount":1,"unit":"minutes"}',1)`,
    [automation]
  );
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('runs keyword steps locally, records results, and parks delayed work with account ownership', async () => {
  await runAutomationsForTrigger({
    accountId: account,
    contactId: contact,
    triggerType: 'keyword_match',
    context: { message_text: 'my order status' },
  });
  expect(
    (
      await db.query('SELECT company FROM public.contacts WHERE id=$1', [
        contact,
      ])
    ).rows[0]
  ).toEqual({ company: 'my order status' });
  expect(
    (
      await db.query(
        'SELECT account_id,status,steps_executed FROM public.automation_logs'
      )
    ).rows[0]
  ).toMatchObject({
    account_id: account,
    status: 'partial',
    steps_executed: expect.arrayContaining([
      expect.objectContaining({
        step_type: 'update_contact_field',
        status: 'success',
      }),
      expect.objectContaining({ step_type: 'wait', status: 'success' }),
    ]),
  });
  expect(
    (
      await db.query(
        'SELECT account_id,status,next_step_position FROM public.automation_pending_executions'
      )
    ).rows
  ).toEqual([
    { account_id: account, status: 'pending', next_step_position: 2 },
  ]);
  await runAutomationsForTrigger({
    accountId: '10000000-0000-4000-8000-000000000099',
    contactId: contact,
    triggerType: 'keyword_match',
    context: { message_text: 'order status' },
  });
  expect(
    (await db.query('SELECT id FROM public.automation_logs')).rows.length
  ).toBe(1);
});
it('claims due waits once and resumes them to completion', async () => {
  await db.query(
    "UPDATE public.automation_pending_executions SET run_at=now()-interval '1 minute'"
  );
  const claimed = await claimDueAutomations(db);
  expect(claimed.length).toBe(1);
  expect(await claimDueAutomations(db)).toEqual([]);
  await resumePendingExecution(claimed[0]);
  expect(
    (await db.query('SELECT status FROM public.automation_pending_executions'))
      .rows
  ).toEqual([{ status: 'done' }]);
  expect(
    (await db.query('SELECT status FROM public.automation_logs')).rows
  ).toEqual([{ status: 'success' }]);
});
