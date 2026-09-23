import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
} from './broadcast-core';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { ErroAoLerCanalMeta } from '@/lib/cb-channels/resolve-meta';

// Contact resolution and token decryption are exercised elsewhere — stub
// them so these tests focus on the persistence boundary.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-access-token',
}));
vi.mock('@/lib/api/v1/contacts', () => ({
  findOrCreateContact: vi.fn(async () => ({ id: 'c1' })),
}));

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// Build a Supabase-shaped mock that gets createBroadcast past its config +
// template lookups and into persistence. `rpcResult` is what the atomic
// create_broadcast_with_recipients RPC returns.
function makeDb(rpcResult: { data: unknown; error: unknown }) {
  const calls = {
    rpc: [] as { name: string; args: unknown }[],
    // Incremented if the OLD non-atomic path (a direct broadcasts /
    // broadcast_recipients insert) is ever reached — it must not be.
    usedDirectInsert: 0,
  };
  const database = {
    from(table: string) {
      if (table === 'whatsapp_config') {
        // `single` E `maybeSingle`: o espelho legado é consultado das duas
        // formas — `resolveMetaChannel` usa maybeSingle, o caminho antigo
        // usa single.
        const row = {
          data: {
            phone_number_id: 'pn-1',
            access_token: 'enc',
            waba_id: 'waba-1',
            provider: 'meta',
          },
          error: null,
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          single: () => Promise.resolve(row),
          maybeSingle: () => Promise.resolve(row),
        };
        return chain;
      }
      // Multi-canal: antes de qualquer coisa, `createBroadcast` resolve por
      // qual número a campanha sai (`resolveMetaChannel`). Sem esta linha na
      // fake, todo teste deste bloco morre em "unexpected table" antes de
      // chegar à RPC que ele quer exercitar.
      if (table === 'cb_channels') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: CANAL_META, error: null }),
          // Sem canal pedido, `resolveMetaChannel` LISTA (eq/eq/order/order)
          // e aguarda — não usa maybeSingle. Sem este `then`, a fake caía no
          // espelho legado e `channelId` vinha null.
          then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [CANAL_META], error: null }),
        };
        return chain;
      }
      if (table === 'message_templates') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (
            resolve: (r: { data: unknown[]; error: null }) => unknown
          ) => resolve({ data: [], error: null }),
        };
        return chain;
      }
      if (table === 'broadcasts' || table === 'broadcast_recipients') {
        calls.usedDirectInsert++;
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'orphan' }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, args: unknown) {
      calls.rpc.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  } as unknown as SupabaseClient;
  return { db: database, calls };
}

const CANAL_META = {
  id: 'canal-1',
  kind: 'meta',
  is_default: true,
  status: 'connected',
  phone_number_id: 'pn-1',
  waba_id: 'waba-1',
  access_token: 'enc',
};

describe('createBroadcast atomicity (#370)', () => {
  it('creates parent + recipients through the atomic RPC, never a bare parent insert', async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe('create_broadcast_with_recipients');
    expect(calls.usedDirectInsert).toBe(0);
    expect(plan.broadcastId).toBe('b-1');
    expect(plan.planned).toEqual([
      { recipientRowId: 'r-1', phone: '14155550123', params: [] },
    ]);
  });

  it('throws and leaves no orphaned parent when the atomic create fails', async () => {
    const { db, calls } = makeDb({
      data: null,
      error: { message: 'recipient insert failed' },
    });

    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toBeInstanceOf(BroadcastError);

    // The RPC was the only persistence attempt; because it runs both
    // inserts in a single transaction, its failure rolls the parent back —
    // there is no separate parent insert that could survive as an orphan.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.usedDirectInsert).toBe(0);
  });
});

// ============================================================
// Terminal status (#472). Derived from the recipient rows, not from a
// counter local to one delivery pass — a resume only sends the
// leftovers, so "nothing sent this pass" must not condemn a campaign
// that already delivered hundreds.
// ============================================================

function statusDb(
  counts: Record<string, number>,
  total: number,
  writes: { update?: Record<string, unknown> },
) {
  return {
    from(table: string) {
      let status: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          if (col === 'status') status = val as string;
          return b;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'broadcasts') writes.update = row;
          return b;
        },
        then: (resolve: (r: { count: number; error: null }) => unknown) =>
          resolve({
            count: status === null ? total : (counts[status] ?? 0),
            error: null,
          }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('finalizeBroadcastStatus', () => {
  it('leaves a capped pass in "sending" while recipients are still pending', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(statusDb({ pending: 25 }, 1025, writes), 'b-1');
    // No write at all — the UI keeps offering Resume.
    expect(writes.update).toBeUndefined();
  });

  it('marks a fully-failed broadcast failed', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 10 }, 10, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('failed');
  });

  it('marks a partially-failed broadcast sent', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 3 }, 10, writes),
      'b-1',
    );
    // 7 people got the message; failed_count carries the other 3.
    expect(writes.update?.status).toBe('sent');
  });

  it('does not condemn a campaign whose resume pass sent nothing new', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    // 800 delivered on the original pass, the 200-recipient resume all
    // failed. Pre-fix this wrote 'failed' off a pass-local counter.
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 200 }, 1000, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('sent');
  });
});

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — o canal na criação da campanha.
//
// A `create_broadcast_with_recipients` que o upstream trouxe (#370) insere em
// `broadcasts` SEM `channel_id`. Adotá-la crua faria toda campanha nascer sem
// registro de origem: o envio continuaria saindo pelo número certo (quem
// decide isso é o `resolveMetaChannel` na aplicação), mas o histórico
// mostraria travessão no lugar do número — que é exatamente o que a migration
// 903 veio consertar.
//
// A nossa 940 recria a função com `p_channel_id`. Este caso trava o lado da
// aplicação: se alguém voltar a chamar a RPC sem o canal, falha aqui.
// ============================================================
describe('regressão de merge: a campanha nasce carimbada com o canal', () => {
  it('passa p_channel_id para a RPC atômica', async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });

    const args = calls.rpc[0].args as Record<string, unknown>;
    expect(args.p_channel_id).toBe('canal-1');
  });
});

