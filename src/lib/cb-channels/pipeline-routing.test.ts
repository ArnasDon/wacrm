import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { routeContactToPipeline } from './pipeline-routing';

// ------------------------------------------------------------
// Stub que registra QUAIS TABELAS foram consultadas, além dos inserts.
// A ordem das guardas é o desenho deste módulo, não detalhe: enquanto
// nenhuma conexão tiver funil configurado (estado de todas hoje), o custo
// por mensagem recebida tem de ser UM select em `cb_channels` e mais nada.
// Um teste que só olhasse o resultado deixaria essa regressão passar.
// ------------------------------------------------------------
type Linha = Record<string, unknown> | null;

interface Cfg {
  channel?: Linha;
  channelError?: { message: string };
  existingDeal?: Linha;
  dealSelectError?: { message: string };
  account?: Linha;
  pipeline?: Linha;
  firstStage?: Linha;
  stage?: Linha;
  insertError?: { code?: string; message: string };
}

function makeDb(cfg: Cfg): {
  db: SupabaseClient;
  inserts: Record<string, unknown>[];
  tabelas: string[];
  /** Colunas usadas em `.eq()`, por tabela — para afirmar a FORMA da consulta. */
  filtros: Record<string, string[]>;
} {
  const inserts: Record<string, unknown>[] = [];
  const tabelas: string[] = [];
  const filtros: Record<string, string[]> = {};
  let table = '';

  const make = () => {
    let ordenado = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (coluna: string) => {
        (filtros[table] ??= []).push(coluna);
        return chain;
      },
      limit: () => chain,
      order: () => {
        ordenado = true;
        return chain;
      },
      maybeSingle: () => {
        if (table === 'cb_channels') {
          return Promise.resolve({ data: cfg.channel ?? null, error: cfg.channelError ?? null });
        }
        if (table === 'deals') {
          return Promise.resolve({
            data: cfg.existingDeal ?? null,
            error: cfg.dealSelectError ?? null,
          });
        }
        if (table === 'accounts') {
          return Promise.resolve({ data: cfg.account ?? null, error: null });
        }
        if (table === 'pipelines') {
          return Promise.resolve({ data: cfg.pipeline ?? { id: 'funil-1' }, error: null });
        }
        if (table === 'pipeline_stages') {
          return Promise.resolve({
            data: ordenado
              ? (cfg.firstStage ?? { id: 'etapa-zero' })
              : (cfg.stage ?? { id: 'etapa-lead' }),
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return Promise.resolve({ data: null, error: cfg.insertError ?? null });
      },
    };
    return chain;
  };

  const db = {
    from: (t: string) => {
      table = t;
      tabelas.push(t);
      return make();
    },
  } as unknown as SupabaseClient;

  return { db, inserts, tabelas, filtros };
}

const CANAL_CONFIGURADO = {
  label: 'Trabalhista',
  default_pipeline_id: 'funil-trabalhista',
  default_stage_id: 'etapa-lead',
};

const BASE = {
  accountId: 'conta-1',
  channelId: 'canal-1',
  contactId: 'contato-1',
  contactName: 'Maria Silva',
};

describe('routeContactToPipeline', () => {
  it('não roteia quando o canal não resolveu', async () => {
    // O oposto de `channelInScope` do motor de automações, que deixa
    // contexto sem canal passar em qualquer escopo — é assim que aquele
    // caminho joga o cliente em todos os funis de uma vez.
    const { db, inserts, tabelas } = makeDb({ channel: CANAL_CONFIGURADO });

    await routeContactToPipeline({ db, ...BASE, channelId: null });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toHaveLength(0);
  });

  it('não roteia conversa de grupo (sem contato)', async () => {
    // `deals.contact_id` é NULLABLE desde a migration 004: o banco NÃO
    // barraria o card órfão, que apareceria em branco no Kanban.
    const { db, inserts, tabelas } = makeDb({ channel: CANAL_CONFIGURADO });

    await routeContactToPipeline({ db, ...BASE, contactId: null });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toHaveLength(0);
  });

  it('canal sem funil configurado sai sem tocar em deals', async () => {
    const { db, inserts, tabelas } = makeDb({
      channel: { label: 'Pessoal', default_pipeline_id: null, default_stage_id: null },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toEqual(['cb_channels']);
  });

  it('não duplica quando o contato já tem card em QUALQUER funil', async () => {
    // Larga em dois eixos: vale para card criado à mão, por automação ou por
    // aqui, aberto ou fechado — e vale em qualquer funil, não só no da
    // conexão. O segundo eixo é o que sustenta a transferência: card movido
    // do Bancário para o Trabalhista não pode ser recriado no Bancário na
    // próxima mensagem do cliente.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      existingDeal: { id: 'negocio-em-outro-funil' },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(0);
  });

  it('a checagem de duplicata NÃO filtra por funil', async () => {
    // Blindagem contra regressão: se alguém reintroduzir `.eq('pipeline_id')`
    // aqui, a transferência entre funis volta a ser desfeita pelo roteador e
    // o lead termina em dois funis — sem erro nenhum na tela.
    const { db, filtros } = makeDb({
      channel: CANAL_CONFIGURADO,
      existingDeal: null,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(filtros.deals).toContain('contact_id');
    expect(filtros.deals).not.toContain('pipeline_id');
  });

  it('cria o negócio com canal, etapa configurada, origem e dono da conta', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      existingDeal: null,
      account: { owner_user_id: 'dono-da-conta', default_currency: 'BRL' },
      stage: { id: 'etapa-lead' },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      account_id: 'conta-1',
      contact_id: 'contato-1',
      pipeline_id: 'funil-trabalhista',
      stage_id: 'etapa-lead',
      channel_id: 'canal-1',
      user_id: 'dono-da-conta',
      source: 'channel',
    });
  });

  it('repassa a conversa que originou o card', async () => {
    // É o caminho de volta do Kanban para o atendimento. Os dois call sites
    // da ingestão já têm a conversa em mão — se este repasse cair, o card
    // nasce órfão e ninguém percebe até alguém clicar.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE, conversationId: 'conversa-9' });

    expect(inserts[0]).toMatchObject({ conversation_id: 'conversa-9' });
  });

  it('⚠️ o título é SÓ O NOME da pessoa — o rótulo da conexão não entra (1007)', async () => {
    // Era "<conexão> — <nome>" até 19/09/2026. O prefixo se pagava como
    // identificação de reserva (o `contact_id` é SET NULL quando o contato é
    // apagado), mas medido no quadro do escritório ele custava mais: em 549
    // dos 962 cards o "nome" era o telefone, e 95 nomeavam uma conexão que já
    // tinha sido renomeada. O nome identifica melhor, e sobrevive ao SET NULL.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(inserts[0]).toMatchObject({ title: 'Maria Silva' });
  });

  it('ficha sem nome nasce com o TELEFONE no título, e o gatilho da 1007 conserta depois', async () => {
    // Não é caso de borda: é o normal quando o escritório aborda primeiro
    // pelo celular pareado. `findOrCreateContact` grava `name || phone`, então
    // `contactName` já chega como o número — nenhum dos 5 chamadores precisou
    // mudar por causa da 1007.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE, contactName: '558590000013' });

    expect(inserts[0]).toMatchObject({ title: '558590000013' });
  });

  it('sem nome NENHUM o título não fica vazio — a coluna é NOT NULL', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE, contactName: null });

    expect(inserts[0]).toMatchObject({ title: 'Novo contato' });
  });

  it('o card nasce SEM a marca de título fixado — é o que deixa o gatilho seguir a ficha', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeContactToPipeline({ db, ...BASE });

    expect(inserts[0]).toMatchObject({ titulo_fixado_em: null });
  });

  it('falha na checagem de duplicata não cria nada nem lança', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      dealSelectError: { message: 'timeout' },
    });

    await expect(routeContactToPipeline({ db, ...BASE })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
  });

  it('falha do escritor não propaga — o fan-out da ingestão segue', async () => {
    const { db } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
      insertError: { code: '23503', message: 'foreign key violation' },
    });

    await expect(routeContactToPipeline({ db, ...BASE })).resolves.toBeUndefined();
  });

  it('erro ao ler o canal não propaga', async () => {
    const { db, inserts } = makeDb({ channelError: { message: 'conexão caiu' } });

    await expect(routeContactToPipeline({ db, ...BASE })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
  });
});
