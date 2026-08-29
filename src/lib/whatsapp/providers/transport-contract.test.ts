import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMessage = vi.fn();
const sendMediaMessage = vi.fn();
const sendReactionMessage = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', async (io) => ({
  ...(await io<Record<string, unknown>>()),
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  sendMediaMessage: (...a: unknown[]) => sendMediaMessage(...a),
  sendReactionMessage: (...a: unknown[]) => sendReactionMessage(...a),
}));

import { createMetaTransport } from './meta-transport';
import { createUazapiTransport } from './uazapi-transport';
import { UnsupportedCapabilityError } from './types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const CASES = [
  {
    name: 'meta',
    make: () =>
      createMetaTransport({
        id: 'c1',
        accountId: 'a1',
        credential: 'tok',
        provider: 'meta',
        phoneNumberId: 'pn-1',
      }),
    arm: () => {
      sendTextMessage.mockResolvedValue({ messageId: 'wamid.1' });
      sendMediaMessage.mockResolvedValue({ messageId: 'wamid.2' });
      sendReactionMessage.mockResolvedValue({ messageId: 'wamid.3' });
    },
  },
  {
    name: 'uazapi',
    make: () =>
      createUazapiTransport({
        id: 'c2',
        accountId: 'a1',
        credential: 'tok',
        provider: 'uazapi',
        instanceId: 'i-1',
        baseUrl: 'https://uaz.example',
      }),
    arm: () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ messageid: 'uaz.1' }),
      });
    },
  },
] as const;

describe.each(CASES)('contrato de transporte — $name', ({ make, arm }) => {
  beforeEach(() => {
    sendTextMessage.mockReset();
    sendMediaMessage.mockReset();
    sendReactionMessage.mockReset();
    fetchMock.mockReset();
    arm();
  });

  it('expõe provider e as 4 capacidades booleanas', () => {
    const t = make();
    expect(typeof t.provider).toBe('string');
    for (const k of [
      'templates',
      'interactive',
      'reactions',
      'media',
    ] as const) {
      expect(typeof t.capabilities[k]).toBe('boolean');
    }
  });

  it('sendText devolve { providerMessageId: string, normalizedRecipient? }', async () => {
    const r = await make().sendText({ to: '5511999998888', text: 'oi' });
    expect(typeof r.providerMessageId).toBe('string');
    expect(r.providerMessageId.length).toBeGreaterThan(0);
    expect(
      r.normalizedRecipient === undefined ||
        typeof r.normalizedRecipient === 'string'
    ).toBe(true);
  });

  it('cada método coberto por capabilities faz uma chamada e devolve id; cada não-coberto lança UnsupportedCapabilityError', async () => {
    const t = make();
    const caps = t.capabilities;

    if (caps.media) {
      const r = await t.sendMedia({
        to: '5511999998888',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
      });
      expect(typeof r.providerMessageId).toBe('string');
    }
    if (caps.reactions) {
      const r = await t.sendReaction({
        to: '5511999998888',
        targetProviderMessageId: 'm-1',
        emoji: '👍',
      });
      expect(typeof r.providerMessageId).toBe('string');
    }
    if (!caps.templates) {
      expect(() =>
        t.sendTemplate({ to: '5511999998888', templateName: 'x' })
      ).toThrow(UnsupportedCapabilityError);
    }
    if (!caps.interactive) {
      expect(() =>
        t.sendInteractive({
          to: '5511999998888',
          payload: { kind: 'buttons', body: 'b', buttons: [] } as never,
        })
      ).toThrow(UnsupportedCapabilityError);
    }
  });
});
