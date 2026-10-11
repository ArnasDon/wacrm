import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const envioInserts: Array<Record<string, unknown>> = [];
const loteInserts: Array<Record<string, unknown>> = [];
const leadInserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'acct-123',
    userId: 'user-456',
    supabase: {
      from: (table: string) => ({
        insert: (data: unknown) => {
          if (table === 'envios') {
            envioInserts.push(data as Record<string, unknown>);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'envio-999' },
                  error: null,
                }),
              }),
            };
          }
          if (table === 'envio_lotes') {
            const arr = Array.isArray(data) ? data : [data];
            loteInserts.push(...(arr as Record<string, unknown>[]));
            return {
              select: () => ({
                data: arr.map((item, idx) => ({ id: `lote-${idx + 1}`, numero_lote: (item as Record<string, unknown>).numero_lote })),
                error: null,
              }),
            };
          }
          if (table === 'envio_leads') {
            const arr = Array.isArray(data) ? data : [data];
            leadInserts.push(...(arr as Record<string, unknown>[]));
            return {
              error: null,
            };
          }
          return { error: null };
        },
      }),
    },
  })),
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  },
}));

describe('POST /api/envios', () => {
  beforeEach(() => {
    envioInserts.length = 0;
    loteInserts.length = 0;
    leadInserts.length = 0;
  });

  it('creates an envio directly without JSON (manual message + leads)', async () => {
    const req = new Request('http://localhost/api/envios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Envio Teste Direto',
        mensagem: 'Olá, esta é uma mensagem de teste!',
        leads: [
          { nome: 'Ronaldo', telefone: '83988887777' },
          { nome: 'Carlos', telefone: '5511999998888' },
        ],
        numero_lotes: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('envio-999');

    expect(envioInserts).toHaveLength(1);
    expect(envioInserts[0]).toMatchObject({
      account_id: 'acct-123',
      nome: 'Envio Teste Direto',
      mensagem_imagem_url: null,
      variantes_mensagem: ['Olá, esta é uma mensagem de teste!'],
      created_by: 'user-456',
    });

    expect(loteInserts).toHaveLength(1);
    expect(leadInserts).toHaveLength(2);
    // Verified 55 prefix auto-applied to 83988887777
    expect(leadInserts[0].telefone).toBe('5583988887777');
    expect(leadInserts[1].telefone).toBe('5511999998888');
  });

  it('creates an envio with uploaded JSON (with image)', async () => {
    const campaignJson = JSON.stringify({
      campaign: { name: 'Campanha JSON Com Imagem' },
      creative: { url: 'https://example.com/banner.png' },
      messages: ['Variante 1', 'Variante 2'],
      recipients: [
        { name: 'Ana', phone: '5511900000001', order: 1 },
        { name: 'Bruno', phone: '5511900000002', order: 2 },
      ],
    });

    const req = new Request('http://localhost/api/envios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campanha_json: campaignJson,
        numero_lotes: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(envioInserts).toHaveLength(1);
    expect(envioInserts[0]).toMatchObject({
      nome: 'Campanha JSON Com Imagem',
      mensagem_imagem_url: 'https://example.com/banner.png',
      variantes_mensagem: ['Variante 1', 'Variante 2'],
    });
  });

  it('creates an envio with uploaded JSON that has NO image (text only)', async () => {
    const campaignJson = JSON.stringify({
      campaign: { name: 'Campanha Sem Imagem' },
      messages: ['Apenas texto'],
      recipients: [{ name: 'Lucas', phone: '5511900000003', order: 1 }],
    });

    const req = new Request('http://localhost/api/envios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campanha_json: campaignJson,
        numero_lotes: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(envioInserts).toHaveLength(1);
    expect(envioInserts[0].mensagem_imagem_url).toBeNull();
  });

  it('rejects creation when neither JSON nor leads are supplied', async () => {
    const req = new Request('http://localhost/api/envios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Envio Vazio',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
