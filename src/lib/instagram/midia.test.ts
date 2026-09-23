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
  MAX_SALTOS,
  nomeDoContentDisposition,
} from './midia';

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
    const fetchFn = vi.fn(async () => resposta(200));
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
