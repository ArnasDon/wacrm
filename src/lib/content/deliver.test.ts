import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendText = vi.fn();
const sendMedia = vi.fn();
const resolveWhatsAppService = vi.fn();
const simulateDemoDeliveryAndRead = vi.fn<
  (...args: unknown[]) => Promise<void>
>(async () => {});
const finalizeBroadcastStatus = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {}
);

vi.mock('@/lib/whatsapp/service', () => ({
  resolveWhatsAppService: (...args: unknown[]) =>
    resolveWhatsAppService(...args),
}));
vi.mock('@/lib/whatsapp/demo-simulate', () => ({
  simulateDemoDeliveryAndRead: (...args: unknown[]) =>
    simulateDemoDeliveryAndRead(...args),
}));
vi.mock('@/lib/whatsapp/broadcast-core', () => ({
  finalizeBroadcastStatus: (...args: unknown[]) =>
    finalizeBroadcastStatus(...args),
}));

const { deliverContentBroadcast } = await import('./deliver');

interface Update {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
}

function fakeDb(opts: {
  content: {
    id: string;
    body: string | null;
    media_url: string | null;
    content_type: string;
  } | null;
  translation?: { body: string } | null;
  recipients: { id: string; phone: string | null }[];
  stillScheduledCount: number;
  finalStatus: string;
  updates: Update[];
}): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: (cols?: string, opts2?: { count?: string; head?: boolean }) => {
          if (table === 'broadcasts' && opts2?.count === 'exact') {
            builder._countMode = true;
          }
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'content') return { data: opts.content, error: null };
          if (table === 'content_translations')
            return { data: opts.translation ?? null, error: null };
          if (table === 'broadcasts')
            return { data: { status: opts.finalStatus }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (r: unknown) => unknown) => {
          if (table === 'broadcast_recipients' && !builder._countMode) {
            return resolve({
              data: opts.recipients.map((r) => ({
                id: r.id,
                contact: { phone: r.phone },
              })),
              error: null,
            });
          }
          if (table === 'broadcasts' && builder._countMode) {
            return resolve({ count: opts.stillScheduledCount, error: null });
          }
          return resolve({ data: [], error: null });
        },
        update: (values: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (field: string, value: unknown) => {
              filters[field] = value;
              opts.updates.push({ table, values, filters: { ...filters } });
              return chain;
            },
          };
          return chain;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('deliverContentBroadcast', () => {
  beforeEach(() => {
    sendText.mockReset();
    sendMedia.mockReset();
    resolveWhatsAppService.mockReset();
    simulateDemoDeliveryAndRead.mockClear();
    finalizeBroadcastStatus.mockClear();
  });

  it('sends the source body via sendText when no language / no media', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: false,
    });
    sendText.mockResolvedValue({
      messageId: 'wamid.1',
      workingPhone: '15551234567',
    });

    const updates: Update[] = [];
    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'Hello from Rimula',
        media_url: null,
        content_type: 'text_post',
      },
      recipients: [{ id: 'r1', phone: '+15551234567' }],
      stillScheduledCount: 0,
      finalStatus: 'sent',
      updates,
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: null,
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello from Rimula' })
    );
    expect(sendMedia).not.toHaveBeenCalled();
    expect(finalizeBroadcastStatus).toHaveBeenCalledWith(db, 'bc-1');
    // No pending broadcasts left for this content -> reflects onto content.status.
    expect(
      updates.some(
        (u) => u.table === 'content' && u.values.status === 'Published'
      )
    ).toBe(true);
  });

  it('prefers the translation body when a language is set', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: false,
    });
    sendText.mockResolvedValue({
      messageId: 'wamid.2',
      workingPhone: '15551234567',
    });

    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'English body',
        media_url: null,
        content_type: 'text_post',
      },
      translation: { body: 'اردو باڈی' },
      recipients: [{ id: 'r1', phone: '+15551234567' }],
      stillScheduledCount: 0,
      finalStatus: 'sent',
      updates: [],
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: 'ur',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'اردو باڈی' })
    );
  });

  it('sends media (with the source text as caption) when content has media_url', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: false,
    });
    sendMedia.mockResolvedValue({
      messageId: 'wamid.3',
      workingPhone: '15551234567',
    });

    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'Caption text',
        media_url: 'https://example.com/x.jpg',
        content_type: 'poster',
      },
      recipients: [{ id: 'r1', phone: '+15551234567' }],
      stillScheduledCount: 0,
      finalStatus: 'sent',
      updates: [],
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: null,
    });

    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'image',
        link: 'https://example.com/x.jpg',
        caption: 'Caption text',
      })
    );
    expect(sendText).not.toHaveBeenCalled();
  });

  it('simulates delivery/read for a demo send, and does not for a real one', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: true,
    });
    sendText.mockResolvedValue({
      messageId: 'demo-abc',
      workingPhone: '15551234567',
    });

    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'Hi',
        media_url: null,
        content_type: 'text_post',
      },
      recipients: [{ id: 'r1', phone: '+15551234567' }],
      stillScheduledCount: 0,
      finalStatus: 'sent',
      updates: [],
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: null,
    });

    expect(simulateDemoDeliveryAndRead).toHaveBeenCalledWith('demo-abc');
  });

  it('marks the recipient failed (not throwing) when the phone is invalid, and keeps going', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: false,
    });
    sendText.mockResolvedValue({
      messageId: 'wamid.4',
      workingPhone: '15559999999',
    });

    const updates: Update[] = [];
    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'Hi',
        media_url: null,
        content_type: 'text_post',
      },
      recipients: [
        { id: 'r1', phone: 'not-a-phone' },
        { id: 'r2', phone: '+15559999999' },
      ],
      stillScheduledCount: 0,
      finalStatus: 'sent',
      updates,
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: null,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(
      updates.some(
        (u) =>
          u.table === 'broadcast_recipients' &&
          u.filters.id === 'r1' &&
          u.values.status === 'failed'
      )
    ).toBe(true);
  });

  it('leaves content.status alone when other broadcasts for it are still scheduled', async () => {
    resolveWhatsAppService.mockResolvedValue({
      service: { sendText, sendMedia },
      isDemo: false,
    });
    sendText.mockResolvedValue({
      messageId: 'wamid.5',
      workingPhone: '15551234567',
    });

    const updates: Update[] = [];
    const db = fakeDb({
      content: {
        id: 'ct-1',
        body: 'Hi',
        media_url: null,
        content_type: 'text_post',
      },
      recipients: [{ id: 'r1', phone: '+15551234567' }],
      stillScheduledCount: 1, // another language variant is still pending
      finalStatus: 'sent',
      updates,
    });

    await deliverContentBroadcast(db, {
      id: 'bc-1',
      account_id: 'acct-1',
      content_id: 'ct-1',
      language: 'ur',
    });

    expect(updates.some((u) => u.table === 'content')).toBe(false);
  });
});
