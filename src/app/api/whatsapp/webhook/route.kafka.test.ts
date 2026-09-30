import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  after: vi.fn(),
  publish: vi.fn(),
  process: vi.fn(),
}));

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: h.after };
});
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}));
vi.mock('@/lib/kafka/producers', () => ({ publishWebhookEvent: h.publish }));
vi.mock('@/lib/whatsapp/webhook-processor', () => ({
  processWebhook: h.process,
  webhookAdmin: () => ({}),
}));

import { POST } from './route';

const req = () =>
  new Request('http://x/api/whatsapp/webhook', {
    method: 'POST',
    body: JSON.stringify({ entry: [{ id: 'waba', changes: [] }] }),
    headers: { 'x-hub-signature-256': 'sha256=ok' },
  });

beforeEach(() => {
  h.after.mockReset();
  h.publish.mockReset();
});

describe('webhook POST with Kafka', () => {
  it('queues on the topic and acks without processing in-process', async () => {
    h.publish.mockResolvedValue(true);
    const res = await POST(req());
    expect(await res.json()).toEqual({ status: 'queued' });
    expect(h.publish).toHaveBeenCalledWith({
      entry: [{ id: 'waba', changes: [] }],
    });
    expect(h.after).not.toHaveBeenCalled();
  });

  it('falls back to in-process handling when the publish fails', async () => {
    h.publish.mockResolvedValue(false);
    const res = await POST(req());
    expect(await res.json()).toEqual({ status: 'received' });
    expect(h.after).toHaveBeenCalledTimes(1);
  });
});
