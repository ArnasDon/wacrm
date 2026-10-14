vi.mock('@/lib/db/worker-lock', () => {
  let tail = Promise.resolve();
  return {
    withFlowContactLock: (
      _a: string,
      _c: string,
      work: () => Promise<unknown>
    ) => {
      const result = tail.then(work);
      tail = result.then(
        () => {},
        () => {}
      );
      return result;
    },
  };
});
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => state.db }));
vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'wamid.prompt' })),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}));
import { dispatchInboundToFlows } from './engine';
import { engineSendText } from './meta-send';
let db: PGlite;
let account: string;
let contact: string;
let conversation: string;
let flow: string;
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  db = state.db = await createTestDatabase();
  await db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','flowdispatch@test.local')",
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
      "INSERT INTO public.contacts(account_id,user_id,phone) VALUES($1,$2,'15551234567') RETURNING id",
      [account, user]
    )
  ).rows[0].id;
  conversation = (
    await db.query<{ id: string }>(
      'INSERT INTO public.conversations(account_id,user_id,contact_id) VALUES($1,$2,$3) RETURNING id',
      [account, user, contact]
    )
  ).rows[0].id;
  flow = (
    await db.query<{ id: string }>(
      `INSERT INTO public.flows(account_id,user_id,name,status,trigger_type,trigger_config,entry_node_id) VALUES($1,$2,'Orders','active','keyword','{"keywords":["order status"]}','start') RETURNING id`,
      [account, user]
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.flow_nodes(flow_id,node_key,node_type,config) VALUES($1,'start','start','{"next_node_key":"collect"}'),($1,'collect','collect_input','{"prompt_text":"Order number?","var_key":"order","next_node_key":"reply"}'),($1,'reply','send_message','{"text":"Checking {{vars.order}}","next_node_key":"done"}'),($1,'done','end','{}')`,
    [flow]
  );
  await db.exec('SET ROLE omni_worker');
}, 30000);
afterAll(async () => {
  await db?.close();
});
it('starts on a keyword, asks for input, captures a reply, and completes locally', async () => {
  const base = {
    accountId: account,
    userId: user,
    contactId: contact,
    conversationId: conversation,
    isFirstInboundMessage: true,
  };
  expect(
    await dispatchInboundToFlows({
      ...base,
      message: {
        kind: 'text',
        text: 'my order status',
        meta_message_id: 'wamid.first',
      },
    })
  ).toMatchObject({ consumed: true, outcome: 'started' });
  expect(engineSendText).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Order number?' })
  );
  expect(
    await dispatchInboundToFlows({
      ...base,
      isFirstInboundMessage: false,
      message: { kind: 'text', text: '12345', meta_message_id: 'wamid.second' },
    })
  ).toMatchObject({ consumed: true, outcome: 'completed' });
  expect(engineSendText).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Checking 12345' })
  );
  expect(
    (await db.query('SELECT status,vars FROM public.flow_runs')).rows
  ).toEqual([{ status: 'completed', vars: { order: '12345' } }]);
});
it('serializes concurrent replies before capturing variables or sending a terminal reply', async () => {
  const base = {
    accountId: account,
    userId: user,
    contactId: contact,
    conversationId: conversation,
    isFirstInboundMessage: false,
  };
  await dispatchInboundToFlows({
    ...base,
    message: {
      kind: 'text',
      text: 'order status',
      meta_message_id: 'wamid.concurrent-start',
    },
  });
  vi.mocked(engineSendText).mockClear();
  await Promise.all(
    ['111', '222'].map((text) =>
      dispatchInboundToFlows({
        ...base,
        message: {
          kind: 'text',
          text,
          meta_message_id: 'wamid.concurrent-' + text,
        },
      })
    )
  );
  expect(
    vi
      .mocked(engineSendText)
      .mock.calls.filter(([args]) => args.text.startsWith('Checking '))
  ).toHaveLength(1);
});
