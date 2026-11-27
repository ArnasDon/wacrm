import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const account = '00000000-0000-0000-0000-000000000001';
const conversation = '00000000-0000-0000-0000-000000000002';
const contact = '00000000-0000-0000-0000-000000000003';
const owner = '00000000-0000-0000-0000-000000000004';
const admin = '00000000-0000-0000-0000-000000000005';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE contacts(id uuid PRIMARY KEY);
    CREATE TABLE messages(id uuid PRIMARY KEY);
    CREATE TABLE profiles(user_id uuid, account_id uuid, account_role text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,contact_id uuid,assigned_agent_id uuid,
      status text DEFAULT 'open',ai_autoreply_disabled boolean DEFAULT false,ai_reply_count int DEFAULT 0,
      last_agent_message_at timestamptz,last_message_text text,updated_at timestamptz DEFAULT now());
    CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(),account_id uuid,user_id uuid,type text CHECK(type IN ('conversation_assigned')),
      conversation_id uuid,contact_id uuid,actor_user_id uuid,title text,body text,read_at timestamptz);
    CREATE TABLE flow_runs(id uuid,account_id uuid,conversation_id uuid,status text,ended_at timestamptz,end_reason text);
    CREATE TABLE order_drafts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid,conversation_id uuid,state jsonb NOT NULL DEFAULT '{}',
      contact_id uuid,processing_message_id text,updated_at timestamptz DEFAULT now(),UNIQUE(account_id,conversation_id));
    CREATE TABLE orders(id uuid,account_id uuid,external_reference text,status text);
    CREATE TABLE order_checkouts(account_id uuid,external_reference text,status text);
  `);
  await db.exec(
    readFileSync('supabase/migrations/036_lossless_order_drafts.sql', 'utf8')
  );
  await db.exec(
    readFileSync('supabase/migrations/039_conversation_handoff.sql', 'utf8')
  );
  await db.exec(
    readFileSync('supabase/migrations/042_order_intent_priority.sql', 'utf8')
  );
  await db.exec(
    readFileSync(
      'supabase/migrations/044_handoff_auto_resume_and_error_detail.sql',
      'utf8'
    )
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    'TRUNCATE notifications,flow_runs,order_draft_history,order_drafts,order_inbound_events,orders,order_checkouts,conversations,profiles,accounts CASCADE'
  );
  await db.query('INSERT INTO accounts VALUES($1,$2)', [account, owner]);
  await db.query("INSERT INTO profiles VALUES($1,$2,'owner'),($3,$2,'admin')", [
    owner,
    account,
    admin,
  ]);
  await db.query(
    "INSERT INTO conversations(id,account_id,contact_id,last_message_text) VALUES($1,$2,$3,'Falar com atendente')",
    [conversation, account, contact]
  );
});
async function decision(
  request = false,
  reason = 'customer_request',
  resume = false
) {
  const r = await db.query<{
    result: {
      blocked: boolean;
      notice?: string;
      episode_id?: string;
      resumed?: boolean;
    };
  }>('SELECT handle_conversation_handoff($1,$2,$3,$4,$5,$6) AS result', [
    account,
    conversation,
    contact,
    request,
    reason,
    resume,
  ]);
  return r.rows[0].result;
}

describe('handoff migration on real in-memory Postgres', () => {
  it('keeps the seven-argument trusted RPC service-role-only and security definer', async () => {
    const r = await db.query<{
      definer: boolean;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`SELECT p.prosecdef AS definer,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service
      FROM pg_proc p WHERE p.oid='public.handle_conversation_handoff(uuid,uuid,uuid,boolean,text,boolean,boolean)'::regprocedure`);
    expect(r.rows).toEqual([
      { definer: true, anon: false, authenticated: false, service: true },
    ]);
  });
  it('does not let trusted intent bypass conversation ownership or an explicit handoff request', async () => {
    await expect(
      db.query(
        'SELECT handle_conversation_handoff($1,$2,$3,false,$4,false,true)',
        [account, conversation, owner, 'customer_request']
      )
    ).rejects.toThrow('does not belong');
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      0
    );
    const result = await db.query<{ result: { blocked: boolean } }>(
      'SELECT handle_conversation_handoff($1,$2,$3,true,$4,false,true) AS result',
      [account, conversation, contact, 'customer_request']
    );
    expect(result.rows[0].result.blocked).toBe(true);
  });
  it.each([
    'manual',
    'customer_request',
    'payment_review',
    'technical_error',
    'human_active',
    'order_review',
  ])(
    'validated intent overrides %s and the prior human without changing financial or flow state',
    async (reason) => {
      await db.query(
        "UPDATE conversations SET assigned_agent_id=$1,last_agent_message_at=now()-interval '1 minute' WHERE id=$2",
        [admin, conversation]
      );
      await decision(true, reason);
      await db.query(
        "INSERT INTO flow_runs(id,account_id,conversation_id,status) VALUES($1,$2,$3,'active')",
        [contact, account, conversation]
      );
      await db.query(
        "INSERT INTO order_drafts(account_id,conversation_id,state,processing_message_id) VALUES($1,$2,$3,'uncertain-turn')",
        [
          account,
          conversation,
          { id: contact, version: 2, stage: 'payment_created' },
        ]
      );
      await db.query("INSERT INTO order_checkouts VALUES($1,$2,'uncertain')", [
        account,
        `TEXT-${contact}-2`,
      ]);
      await db.query(
        "INSERT INTO orders VALUES($1,$2,$3,'checkout_uncertain')",
        [contact, account, `TEXT-${contact}-2`]
      );
      await db.query(
        "INSERT INTO order_message_outbox(account_id,conversation_id,effect_key,status,payload) VALUES($1,$2,'existing-send','uncertain','{}')",
        [account, conversation]
      );
      const snapshot = async () =>
        Promise.all(
          [
            'flow_runs',
            'order_drafts',
            'order_checkouts',
            'orders',
            'order_message_outbox',
          ].map(async (t) => (await db.query(`SELECT * FROM ${t}`)).rows)
        );
      const before = await snapshot();
      const result = await db.query<{
        result: { blocked: boolean; resumed: boolean };
      }>(
        'SELECT handle_conversation_handoff($1,$2,$3,false,$4,false,true) AS result',
        [account, conversation, contact, 'customer_request']
      );
      expect(result.rows[0].result).toEqual({ blocked: false, resumed: true });
      expect(await snapshot()).toEqual(before);
      const c = (
        await db.query<Record<string, unknown>>('SELECT * FROM conversations')
      ).rows[0];
      expect(c).toMatchObject({
        status: 'open',
        ai_autoreply_disabled: false,
        assigned_agent_id: admin,
        bot_pause_reason: null,
        bot_handoff_id: null,
      });
      expect(c.last_agent_message_at).not.toBeNull();
      expect(c.bot_order_resumed_at).not.toBeNull();
      expect((await decision()).blocked).toBe(false);
      await db.exec(
        "UPDATE conversations SET last_agent_message_at=now()+interval '1 second'"
      );
      expect((await decision()).blocked).toBe(true);
      expect(await snapshot()).not.toEqual(before); // a genuinely new human may hand off the active flow
    }
  );
  it('rotates an expired legacy draft after the real claim renews updated_at', async () => {
    const state = {
      id: contact,
      version: 2,
      stage: 'collecting',
      items: [],
      total: 28,
    };
    await db.query(
      "INSERT INTO order_drafts(account_id,conversation_id,contact_id,state,updated_at) VALUES($1,$2,$3,$4,now()-interval '25 hours')",
      [account, conversation, contact, state]
    );
    const before = await db.query<{ updated_at: Date; expired: boolean }>(
      "SELECT updated_at,coalesce((state->>'cartUpdatedAt')::timestamptz,updated_at)<=now()-interval '24 hours' AS expired FROM order_drafts"
    );
    expect(before.rows[0].expired).toBe(true);
    const claimed = await db.query<{
      result: { outcome: string; state: Record<string, unknown> };
    }>('SELECT claim_order_turn($1,$2,$3,$4,$5) AS result', [
      account,
      conversation,
      contact,
      'legacy-message',
      'adicionar outro produto',
    ]);
    expect(claimed.rows[0].result.outcome).toBe('claimed');
    const rotated = await db.query<{ state: { id: string; stage: string } }>(
      'SELECT rotate_order_draft($1,$2,$3,$4,false) AS state',
      [account, conversation, 'legacy-message', claimed.rows[0].result.state]
    );
    expect(rotated.rows[0].state).toMatchObject({ stage: 'collecting' });
    expect(rotated.rows[0].state.id).not.toBe(contact);
    expect(
      new Date(claimed.rows[0].result.state.cartUpdatedAt as string)
    ).toEqual(before.rows[0].updated_at);
    const archived = await db.query<{ state: Record<string, unknown> }>(
      'SELECT state FROM order_draft_history'
    );
    expect(archived.rows).toEqual([{ state: claimed.rows[0].result.state }]);
    const current = await db.query<{
      processing_message_id: string;
      state: unknown;
      renewed: boolean;
    }>(
      "SELECT processing_message_id,state,updated_at>now()-interval '1 minute' AS renewed FROM order_drafts"
    );
    expect(current.rows[0]).toEqual({
      processing_message_id: 'legacy-message',
      state: rotated.rows[0].state,
      renewed: true,
    });
  });
  it.each(['missing', 'null', 'explicit'] as const)(
    'keeps a current %s cart current after claiming',
    async (timestamp) => {
      const state = {
        id: contact,
        version: 2,
        stage: 'collecting',
        ...(timestamp === 'null' ? { cartUpdatedAt: null } : {}),
        ...(timestamp === 'explicit'
          ? { cartUpdatedAt: '2099-01-01T00:00:00.000Z' }
          : {}),
      };
      await db.query(
        `INSERT INTO order_drafts(account_id,conversation_id,state,updated_at) VALUES($1,$2,$3,now()-interval '${timestamp === 'explicit' ? '25 hours' : '1 hour'}')`,
        [account, conversation, state]
      );
      const claimed = await db.query<{
        result: { state: Record<string, unknown> };
      }>('SELECT claim_order_turn($1,$2,$3,$4,$5) AS result', [
        account,
        conversation,
        contact,
        'current-message',
        'adicionar',
      ]);
      if (timestamp === 'explicit') {
        expect(claimed.rows[0].result.state).toEqual(state);
      } else {
        expect(claimed.rows[0].result.state.cartUpdatedAt).toEqual(
          expect.any(String)
        );
      }
      await expect(
        db.query('SELECT rotate_order_draft($1,$2,$3,$4,false)', [
          account,
          conversation,
          'current-message',
          claimed.rows[0].result.state,
        ])
      ).rejects.toThrow('Draft is still current');
      expect(
        (await db.query('SELECT * FROM order_draft_history')).rows
      ).toHaveLength(0);
    }
  );
  it('preserves ownership, deduplication and an ambiguous busy claim without rewriting its age', async () => {
    const state = { id: contact, version: 2, stage: 'collecting' };
    await db.query(
      "INSERT INTO order_drafts(account_id,conversation_id,state,processing_message_id,updated_at) VALUES($1,$2,$3,'ambiguous-message',now()-interval '25 hours')",
      [account, conversation, state]
    );
    const original = (await db.query('SELECT * FROM order_drafts')).rows;
    await expect(
      db.query('SELECT claim_order_turn($1,$2,$3,$4,$5)', [
        account,
        conversation,
        owner,
        'foreign-message',
        'texto',
      ])
    ).rejects.toThrow('does not belong to account');
    expect(
      (await db.query('SELECT * FROM order_inbound_events')).rows
    ).toHaveLength(0);
    const claim = () =>
      db.query<{ result: { outcome: string } }>(
        'SELECT claim_order_turn($1,$2,$3,$4,$5) AS result',
        [account, conversation, contact, 'new-message', 'texto']
      );
    expect((await claim()).rows[0].result).toEqual({ outcome: 'busy' });
    expect((await claim()).rows[0].result).toEqual({ outcome: 'duplicate' });
    expect((await db.query('SELECT * FROM order_drafts')).rows).toEqual(
      original
    );
    expect(
      (
        await db.query(
          'SELECT meta_message_id,status FROM order_inbound_events'
        )
      ).rows
    ).toEqual([{ meta_message_id: 'new-message', status: 'blocked' }]);
  });
  it('does not let a completed payment pause block a new clear order without an active human', async () => {
    const state = { id: contact, version: 2, stage: 'payment_created' };
    await db.query(
      'INSERT INTO order_drafts(account_id,conversation_id,state) VALUES($1,$2,$3)',
      [account, conversation, state]
    );
    await db.query("INSERT INTO orders VALUES($1,$2,$3,'paid')", [
      contact,
      account,
      `TEXT-${contact}-2`,
    ]);
    await decision(true, 'payment_review');
    const result = await db.query<{ result: { blocked: boolean } }>(
      'SELECT handle_conversation_handoff($1,$2,$3,false,$4,false,true) AS result',
      [account, conversation, contact, 'customer_request']
    );
    expect(result.rows[0].result.blocked).toBe(false);
  });
  it('creates one visible notification per recipient and episode, not one per message', async () => {
    const first = await decision(true);
    expect(first).toMatchObject({ blocked: true, notice: 'waiting' });
    expect((await decision()).episode_id).toBe(first.episode_id);
    const rows = (
      await db.query<{
        type: string;
        conversation_id: string;
        read_at: string | null;
      }>('SELECT * FROM notifications')
    ).rows;
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) =>
          r.type === 'human_attention_required' &&
          r.conversation_id === conversation &&
          r.read_at === null
      )
    ).toBe(true);
  });
  it('queues catalog handoffs with the same episode identity used by the outbox', async () => {
    await db.query('SELECT flow_checkout_queue($1,$2,$3)', [
      account,
      contact,
      conversation,
    ]);
    expect((await decision()).episode_id).toBe(contact);
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      2
    );
  });
  it('notifies only the assigned member when one exists', async () => {
    await db.query(
      'UPDATE conversations SET assigned_agent_id=$1 WHERE id=$2',
      [admin, conversation]
    );
    await decision(true);
    const recipients = await db.query<{ user_id: string }>(
      'SELECT user_id FROM notifications'
    );
    expect(recipients.rows).toEqual([{ user_id: admin }]);
  });
  it('notifies the team even when an existing writer only sets the disabled flag', async () => {
    await db.query(
      'UPDATE conversations SET ai_autoreply_disabled=true WHERE id=$1',
      [conversation]
    );
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      2
    );
  });
  it('offers then accepts explicit bot resumption after a human request times out', async () => {
    await decision(true);
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect(await decision()).toMatchObject({ blocked: true, notice: 'resume' });
    expect(await decision(false, 'customer_request', true)).toMatchObject({
      blocked: false,
      resumed: true,
    });
    expect(
      (await db.query('SELECT status,ai_autoreply_disabled FROM conversations'))
        .rows[0]
    ).toEqual({ status: 'open', ai_autoreply_disabled: false });
  });
  it('resumes human_active, technical_error and non-open payment_review after 30 minutes, keeping manual and open payment_review permanently blocked', async () => {
    await decision(true, 'order_review');
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect(await decision()).toMatchObject({ blocked: false, resumed: true });

    await decision(true, 'technical_error');
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect(await decision()).toMatchObject({ blocked: false, resumed: true });

    await db.query(
      "UPDATE conversations SET assigned_agent_id=$1,last_agent_message_at=now()-interval '31 minutes' WHERE id=$2",
      [admin, conversation]
    );
    await decision(true, 'human_active');
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect(await decision()).toMatchObject({ blocked: false, resumed: true });

    // payment_review with an open checkout stays permanently blocked after 30 minutes
    const openState = { id: contact, version: 2, stage: 'payment_created' };
    await db.query(
      'INSERT INTO order_drafts(account_id,conversation_id,state) VALUES($1,$2,$3)',
      [account, conversation, openState]
    );
    await db.query("INSERT INTO orders VALUES($1,$2,$3,'pending')", [
      contact,
      account,
      `TEXT-${contact}-2`,
    ]);
    await decision(true, 'payment_review');
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect((await decision(false, 'customer_request', true)).blocked).toBe(
      true
    );

    // Once payment is completed/paid, expired payment_review can resume
    await db.query("UPDATE orders SET status='paid' WHERE id=$1", [contact]);
    expect(await decision()).toMatchObject({ blocked: false, resumed: true });

    await decision(true, 'manual');
    await db.query(
      "UPDATE conversations SET bot_resume_after=now()-interval '1 minute' WHERE id=$1",
      [conversation]
    );
    expect((await decision(false, 'customer_request', true)).blocked).toBe(
      true
    );
    await db.query(
      "UPDATE conversations SET bot_pause_reason='human_active',last_agent_message_at=now() WHERE id=$1",
      [conversation]
    );
    expect((await decision(false, 'customer_request', true)).blocked).toBe(
      true
    );
  });
  it('notifies the owner on technical_error even when assigned or escalating from another pause, and stores error_detail', async () => {
    await db.query(
      'UPDATE conversations SET assigned_agent_id=$1 WHERE id=$2',
      [admin, conversation]
    );
    const first = await decision(true, 'order_review');
    const second = await decision(true, 'technical_error');
    expect(second.episode_id).not.toBe(first.episode_id);
    const notes = await db.query<{ user_id: string; title: string }>(
      "SELECT user_id, title FROM notifications WHERE title = 'Erro técnico no atendimento'"
    );
    expect(notes.rows.map((r) => r.user_id).sort()).toEqual(
      [owner, admin].sort()
    );
    await db.query(
      "INSERT INTO order_inbound_events(account_id,meta_message_id,conversation_id,raw_text,status,error_detail) VALUES($1,'err-1',$2,'2 carne','failed','menu_items missing')",
      [account, conversation]
    );
    const errRow = await db.query<{ error_detail: string }>(
      "SELECT error_detail FROM order_inbound_events WHERE meta_message_id='err-1'"
    );
    expect(errRow.rows[0].error_detail).toBe('menu_items missing');
  });
  it('rejects a foreign contact without notifications', async () => {
    await expect(
      db.query('SELECT handle_conversation_handoff($1,$2,$3,true)', [
        account,
        conversation,
        owner,
      ])
    ).rejects.toThrow('does not belong');
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      0
    );
  });
  it('archives a paid draft under the owned turn and uses a new payment identity', async () => {
    const state = {
      id: contact,
      version: 2,
      stage: 'payment_created',
      items: [],
      total: 28,
    };
    await db.query(
      'INSERT INTO order_drafts(account_id,conversation_id,state,processing_message_id) VALUES($1,$2,$3,$4)',
      [account, conversation, state, 'message']
    );
    await db.query("INSERT INTO orders VALUES($1,$2,$3,'paid')", [
      contact,
      account,
      `TEXT-${contact}-2`,
    ]);
    const rotated = await db.query<{ state: { id: string; stage: string } }>(
      'SELECT rotate_order_draft($1,$2,$3,$4,false) AS state',
      [account, conversation, 'message', state]
    );
    expect(rotated.rows[0].state.id).not.toBe(contact);
    expect(rotated.rows[0].state.stage).toBe('collecting');
    expect(
      (await db.query('SELECT * FROM order_draft_history')).rows
    ).toHaveLength(1);
  });
  it('never rotates an uncertain checkout, even for an explicit new order', async () => {
    const state = { id: contact, version: 2, stage: 'payment_created' };
    await db.query(
      "INSERT INTO order_drafts(account_id,conversation_id,state,updated_at) VALUES($1,$2,$3,now()-interval '25 hours')",
      [account, conversation, state]
    );
    await db.query("INSERT INTO order_checkouts VALUES($1,$2,'uncertain')", [
      account,
      `TEXT-${contact}-2`,
    ]);
    const claimed = await db.query<{
      result: { state: Record<string, unknown> };
    }>('SELECT claim_order_turn($1,$2,$3,$4,$5) AS result', [
      account,
      conversation,
      contact,
      'message',
      'novo pedido',
    ]);
    await expect(
      db.query('SELECT rotate_order_draft($1,$2,$3,$4,true)', [
        account,
        conversation,
        'message',
        claimed.rows[0].result.state,
      ])
    ).rejects.toThrow('reconciliation');
    expect(
      (await db.query('SELECT processing_message_id FROM order_drafts')).rows
    ).toEqual([{ processing_message_id: 'message' }]);
    expect((await db.query('SELECT status FROM order_checkouts')).rows).toEqual(
      [{ status: 'uncertain' }]
    );
  });
});
