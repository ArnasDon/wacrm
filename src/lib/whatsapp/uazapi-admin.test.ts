import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstance,
  configureWebhook,
  connectInstance,
  instanceStatus,
  disconnectInstance,
  deleteInstance,
} from './uazapi-admin';

const BASE = 'https://api.uazapi.com';
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('createInstance', () => {
  it('POSTa /instance/create com header admintoken e devolve token + instanceId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ token: 'inst-tok', instance: { id: 'inst-id' } })
    );
    const out = await createInstance(BASE, 'admin-tok', 'wacrm-acct-1');
    expect(out).toEqual({ token: 'inst-tok', instanceId: 'inst-id' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/instance/create');
    expect(init.method).toBe('POST');
    expect(init.headers.admintoken).toBe('admin-tok');
    expect(init.headers.token).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ name: 'wacrm-acct-1' });
  });

  it('lança com a mensagem do corpo quando não-ok', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'quota exceeded' }, false, 429)
    );
    await expect(createInstance(BASE, 'admin-tok', 'x')).rejects.toThrow(
      'quota exceeded'
    );
  });

  it('lança quando resposta 200 falta token ou instance.id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ instance: {} })); // missing id
    await expect(createInstance(BASE, 'admin-tok', 'x')).rejects.toThrow(
      'missing token or instance id'
    );
  });

  it('lança com fallback error quando corpo vazio (sem error/message)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500)); // empty body, not ok
    await expect(createInstance(BASE, 'admin-tok', 'x')).rejects.toThrow(
      /UAZAPI \/instance\/create failed \(500\)/
    );
  });
});

describe('configureWebhook', () => {
  it('POSTa /webhook com header token e o payload de modo simples', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await configureWebhook(
      BASE,
      'inst-tok',
      'https://crm.example.com/api/whatsapp/webhook/uazapi/sek'
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/webhook');
    expect(init.method).toBe('POST');
    expect(init.headers.token).toBe('inst-tok');
    expect(JSON.parse(init.body)).toEqual({
      enabled: true,
      url: 'https://crm.example.com/api/whatsapp/webhook/uazapi/sek',
      events: ['messages', 'messages_update', 'connection'],
      excludeMessages: ['isGroupYes', 'wasSentByApi'],
    });
  });
});

describe('connectInstance', () => {
  it('devolve qrcode e paircode do sub-objeto instance', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        instance: {
          qrcode: 'data:image/png;base64,AAA',
          paircode: '1234-5678',
        },
      })
    );
    const out = await connectInstance(BASE, 'inst-tok');
    expect(out).toEqual({
      qrcode: 'data:image/png;base64,AAA',
      paircode: '1234-5678',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/instance/connect');
    expect(init.method).toBe('POST');
    expect(init.headers.token).toBe('inst-tok');
  });

  it('devolve nulls quando o corpo não traz qr', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ instance: {} }));
    expect(await connectInstance(BASE, 'inst-tok')).toEqual({
      qrcode: null,
      paircode: null,
    });
  });
});

describe('instanceStatus', () => {
  it('achata instance + status; jid objeto vira phone', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        instance: {
          qrcode: null,
          profileName: 'Loja ABC',
          status: 'connected',
        },
        status: {
          connected: true,
          loggedIn: true,
          jid: { user: '5511999998888' },
        },
      })
    );
    const out = await instanceStatus(BASE, 'inst-tok');
    expect(out).toEqual({
      connected: true,
      loggedIn: true,
      phone: '5511999998888',
      profileName: 'Loja ABC',
      instanceStatus: 'connected',
      qrcode: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/instance/status');
    expect(init.method).toBe('GET');
  });

  it('jid null vira phone null; repassa qrcode fresco', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        instance: {
          qrcode: 'data:image/png;base64,BBB',
          profileName: null,
          status: 'connecting',
        },
        status: { connected: false, loggedIn: false, jid: null },
      })
    );
    const out = await instanceStatus(BASE, 'inst-tok');
    expect(out.phone).toBeNull();
    expect(out.qrcode).toBe('data:image/png;base64,BBB');
    expect(out.instanceStatus).toBe('connecting');
  });
});

describe('disconnectInstance / deleteInstance', () => {
  it('disconnect POSTa /instance/disconnect com token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ response: 'Disconnected' }));
    await disconnectInstance(BASE, 'inst-tok');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.uazapi.com/instance/disconnect'
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('delete usa método DELETE em /instance com token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ response: 'Instance Deleted' }));
    await deleteInstance(BASE, 'inst-tok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.uazapi.com/instance');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].headers.token).toBe('inst-tok');
  });

  it('delete lança quando não-ok', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'not found' }, false, 404)
    );
    await expect(deleteInstance(BASE, 'inst-tok')).rejects.toThrow('not found');
  });
});
