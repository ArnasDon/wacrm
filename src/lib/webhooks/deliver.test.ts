import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Control the SSRF guard per-test.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import {
  CABECALHO_ASSINATURA,
  CABECALHO_ENDPOINT,
  CABECALHO_EVENTO,
  DELIVERY_TIMEOUT_MS,
  dispatchWebhookEvent,
  MAX_CONSECUTIVE_FAILURES,
  pedidoDeEntrega,
} from './deliver';
import type { MessageReceivedData } from './dados-dos-eventos';
import { exemploDoEvento } from './exemplos';
import { verifySignatureHeader } from './sign';
import { isDeliverableUrl } from './ssrf';

// Um `data` que o contrato aceita. Antes do contrato tipado (dados-dos-eventos)
// estes testes mandavam `{ x: 1 }` e `{}` — hoje isso não compila, que é o
// ponto: um ponto de disparo com outra forma também não compilaria.
const MENSAGEM: MessageReceivedData = exemploDoEvento('message.received');

interface Row {
  id: string;
  url: string;
  secret: string;
}
interface Calls {
  updates: { id: string; payload: Record<string, unknown> }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

function makeDb(rows: Row[], calls: Calls) {
  const from = () => {
    let mode: 'select' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    let id: string | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: string) => {
        if (col === 'id') id = val;
        return b;
      },
      update: (p: Record<string, unknown>) => {
        mode = 'update';
        payload = p;
        return b;
      },
      contains: () => Promise.resolve({ data: rows, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (mode === 'update' && id) calls.updates.push({ id, payload });
        return resolve({ data: null, error: null });
      },
    };
    return b;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.rpcs.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const emptyCalls = (): Calls => ({ updates: [], rpcs: [] });

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('dispatchWebhookEvent', () => {
  it('signs + POSTs (no redirect follow) and resets failure_count on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], calls),
      'acct-1',
      'message.received',
      MENSAGEM
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://a.test/hook');
    expect(opts.redirect).toBe('manual');
    expect(opts.headers['X-Wacrm-Event']).toBe('message.received');
    expect(opts.headers['X-Wacrm-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Payload carries a dedupe id.
    expect(JSON.parse(opts.body).id).toMatch(/[0-9a-f-]{36}/);
    expect(calls.updates[0]).toMatchObject({ id: 'a', payload: { failure_count: 0 } });
    expect(calls.rpcs).toHaveLength(0);
  });

  it('records an atomic failure (RPC) when the endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'b', url: 'https://b.test/hook', secret: 's2' }], calls),
      'acct-1',
      'message.received',
      MENSAGEM
    );

    expect(calls.rpcs[0]).toEqual({
      name: 'record_webhook_failure',
      args: { endpoint_id: 'b', max_failures: MAX_CONSECUTIVE_FAILURES },
    });
    expect(calls.updates).toHaveLength(0);
  });

  it('blocks a non-public target (SSRF guard) without fetching', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'c', url: 'https://127.0.0.1/hook', secret: 's3' }], calls),
      'acct-1',
      'message.received',
      MENSAGEM
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.rpcs[0].name).toBe('record_webhook_failure');
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();
    await dispatchWebhookEvent(makeDb([], calls), 'acct-1', 'message.received', MENSAGEM);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });
});

describe('o envelope', () => {
  it('sem opcoes: id sorteado por chamada, hora de agora e o data intacto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const db = makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], emptyCalls());

    const antes = Date.now();
    await dispatchWebhookEvent(db, 'acct-1', 'message.received', MENSAGEM);
    await dispatchWebhookEvent(db, 'acct-1', 'message.received', MENSAGEM);

    const [um, dois] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    // ⚠️ Id NOVO a cada chamada: é por isso que a doc manda deduplicar pelo
    // id do fato dentro do `data`, nunca pelo do envelope.
    expect(um.id).not.toBe(dois.id);
    expect(um).toMatchObject({ event: 'message.received', account_id: 'acct-1', data: MENSAGEM });
    expect(Date.parse(um.occurred_at)).toBeGreaterThanOrEqual(antes - 1000);
    // Entrega real nunca leva a marca de teste.
    expect('test' in um).toBe(false);
  });

  it('com opcoes (eventos de negócio): id e hora do FATO, não da entrega', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const db = makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], emptyCalls());
    const data = exemploDoEvento('deal.stage_changed');

    await dispatchWebhookEvent(db, 'acct-1', 'deal.stage_changed', data, {
      id: 'linha-da-fila-1',
      occurredAt: '2026-09-23T10:00:00.000Z',
    });

    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.id).toBe('linha-da-fila-1');
    expect(corpo.occurred_at).toBe('2026-09-23T10:00:00.000Z');
    expect(corpo.data).toEqual(data);
  });

  it('a assinatura confere sobre os bytes EXATOS do corpo, com o segredo decifrado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await dispatchWebhookEvent(
      makeDb([{ id: 'ep-9', url: 'https://a.test/hook', secret: 'segredo-9' }], emptyCalls()),
      'acct-1',
      'message.received',
      MENSAGEM
    );
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers[CABECALHO_ENDPOINT]).toBe('ep-9');
    expect(opts.headers[CABECALHO_EVENTO]).toBe('message.received');
    expect(
      verifySignatureHeader(
        opts.headers[CABECALHO_ASSINATURA],
        opts.body,
        'segredo-9',
        Math.floor(Date.now() / 1000)
      )
    ).toBe(true);
  });
});

describe('pedidoDeEntrega — o pedido que a entrega e o "Enviar teste" compartilham', () => {
  it('POST assinado, sem seguir redirecionamento e com prazo', () => {
    const pedido = pedidoDeEntrega({
      endpointId: 'ep-1',
      evento: 'deal.created',
      corpo: '{"a":1}',
      segredo: 'sss',
      tsSegundos: 1_700_000_000,
    });
    expect(pedido.method).toBe('POST');
    expect(pedido.body).toBe('{"a":1}');
    expect(pedido.redirect).toBe('manual');
    expect(pedido.signal).toBeInstanceOf(AbortSignal);
    const h = pedido.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/json');
    expect(h[CABECALHO_EVENTO]).toBe('deal.created');
    expect(h[CABECALHO_ENDPOINT]).toBe('ep-1');
    expect(verifySignatureHeader(h[CABECALHO_ASSINATURA], '{"a":1}', 'sss', 1_700_000_000)).toBe(true);
  });

  it('os nomes dos cabeçalhos são contrato com quem recebe', () => {
    expect([CABECALHO_EVENTO, CABECALHO_ENDPOINT, CABECALHO_ASSINATURA]).toEqual([
      'X-Wacrm-Event',
      'X-Wacrm-Webhook-Id',
      'X-Wacrm-Signature',
    ]);
    expect(DELIVERY_TIMEOUT_MS).toBe(5000);
  });
});
