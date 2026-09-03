import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared hoisted state the mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  dispatchWebhookEvent: vi.fn(),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

import {
  processStatusUpdate,
  RECIPIENT_STATUS_LADDER,
  ladderLevel,
  isValidStatusTransition,
} from './process-status-update';
import type { InboundStatus } from './types';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RECIPIENT_STATUS_LADDER', () => {
  it('defines the forward progression ladder', () => {
    expect(RECIPIENT_STATUS_LADDER).toEqual([
      'pending',
      'sent',
      'delivered',
      'read',
      'replied',
    ]);
  });
});

describe('ladderLevel', () => {
  it('returns the index for ladder statuses', () => {
    expect(ladderLevel('pending')).toBe(0);
    expect(ladderLevel('sent')).toBe(1);
    expect(ladderLevel('delivered')).toBe(2);
    expect(ladderLevel('read')).toBe(3);
    expect(ladderLevel('replied')).toBe(4);
  });

  it('returns -1 for unknown statuses', () => {
    expect(ladderLevel('unknown')).toBe(-1);
    expect(ladderLevel('failed')).toBe(-1);
  });
});

describe('isValidStatusTransition', () => {
  it('allows forward moves on the ladder', () => {
    expect(isValidStatusTransition('pending', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition('delivered', 'read')).toBe(true);
    expect(isValidStatusTransition('read', 'replied')).toBe(true);
    expect(isValidStatusTransition('pending', 'delivered')).toBe(true);
  });

  it('rejects backward moves on the ladder', () => {
    expect(isValidStatusTransition('sent', 'pending')).toBe(false);
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false);
    expect(isValidStatusTransition('replied', 'read')).toBe(false);
  });

  it('allows failed only from pending or sent', () => {
    expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('read', 'failed')).toBe(false);
    expect(isValidStatusTransition('replied', 'failed')).toBe(false);
  });

  it('treats failed as terminal', () => {
    expect(isValidStatusTransition('failed', 'pending')).toBe(false);
    expect(isValidStatusTransition('failed', 'sent')).toBe(false);
    expect(isValidStatusTransition('failed', 'read')).toBe(false);
  });

  it('rejects unknown incoming statuses on the ladder', () => {
    expect(isValidStatusTransition('pending', 'unknown')).toBe(false);
    expect(isValidStatusTransition('sent', 'bogus')).toBe(false);
  });

  it('accepts ladder moves from unknown current status', () => {
    expect(isValidStatusTransition('unknown', 'sent')).toBe(true);
    expect(isValidStatusTransition('mystery', 'delivered')).toBe(true);
  });
});

describe('processStatusUpdate', () => {
  const baseStatus: InboundStatus = {
    connectionId: 'conn-1',
    accountId: 'acc-1',
    providerMessageId: 'msg-1',
    status: 'sent',
    timestamp: new Date('2026-08-30T12:00:00Z'),
  };

  it('mirrors a recognized status to the messages table', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
      },
    };

    await processStatusUpdate(db, baseStatus);

    expect(updateSpy).toHaveBeenCalledWith({ status: 'sent' });
  });

  it('skips the messages-table write for an unrecognized status value (confirmed in production: UAZAPI\'s "FileDownloaded" media-pipeline notice, not a delivery status — writing it crashed with messages_status_check)', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: updateSpy,
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
      },
    };

    await processStatusUpdate(db, { ...baseStatus, status: 'FileDownloaded' });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not throw when the timestamp is invalid — writes null instead of crashing on toISOString', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'sent' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    await expect(
      processStatusUpdate(db, {
        ...baseStatus,
        status: 'delivered',
        timestamp: new Date(NaN),
      })
    ).resolves.toBeUndefined();

    expect(updateSpy).toHaveBeenCalledWith({
      status: 'delivered',
      delivered_at: null,
    });
  });

  it('updates broadcast_recipients when valid transition exists', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        conversation_id: 'conv-1',
                        conversations: { account_id: 'acc-1' },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'pending' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'sent',
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).toHaveBeenCalledWith({
      status: 'sent',
      sent_at: '2026-08-30T12:00:00.000Z',
    });
  });

  it('skips broadcast_recipients update when transition is invalid', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'delivered' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'pending', // backward move — not allowed
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('fires webhook event when message resolves an account', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        conversation_id: 'conv-1',
                        conversations: { account_id: 'acc-1' },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
      },
    };

    await processStatusUpdate(db, baseStatus);

    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      db,
      'acc-1',
      'message.status_updated',
      {
        whatsapp_message_id: 'msg-1',
        conversation_id: 'conv-1',
        status: 'sent',
      }
    );
  });

  it('skips webhook event when message is not found', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
      },
    };

    await processStatusUpdate(db, baseStatus);

    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it('skips webhook event when account is not resolved', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        conversation_id: 'conv-1',
                        conversations: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
      },
    };

    await processStatusUpdate(db, baseStatus);

    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it('includes delivered_at timestamp for delivered status', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'sent' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'delivered',
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).toHaveBeenCalledWith({
      status: 'delivered',
      delivered_at: '2026-08-30T12:00:00.000Z',
    });
  });

  it('includes read_at timestamp for read status', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'delivered' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'read',
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).toHaveBeenCalledWith({
      status: 'read',
      read_at: '2026-08-30T12:00:00.000Z',
    });
  });

  it('handles failed status transition from pending', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'pending' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'failed',
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).toHaveBeenCalledWith({
      status: 'failed',
    });
  });

  it('rejects failed status transition from delivered', async () => {
    const updateSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      from(table: string) {
        if (table === 'messages') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'rec-1', status: 'delivered' },
                    error: null,
                  }),
              }),
            }),
            update: updateSpy.mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
      },
    };

    const status: InboundStatus = {
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'msg-1',
      status: 'failed',
      timestamp: new Date('2026-08-30T12:00:00Z'),
    };

    await processStatusUpdate(db, status);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
