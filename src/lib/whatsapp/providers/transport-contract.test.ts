import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMessage = vi.fn();
const sendMediaMessage = vi.fn();
const sendReactionMessage = vi.fn();
const sendTemplateMessage = vi.fn();
const sendInteractiveButtons = vi.fn();
const getMediaUrl = vi.fn();
const downloadMedia = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', async (io) => ({
  ...(await io<Record<string, unknown>>()),
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  sendMediaMessage: (...a: unknown[]) => sendMediaMessage(...a),
  sendReactionMessage: (...a: unknown[]) => sendReactionMessage(...a),
  sendTemplateMessage: (...a: unknown[]) => sendTemplateMessage(...a),
  sendInteractiveButtons: (...a: unknown[]) => sendInteractiveButtons(...a),
  getMediaUrl: (...a: unknown[]) => getMediaUrl(...a),
  downloadMedia: (...a: unknown[]) => downloadMedia(...a),
}));

import { createMetaTransport } from './meta-transport';
import { createUazapiTransport } from './uazapi-transport';
import { UnsupportedCapabilityError } from './types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const RECIPIENT = '5511999998888';

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
      sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.4' });
      sendInteractiveButtons.mockResolvedValue({ messageId: 'wamid.5' });
      getMediaUrl.mockResolvedValue({
        url: 'https://cdn.meta/asset',
        mimeType: 'image/jpeg',
        fileSize: 3,
      });
      downloadMedia.mockResolvedValue({
        buffer: Buffer.from([1, 2, 3]),
        contentType: 'image/jpeg',
      });
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

describe.each(CASES)(
  'contrato de transporte — $name',
  ({ name, make, arm }) => {
    beforeEach(() => {
      sendTextMessage.mockReset();
      sendMediaMessage.mockReset();
      sendReactionMessage.mockReset();
      sendTemplateMessage.mockReset();
      sendInteractiveButtons.mockReset();
      getMediaUrl.mockReset();
      downloadMedia.mockReset();
      fetchMock.mockReset();
      arm();
    });

    // The API call actually happened, for the recipient we passed — a
    // transport that silently no-ops would fail here.
    //   meta:   the per-method vi.fn() stub, invoked with a { to } object.
    //   uazapi: the global fetch stub, invoked with (url, { body }) where
    //           the JSON body carries { number }.
    function expectSent(
      metaMock: ReturnType<typeof vi.fn>,
      uazPath: string
    ): void {
      if (name === 'meta') {
        expect(metaMock).toHaveBeenCalledTimes(1);
        expect(metaMock.mock.calls[0][0]).toMatchObject({ to: RECIPIENT });
      } else {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [
          string,
          { body: string },
        ];
        expect(url.endsWith(uazPath)).toBe(true);
        expect(JSON.parse(init.body).number).toBe(RECIPIENT);
      }
    }

    it('expõe provider (== nome do caso) e as 4 capacidades booleanas', () => {
      const t = make();
      expect(t.provider).toBe(name);
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
      const r = await make().sendText({ to: RECIPIENT, text: 'oi' });
      expect(typeof r.providerMessageId).toBe('string');
      expect(r.providerMessageId.length).toBeGreaterThan(0);
      expect(
        r.normalizedRecipient === undefined ||
          typeof r.normalizedRecipient === 'string'
      ).toBe(true);
    });

    it('cada método coberto por capabilities faz uma chamada real ao provedor e devolve id; cada não-coberto lança UnsupportedCapabilityError', async () => {
      const t = make();
      const caps = t.capabilities;

      if (caps.media) {
        sendMediaMessage.mockClear();
        fetchMock.mockClear();
        const r = await t.sendMedia({
          to: RECIPIENT,
          mediaKind: 'image',
          link: 'https://x/y.jpg',
        });
        expect(typeof r.providerMessageId).toBe('string');
        expectSent(sendMediaMessage, '/send/media');
      }
      if (caps.reactions) {
        sendReactionMessage.mockClear();
        fetchMock.mockClear();
        const r = await t.sendReaction({
          to: RECIPIENT,
          targetProviderMessageId: 'm-1',
          emoji: '👍',
        });
        expect(typeof r.providerMessageId).toBe('string');
        expectSent(sendReactionMessage, '/message/react');
      }

      if (caps.templates) {
        sendTemplateMessage.mockClear();
        fetchMock.mockClear();
        const r = await t.sendTemplate({
          to: RECIPIENT,
          templateName: 'promo',
        });
        expect(typeof r.providerMessageId).toBe('string');
        expectSent(sendTemplateMessage, '/send/template');
      } else {
        expect(() =>
          t.sendTemplate({ to: RECIPIENT, templateName: 'x' })
        ).toThrow(UnsupportedCapabilityError);
      }

      if (caps.interactive) {
        sendInteractiveButtons.mockClear();
        fetchMock.mockClear();
        const r = await t.sendInteractive({
          to: RECIPIENT,
          payload: { kind: 'buttons', body: 'b', buttons: [] } as never,
        });
        expect(typeof r.providerMessageId).toBe('string');
        expectSent(sendInteractiveButtons, '/send/menu');
      } else {
        expect(() =>
          t.sendInteractive({
            to: RECIPIENT,
            payload: { kind: 'buttons', body: 'b', buttons: [] } as never,
          })
        ).toThrow(UnsupportedCapabilityError);
      }
    });

    it('fetchMedia: meta delega para getMediaUrl+downloadMedia; uazapi lança 1c-ii', async () => {
      const t = make();
      if (name === 'meta') {
        const out = await t.fetchMedia({ provider: 'meta', mediaId: 'm-1' });
        expect(getMediaUrl).toHaveBeenCalledTimes(1);
        expect(getMediaUrl.mock.calls[0][0]).toMatchObject({ mediaId: 'm-1' });
        expect(downloadMedia).toHaveBeenCalledTimes(1);
        expect(out).toMatchObject({
          bytes: expect.any(Uint8Array),
          mimeType: expect.any(String),
        });
      } else {
        // Paridade com os outros stubs UAZAPI: lança de forma síncrona.
        expect(() => t.fetchMedia({ provider: 'uazapi' } as never)).toThrow(
          /1c-ii/
        );
      }
    });
  }
);
