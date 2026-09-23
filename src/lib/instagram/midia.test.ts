import { describe, expect, it, vi } from 'vitest';

// A guarda de SSRF resolve DNS; aqui ela decide pelo host: "interno" não é
// público. O que se prova é que CADA salto passa por ela.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async (url: string) => !new URL(url).hostname.includes('interno')),
}));

import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import {
  baixarUrlPublica,
  chaveCurta,
  lerComTeto,
  MAX_SALTOS,
  nomeDoContentDisposition,
} from './midia';

/** Corpo em pedaços, sem `content-length` — a forma de quem mente o tamanho. */
function corpoEmPedacos(pedacos: number[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of pedacos) c.enqueue(new Uint8Array(n));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('lerComTeto — o anexo de fora não enche a memória', () => {
  it('abaixo do teto, devolve o corpo inteiro', async () => {
    const b = await lerComTeto(corpoEmPedacos([10, 20, 5]), 100);
    expect(b.byteLength).toBe(35);
  });

  it('content-length acima do teto recusa SEM ler', async () => {
    const r = new Response('x', { status: 200, headers: { 'content-length': '1000' } });
    await expect(lerComTeto(r, 100)).rejects.toThrow(/1000 bytes over the 100-byte limit/);
  });

  it('sem content-length, a leitura para no primeiro pedaço que passa do teto', async () => {
    // Dez pedaços de 60 (600 bytes) — finito, para o mutante sem a contagem
    // reprovar em vez de travar: ele leria tudo e devolveria o corpo.
    let lidos = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        lidos++;
        if (lidos > 10) c.close();
        else c.enqueue(new Uint8Array(60));
      },
    });
    await expect(lerComTeto(new Response(stream), 100)).rejects.toThrow(/over the 100-byte limit/);
    // Para no 2º pedaço (120 > 100), sem ler o resto.
    expect(lidos).toBeLessThanOrEqual(3);
  });
});

function resposta(status: number, location?: string): Response {
  return new Response(status >= 300 && status < 400 ? null : 'arquivo', {
    status,
    headers: location ? { location } : {},
  });
}

// (Sem `beforeEach` de limpeza: o `clearMocks` do vitest.config já zera as
// chamadas a cada teste.)
describe('baixarUrlPublica — a URL do corpo do webhook não alcança a rede interna', () => {
  it('baixa a URL pública, com o redirecionamento em modo manual', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => resposta(200));
    const r = await baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('recusa http sem nem perguntar a rede', async () => {
    const fetchFn = vi.fn(async () => resposta(200));
    await expect(
      baixarUrlPublica('http://cdn.publico/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/https/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('recusa URL malformada', async () => {
    const fetchFn = vi.fn(async () => resposta(200));
    await expect(
      baixarUrlPublica('não é url', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/malformed/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('recusa host que não é público, sem baixar', async () => {
    const fetchFn = vi.fn(async () => resposta(200));
    await expect(
      baixarUrlPublica('https://interno.swarm/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/not public/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('segue redirecionamento para host público (Location relativo inclusive)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta(302, 'https://cdn2.publico/a'))
      .mockResolvedValueOnce(resposta(301, '/b'))
      .mockResolvedValueOnce(resposta(200));
    const r = await baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      'https://cdn.publico/x',
      'https://cdn2.publico/a',
      'https://cdn2.publico/b',
    ]);
    expect(isDeliverableUrl).toHaveBeenCalledTimes(3);
  });

  it('recusa o redirecionamento que aponta para dentro da rede', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(resposta(302, 'https://interno.swarm/segredo'));
    await expect(
      baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/not public/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('recusa o redirecionamento que troca para http', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(resposta(302, 'http://cdn.publico/x'));
    await expect(
      baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/https/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it(`para depois de ${MAX_SALTOS} redirecionamentos`, async () => {
    // Redireciona 10 vezes e depois entrega: sem o teto, o download
    // "funcionaria" no 11º pedido — e o teste pega isso sem travar.
    let n = 0;
    const fetchFn = vi.fn(async () =>
      ++n <= 10 ? resposta(302, 'https://cdn.publico/de-novo') : resposta(200),
    );
    await expect(
      baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/redirect 302/);
    expect(fetchFn).toHaveBeenCalledTimes(MAX_SALTOS + 1);
  });

  it('descarta o corpo de cada redirecionamento e usa UM prazo para a cadeia', async () => {
    const cancelados: number[] = [];
    const redir = (n: number) => {
      const r = resposta(302, 'https://cdn.publico/proximo');
      Object.defineProperty(r, 'body', { value: { cancel: async () => void cancelados.push(n) } });
      return r;
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redir(1))
      .mockResolvedValueOnce(redir(2))
      .mockResolvedValueOnce(resposta(200));
    await baixarUrlPublica('https://cdn.publico/x', fetchFn);
    expect(cancelados).toEqual([1, 2]);
    const sinais = fetchFn.mock.calls.map((c) => c[1]?.signal);
    expect(new Set(sinais).size).toBe(1);
  });

  it('redirecionamento sem Location é falha, não sucesso', async () => {
    const fetchFn = vi.fn(async () => resposta(302));
    await expect(
      baixarUrlPublica('https://cdn.publico/x', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/redirect 302/);
  });
});

describe('nomeDoContentDisposition', () => {
  it('lê o nome que o CDN da Meta manda (medido na Fase 0)', () => {
    expect(
      nomeDoContentDisposition('inline;filename=audioclip-1757460907000-3.mp4')
    ).toBe('audioclip-1757460907000-3.mp4');
    expect(
      nomeDoContentDisposition('attachment; filename="contrato.pdf"')
    ).toBe('contrato.pdf');
    expect(
      nomeDoContentDisposition(
        "attachment; filename*=UTF-8''a%C3%A7%C3%A3o.pdf"
      )
    ).toBe('ação.pdf');
  });

  it('sem cabeçalho ou sem nome, null', () => {
    expect(nomeDoContentDisposition(null)).toBeNull();
    expect(nomeDoContentDisposition('inline')).toBeNull();
  });
});

describe('chaveCurta', () => {
  it('é estável e curta para um mid de 120 caracteres', () => {
    const mid = 'a'.repeat(120);
    expect(chaveCurta(mid)).toBe(chaveCurta(mid));
    expect(chaveCurta(mid)).toMatch(/^[0-9a-f]{12}$/);
    expect(chaveCurta(mid)).not.toBe(chaveCurta(mid + 'b'));
  });
});