// ============================================================
// O canal PEDIDO chega ao resolvedor — e a recusa vem ANTES de tudo.
//
// `POST /api/v1/broadcasts` descartava o `channel_id` (Fase 2 do plano do
// merge do upstream, 21/09/2026). O pino da ROTA mocka `createBroadcast`
// inteiro, então o MESMO defeito um nível abaixo — trocar
// `resolveMetaChannel(db, accountId, params.channelId)` por
// `resolveMetaChannel(db, accountId)` — passava por TODOS os testes (medido por
// mutação na revisão final do PR #242). Estes dois casos são o pino do salto
// núcleo → resolvedor. A fake de `cb_channels` CONFERE os filtros, como o banco
// faria: devolver uma linha fixa às cegas é o que deixava o mutante passar.
// ============================================================
describe('o canal pedido chega ao resolvedor', () => {
  const PADRAO = { ...CANAL_META, id: 'canal-padrao', account_id: 'acc', is_default: true };
  const PEDIDO = { ...CANAL_META, id: 'canal-pedido', account_id: 'acc', is_default: false };
  const ALHEIO = { ...CANAL_META, id: 'canal-alheio', account_id: 'outra-conta', is_default: true };

  function makeDbComCanais(
    canais: Record<string, unknown>[],
    erro: { message: string } | null = null
  ) {
    const base = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });
    const solto = base.db as unknown as { from: (t: string) => unknown };
    const original = solto.from.bind(solto);
    solto.from = (table: string) => {
      if (table !== 'cb_channels') return original(table);
      const filtros: Record<string, unknown> = {};
      const casa = (c: Record<string, unknown>) =>
        Object.entries(filtros).every(([k, v]) => c[k] === v);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve(
            erro ? { data: null, error: erro } : { data: canais.find(casa) ?? null, error: null }
          ),
        then: (resolve: (r: { data: unknown[] | null; error: unknown }) => unknown) =>
          resolve(erro ? { data: null, error: erro } : { data: canais.filter(casa), error: null }),
      };
      return chain;
    };
    return base;
  }

  it('⚠️ usa o canal PEDIDO, e não o padrão da conta', async () => {
    const { db, calls } = makeDbComCanais([PADRAO, PEDIDO]);

    const plano = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      channelId: 'canal-pedido',
      recipients: [{ to: '+14155550123' }],
    });

    // Com o `channelId` descartado no caminho, quem sairia aqui é o PADRÃO.
    expect(plano.channelId).toBe('canal-pedido');
    expect((calls.rpc[0].args as Record<string, unknown>).p_channel_id).toBe('canal-pedido');
  });

  it('sem canal pedido, continua escolhendo o padrão', async () => {
    const { db } = makeDbComCanais([PADRAO, PEDIDO]);
    const plano = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });
    expect(plano.channelId).toBe('canal-padrao');
  });

  it('⚠️ canal recusado → meta_channel_required ANTES de criar contato ou campanha', async () => {
    // O canal existe e é Meta — mas é de OUTRA conta. E a conta tem um padrão
    // perfeitamente utilizável (e a fake ainda oferece o espelho legado): cair
    // em qualquer um dos dois seria a campanha saindo por um número que
    // ninguém pediu. A recusa também vem antes do laço de destinatários — que
    // CRIA contato para telefone desconhecido, até mil por pedido.
    const { db, calls } = makeDbComCanais([PADRAO, ALHEIO]);
    vi.mocked(findOrCreateContact).mockClear();

    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        channelId: 'canal-alheio',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'meta_channel_required', status: 400 });

    expect(findOrCreateContact).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
    expect(calls.usedDirectInsert).toBe(0);
  });

  it('⚠️ banco fora na leitura do canal NÃO vira "conecte um número" (400) — lança, e a rota responde 500', async () => {
    // Com o id pedido (caminho do integrador) e sem ele (o padrão).
    for (const channelId of ['canal-pedido', undefined]) {
      const { db, calls } = makeDbComCanais([PADRAO, PEDIDO], { message: 'timeout' });
      vi.mocked(findOrCreateContact).mockClear();
      const tentativa = createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        channelId,
        recipients: [{ to: '+14155550123' }],
      });
      await expect(tentativa).rejects.toBeInstanceOf(ErroAoLerCanalMeta);
      await expect(tentativa).rejects.not.toBeInstanceOf(BroadcastError);
      expect(findOrCreateContact).not.toHaveBeenCalled();
      expect(calls.rpc).toHaveLength(0);
    }
  });
});
