import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveMetaChannel } from './resolve-meta';

// ------------------------------------------------------------
// Broadcast e modelos NÃO passam por uma conversa, então liam o espelho
// `whatsapp_config` e perguntavam "o canal PADRÃO é Meta?". Em produção o
// padrão é Evolution — então o operador conectava o número oficial e mesmo
// assim recebia "Broadcasts require an official Meta (Cloud API) number".
// A pergunta certa é "EXISTE um canal Meta utilizável?".
// ------------------------------------------------------------

const META = {
  id: 'ch-meta',
  account_id: 'acct',
  label: 'Comercial',
  kind: 'meta',
  is_default: false,
  status: 'connected',
  phone_number_id: 'pni-1',
  waba_id: 'waba-1',
  access_token: 'enc',
};
const EVO = {
  id: 'ch-evo',
  account_id: 'acct',
  label: 'Dr. Leonardo',
  kind: 'evolution',
  is_default: true,
  status: 'connected',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
};

function makeDb(opts: {
  canais?: Record<string, unknown>[];
  porId?: Record<string, unknown> | null;
  espelho?: Record<string, unknown> | null;
  erroCanais?: { message: string } | null;
}): SupabaseClient {
  let table = '';
  let filtrouId = false;
  let filtros: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      if (col === 'id') filtrouId = true;
      filtros[col] = val;
      return builder;
    },
    order: () => builder,
    maybeSingle: () => {
      if (table === 'cb_channels') {
        // ⚠️ A fake CONFERE os filtros da busca por id, como o banco faria.
        // Devolvendo `porId` às cegas, o caso "canal de outra conta" passava
        // mesmo com o `.eq('account_id', …)` REMOVIDO do código (medido por
        // mutação na revisão final do PR #242) — e esse filtro é a única
        // barreira entre contas, porque quem chama usa a service role.
        const linha = (opts.porId ?? null) as Record<string, unknown> | null;
        const casa =
          !!linha && Object.entries(filtros).every(([k, v]) => linha[k] === v);
        return Promise.resolve({ data: casa ? linha : null, error: null });
      }
      return Promise.resolve({ data: opts.espelho ?? null, error: null });
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: filtrouId ? null : (opts.canais ?? []),
        error: opts.erroCanais ?? null,
      }),
  };

  return {
    from: (t: string) => {
      table = t;
      filtrouId = false;
      filtros = {};
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveMetaChannel', () => {
  it('acha o canal Meta mesmo quando o PADRÃO é Evolution', async () => {
    // O cenário exato de produção — e a razão de todo o conserto.
    const r = await resolveMetaChannel(makeDb({ canais: [EVO, META] }), 'acct');
    expect(r?.channelId).toBe('ch-meta');
    expect(r?.phoneNumberId).toBe('pni-1');
  });

  it('prefere o canal CONECTADO a um Meta desconectado', async () => {
    const desconectado = { ...META, id: 'ch-off', status: 'disconnected' };
    const r = await resolveMetaChannel(
      makeDb({ canais: [desconectado, META] }),
      'acct',
    );
    expect(r?.channelId).toBe('ch-meta');
  });

  it('ignora canal Meta sem credencial', async () => {
    const incompleto = { ...META, access_token: null };
    const r = await resolveMetaChannel(makeDb({ canais: [incompleto] }), 'acct');
    expect(r).toBeNull();
  });

  it('canal pedido explicitamente é usado', async () => {
    const r = await resolveMetaChannel(makeDb({ porId: META }), 'acct', 'ch-meta');
    expect(r?.channelId).toBe('ch-meta');
  });

  it('canal pedido que NÃO é Meta devolve null — não cai no padrão', async () => {
    // Quem pediu um número específico prefere um erro a ver a campanha sair
    // pelo número errado.
    const r = await resolveMetaChannel(makeDb({ porId: EVO }), 'acct', 'ch-evo');
    expect(r).toBeNull();
  });

  it('⚠️ canal pedido de OUTRA CONTA devolve null — o filtro por conta é a barreira', async () => {
    // O canal EXISTE e é Meta utilizável — só que pertence a outra conta. Quem
    // chama usa a service role (ignora RLS), então o `.eq('account_id', …)` é
    // a única coisa entre uma chave de API da conta A e o número oficial da
    // conta B. A fake confere os filtros: sem o filtro no código, este caso
    // devolve o canal alheio e reprova.
    const alheio = { ...META, id: 'ch-alheio', account_id: 'outra-conta' };
    const r = await resolveMetaChannel(makeDb({ porId: alheio }), 'acct', 'ch-alheio');
    expect(r).toBeNull();
  });

  it('canal pedido que não existe devolve null', async () => {
    const r = await resolveMetaChannel(makeDb({ porId: null }), 'acct', 'ch-fantasma');
    expect(r).toBeNull();
  });

  it('canal pedido e recusado NÃO cai no espelho legado', async () => {
    // Com o id recusado a função devolve null na hora — não segue para a lista
    // nem para o `whatsapp_config`, que aqui é um número oficial perfeitamente
    // utilizável. Cair nele seria a campanha saindo por um número que ninguém
    // pediu.
    const r = await resolveMetaChannel(
      makeDb({
        porId: null,
        espelho: {
          provider: 'meta',
          phone_number_id: 'pni-legado',
          waba_id: 'waba-legado',
          access_token: 'enc',
        },
      }),
      'acct',
      'ch-fantasma',
    );
    expect(r).toBeNull();
  });

  it('cai no espelho legado quando a conta nunca criou canais', async () => {
    const r = await resolveMetaChannel(
      makeDb({
        canais: [],
        espelho: {
          provider: 'meta',
          phone_number_id: 'pni-legado',
          waba_id: 'waba-legado',
          access_token: 'enc',
        },
      }),
      'acct',
    );
    expect(r?.channelId).toBeNull();
    expect(r?.phoneNumberId).toBe('pni-legado');
  });

  it('espelho Evolution não vale como canal Meta', async () => {
    const r = await resolveMetaChannel(
      makeDb({
        canais: [],
        espelho: { provider: 'evolution', phone_number_id: null, access_token: null },
      }),
      'acct',
    );
    expect(r).toBeNull();
  });
});
