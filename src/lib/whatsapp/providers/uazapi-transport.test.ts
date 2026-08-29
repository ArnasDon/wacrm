import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUazapiTransport } from './uazapi-transport';
import { UnsupportedCapabilityError, type TransportConnection } from './types';

const conn: Extract<TransportConnection, { provider: 'uazapi' }> = {
  id: 'cfg-2',
  accountId: 'acct-1',
  provider: 'uazapi',
  credential: 'tok',
  instanceId: 'i-1',
  baseUrl: 'https://uazapi.example',
};

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

/** Resposta 200 com o corpo `allOf: [Message, { response }]` da UAZAPI. */
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createUazapiTransport', () => {
  it('declara as capacidades da UAZAPI (sem templates nem interativo)', () => {
    const t = createUazapiTransport(conn);
    expect(t.provider).toBe('uazapi');
    expect(t.capabilities).toEqual({
      templates: false,
      media: true,
      reactions: true,
      interactive: false,
    });
  });

  it('sendText faz POST em /send/text com header token e devolve o messageid', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        id: 'r1a2b3c',
        messageid: 'uaz-msg-1',
        response: { status: 'success' },
      })
    );

    const result = await createUazapiTransport(conn).sendText({
      to: '5511999998888',
      text: 'oi',
    });

    expect(result).toEqual({ providerMessageId: 'uaz-msg-1' });
    expect(result.normalizedRecipient).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://uazapi.example/send/text');
    expect(init.method).toBe('POST');
    expect(init.headers.token).toBe('tok');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      number: '5511999998888',
      text: 'oi',
    });
  });

  it('sendText com replyToProviderMessageId inclui replyid no body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ messageid: 'uaz-msg-2' }));

    await createUazapiTransport(conn).sendText({
      to: '5511999998888',
      text: 'resposta',
      replyToProviderMessageId: '3EB0TARGET',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      number: '5511999998888',
      text: 'resposta',
      replyid: '3EB0TARGET',
    });
  });

  it('sendMedia faz POST em /send/media com type/file/text/docName', async () => {
    fetchMock.mockResolvedValueOnce(ok({ messageid: 'uaz-media-1' }));

    const result = await createUazapiTransport(conn).sendMedia({
      to: '5511999998888',
      mediaKind: 'image',
      link: 'https://x/y.jpg',
      caption: 'c',
      filename: 'y.jpg',
    });

    expect(result).toEqual({ providerMessageId: 'uaz-media-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://uazapi.example/send/media');
    expect(JSON.parse(init.body)).toEqual({
      number: '5511999998888',
      type: 'image',
      file: 'https://x/y.jpg',
      text: 'c',
      docName: 'y.jpg',
    });
  });

  it('sendReaction faz POST em /message/react com { number, text, id }', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        success: true,
        message: 'Reaction sent',
        reaction: { id: '3EB0RE', emoji: '👍' },
      })
    );

    const result = await createUazapiTransport(conn).sendReaction({
      to: '5511999998888',
      targetProviderMessageId: 'm-1',
      emoji: '👍',
    });

    expect(result).toEqual({ providerMessageId: '3EB0RE' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://uazapi.example/message/react');
    expect(JSON.parse(init.body)).toEqual({
      number: '5511999998888',
      text: '👍',
      id: 'm-1',
    });
  });

  it('propaga o erro da API (não-2xx) com a mensagem do campo error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Missing number' }),
    });

    await expect(
      createUazapiTransport(conn).sendText({ to: '5511999998888', text: 'oi' })
    ).rejects.toThrow('Missing number');
  });

  it('sendTemplate lança UnsupportedCapabilityError (templates)', () => {
    try {
      createUazapiTransport(conn).sendTemplate({
        to: '5511999998888',
        templateName: 'promo',
      });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedCapabilityError);
      expect((err as UnsupportedCapabilityError).provider).toBe('uazapi');
      expect((err as UnsupportedCapabilityError).capability).toBe('templates');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendInteractive lança UnsupportedCapabilityError (interactive)', () => {
    try {
      createUazapiTransport(conn).sendInteractive({
        to: '5511999998888',
        payload: {
          kind: 'buttons',
          body: 'escolha',
          buttons: [{ id: 'b1', title: 'Sim' }],
        },
      });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedCapabilityError);
      expect((err as UnsupportedCapabilityError).provider).toBe('uazapi');
      expect((err as UnsupportedCapabilityError).capability).toBe(
        'interactive'
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
