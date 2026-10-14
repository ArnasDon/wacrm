import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '@/lib/db/test-database';
import {
  withIdentity,
  resolveAccount,
  type LocalAccountContext,
} from '@/lib/db/context-core';
import { transaction, type SqlConnection } from '@/lib/db/transaction';
const h = vi.hoisted(() => ({
  db: null as PGlite | null,
  ctx: null as LocalAccountContext | null,
  after: [] as (() => Promise<void>)[],
  signature: true,
  flows: vi.fn(),
  automations: vi.fn(),
  ai: vi.fn(),
  webhooks: vi.fn(),
  media: vi.fn(),
  mirror: vi.fn(),
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (work: () => Promise<void>) => h.after.push(work),
}));
vi.mock('@/lib/db/pool', () => ({
  getPool: () => h.db,
  withTransaction: (work: (db: SqlConnection) => Promise<unknown>) =>
    transaction(h.db!, work),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => h.signature,
}));
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: h.flows }));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.automations,
}));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.ai }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.webhooks }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: h.media }));
vi.mock('@/lib/whatsapp/mirror-inbound-local', () => ({
  mirrorInboundLocal: h.mirror,
}));
import { POST, GET } from './route';
const user = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  h.db = await createTestDatabase();
  await h.db.query(
    "INSERT INTO identity.users(id,name,email) VALUES($1,'Owner','webhookroute@test.local')",
    [user]
  );
  h.ctx = await withIdentity(h.db, user, (sql) => resolveAccount(sql, user));
  await h.db.query(
    'INSERT INTO public.whatsapp_config(account_id,user_id,phone_number_id,access_token,waba_id,verify_token) VALUES($1,$2,$3,$4,$5,$6)',
    [h.ctx.accountId, user, 'phone-1', 'token', 'waba-1', 'verify']
  );
}, 30000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(async () => {
  await h.db!.query('DELETE FROM public.broadcasts');
  await h.db!.query('DELETE FROM public.contacts');
  await h.db!.query('DELETE FROM public.message_templates');
  await h.db!.query(
    'UPDATE public.whatsapp_config SET mirror_inbound_media=true'
  );
  h.after = [];
  h.signature = true;
  h.flows.mockReset().mockResolvedValue({ consumed: false });
  h.automations.mockReset().mockResolvedValue(undefined);
  h.ai.mockReset().mockResolvedValue(undefined);
  h.webhooks.mockReset().mockResolvedValue(undefined);
  h.media
    .mockReset()
    .mockResolvedValue({
      url: 'https://meta.test/media',
      mimeType: 'image/jpeg',
      fileSize: 50,
    });
  h.mirror.mockReset().mockResolvedValue('/media/chat-media/local/image.jpg');
});
function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wamid.in',
    from: '15551234567',
    timestamp: '1700000000',
    type: 'text',
    text: { body: 'Order status' },
    ...overrides,
  };
}
function envelope(
  messages: unknown[],
  contacts: unknown[] | undefined = [
    { wa_id: '15551234567', profile: { name: 'Customer' } },
  ]
) {
  return {
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'phone-1' },
              contacts,
              messages,
            },
          },
        ],
      },
    ],
  };
}
async function deliver(body: unknown) {
  const response = await POST(
    new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  expect(response.status).toBe(200);
  const callbacks = h.after.splice(0);
  for (const callback of callbacks) await callback();
}
async function messages() {
  return (
    await h.db!.query<Record<string, unknown>>(
      'SELECT * FROM public.messages ORDER BY created_at,id'
    )
  ).rows;
}
async function contacts() {
  return (
    await h.db!.query<Record<string, unknown>>('SELECT * FROM public.contacts')
  ).rows;
}
it('rejects an invalid signature before scheduling work', async () => {
  h.signature = false;
  const response = await POST(
    new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      body: '{}',
    })
  );
  expect(response.status).toBe(401);
  expect(h.after).toHaveLength(0);
});
it('verifies the locally stored callback token', async () => {
  expect(
    (
      await GET(
        new Request(
          'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=verify'
        )
      )
    ).status
  ).toBe(200);
  expect(
    (
      await GET(
        new Request(
          'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=wrong'
        )
      )
    ).status
  ).toBe(403);
});
it('acknowledges before persistence, then awaits all downstream work', async () => {
  let completed = false;
  h.automations.mockImplementation(async () => {
    await Promise.resolve();
    completed = true;
  });
  const response = await POST(
    new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      body: JSON.stringify(envelope([message()])),
    })
  );
  expect(response.status).toBe(200);
  expect(await messages()).toHaveLength(0);
  await h.after[0]();
  expect(completed).toBe(true);
  expect(await messages()).toHaveLength(1);
  expect(h.ai).toHaveBeenCalledOnce();
});
it('stores once, atomically increments unread, and suppresses replay fan-out', async () => {
  await deliver(envelope([message()]));
  const count = h.automations.mock.calls.length;
  await deliver(envelope([message()]));
  expect(await messages()).toHaveLength(1);
  expect(
    (
      await h.db!.query<{ unread_count: number }>(
        'SELECT unread_count FROM public.conversations'
      )
    ).rows[0].unread_count
  ).toBe(1);
  expect(h.automations).toHaveBeenCalledTimes(count);
  expect(h.flows).toHaveBeenCalledOnce();
});
it('lets a consuming flow suppress per-message automations and AI', async () => {
  h.flows.mockResolvedValue({ consumed: true });
  await deliver(envelope([message()]));
  expect(h.automations.mock.calls.map((c) => c[0].triggerType)).toEqual([
    'first_inbound_message',
    'new_contact_created',
  ]);
  expect(h.ai).not.toHaveBeenCalled();
});
for (const [payload, label] of [
  ['status', 'Order status'],
  [undefined, 'Order status'],
] as const) {
  it(
    'stores and dispatches template quick reply ' + String(payload),
    async () => {
      await deliver(
        envelope([
          message({
            type: 'button',
            text: undefined,
            button: { text: label, payload },
          }),
        ])
      );
      expect((await messages())[0]).toMatchObject({
        content_type: 'interactive',
        content_text: label,
        interactive_reply_id: payload ?? label,
      });
      expect(h.flows.mock.calls[0][0].message).toMatchObject({
        kind: 'interactive_reply',
        reply_id: payload ?? label,
      });
      expect(
        h.automations.mock.calls.some(
          (c) => c[0].triggerType === 'interactive_reply'
        )
      ).toBe(true);
      expect(h.ai).not.toHaveBeenCalled();
    }
  );
}
for (const kind of ['image', 'video', 'audio', 'document', 'sticker'])
  it('mirrors inbound ' + kind + ' through local storage', async () => {
    await deliver(
      envelope([
        message({
          type: kind,
          text: undefined,
          [kind]: {
            id: 'media-1',
            mime_type: 'image/jpeg',
            filename: 'order.pdf',
            caption: 'Caption',
          },
        }),
      ])
    );
    expect((await messages())[0].media_url).toBe(
      '/media/chat-media/local/image.jpg'
    );
    expect(h.mirror).toHaveBeenCalledOnce();
  });
it('falls back to the authenticated proxy if mirroring is unavailable', async () => {
  h.mirror.mockResolvedValue(null);
  await deliver(
    envelope([
      message({
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' },
      }),
    ])
  );
  expect((await messages())[0].media_url).toBe('/api/whatsapp/media/media-1');
});
it('keeps the message if Meta media lookup fails', async () => {
  h.media.mockRejectedValue(new Error('Unavailable'));
  await deliver(
    envelope([
      message({
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' },
      }),
    ])
  );
  expect(await messages()).toHaveLength(1);
});
it('respects the account media mirror opt-out', async () => {
  await h.db!.query(
    'UPDATE public.whatsapp_config SET mirror_inbound_media=false'
  );
  await deliver(
    envelope([
      message({
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' },
      }),
    ])
  );
  expect(h.mirror).not.toHaveBeenCalled();
  expect((await messages())[0].media_url).toBe('/api/whatsapp/media/media-1');
});
it('does not mirror text', async () => {
  await deliver(envelope([message()]));
  expect(h.media).not.toHaveBeenCalled();
  expect(h.mirror).not.toHaveBeenCalled();
});
it('passes document filenames to the local mirror', async () => {
  await deliver(
    envelope([
      message({
        type: 'document',
        document: {
          id: 'media-1',
          mime_type: 'application/pdf',
          filename: 'invoice.pdf',
        },
      }),
    ])
  );
  expect(h.mirror.mock.calls[0][0].fileName).toBe('invoice.pdf');
});
it('resolves a username-only sender to one BSUID contact across messages', async () => {
  const metaContact = {
    user_id: 'US.123456789',
    profile: { username: 'customer' },
  };
  await deliver(
    envelope(
      [message({ from: undefined, from_user_id: 'US.123456789' })],
      [metaContact]
    )
  );
  await deliver(
    envelope(
      [
        message({
          id: 'wamid.second',
          from: undefined,
          from_user_id: 'US.123456789',
        }),
      ],
      [metaContact]
    )
  );
  expect(await contacts()).toHaveLength(1);
  expect((await contacts())[0]).toMatchObject({
    phone: '',
    wa_user_id: 'US.123456789',
    wa_username: 'customer',
  });
  expect(await messages()).toHaveLength(2);
});
it('accepts BSUID-only messages without a contacts array', async () => {
  await deliver(
    envelope([message({ from: undefined, from_user_id: 'US.123456789' })], [])
  );
  expect((await contacts())[0].wa_user_id).toBe('US.123456789');
});
it('backfills a disclosed phone onto the BSUID contact', async () => {
  await deliver(
    envelope(
      [message({ from: undefined, from_user_id: 'US.123456789' })],
      [{ user_id: 'US.123456789', profile: { username: 'customer' } }]
    )
  );
  await deliver(
    envelope(
      [message({ id: 'wamid.second', from_user_id: 'US.123456789' })],
      [
        {
          user_id: 'US.123456789',
          wa_id: '15551234567',
          profile: { name: 'Customer' },
        },
      ]
    )
  );
  expect(await contacts()).toHaveLength(1);
  expect((await contacts())[0].phone).toBe('15551234567');
});
it('backfills a BSUID onto a known phone contact', async () => {
  await deliver(envelope([message()]));
  await deliver(
    envelope(
      [message({ id: 'wamid.second', from_user_id: 'US.123456789' })],
      [
        {
          user_id: 'US.123456789',
          wa_id: '15551234567',
          profile: { name: 'Customer' },
        },
      ]
    )
  );
  expect(await contacts()).toHaveLength(1);
  expect((await contacts())[0].wa_user_id).toBe('US.123456789');
});
it('drops messages with no usable sender identity', async () => {
  await deliver(envelope([message({ from: undefined })], []));
  expect(await contacts()).toHaveLength(0);
  expect(await messages()).toHaveLength(0);
});
it('preserves an edited name when no profile name is supplied', async () => {
  await deliver(envelope([message()]));
  await h.db!.query("UPDATE public.contacts SET name='Edited name'");
  await deliver(
    envelope(
      [message({ id: 'wamid.second' })],
      [{ wa_id: '15551234567', profile: {} }]
    )
  );
  expect((await contacts())[0].name).toBe('Edited name');
});
it('threads the WABA into native template lifecycle persistence', async () => {
  await deliver({
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'message_template_status_update',
            value: {
              message_template_id: 'meta-template',
              message_template_name: 'order',
              message_template_language: 'en',
              event: 'APPROVED',
            },
          },
        ],
      },
    ],
  });
  expect(
    (
      await h.db!.query<{ account_id: string; status: string }>(
        'SELECT account_id,status FROM public.message_templates'
      )
    ).rows[0]
  ).toMatchObject({ account_id: h.ctx!.accountId, status: 'APPROVED' });
});
async function outbound() {
  await deliver(envelope([message()]));
  const conv = (
    await h.db!.query<{ id: string }>('SELECT id FROM public.conversations')
  ).rows[0].id;
  await h.db!.query(
    "INSERT INTO public.messages(conversation_id,sender_type,content_type,content_text,message_id,status) VALUES($1,'agent','text','Reply','wamid.out','sent')",
    [conv]
  );
  return conv;
}
async function status(value: Record<string, unknown>) {
  await deliver({
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'phone-1' },
              statuses: [
                {
                  id: 'wamid.out',
                  timestamp: '1700000001',
                  recipient_id: '15551234567',
                  ...value,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}
it('persists Meta failure code, title and details with the status', async () => {
  await outbound();
  await status({
    status: 'failed',
    errors: [
      {
        code: 131049,
        title: 'Not delivered',
        error_data: { details: 'Provider reason' },
      },
    ],
  });
  expect(
    (await messages()).find((m) => m.message_id === 'wamid.out')
  ).toMatchObject({
    status: 'failed',
    error_code: 131049,
    error_title: 'Not delivered',
    error_details: 'Provider reason',
  });
});
it('accepts failed status without an errors array', async () => {
  await outbound();
  await status({ status: 'failed' });
  expect(
    (await messages()).find((m) => m.message_id === 'wamid.out')
  ).toMatchObject({ status: 'failed', error_code: null });
});
it('updates delivery forward and ignores later stale sent notifications', async () => {
  await outbound();
  await status({ status: 'delivered' });
  await status({ status: 'sent' });
  expect(
    (await messages()).find((m) => m.message_id === 'wamid.out')
  ).toMatchObject({ status: 'delivered', error_code: null });
});
it('does not apply statuses for an unconfigured receiving number', async () => {
  await outbound();
  await deliver({
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'foreign' },
              statuses: [
                { id: 'wamid.out', status: 'failed', timestamp: '1700000001' },
              ],
            },
          },
        ],
      },
    ],
  });
  expect(
    (await messages()).find((m) => m.message_id === 'wamid.out')?.status
  ).toBe('sent');
});
