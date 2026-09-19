// ============================================================
// Onde nasce negócio criado por regra do CB (roteador de funil por conexão,
// e o que vier depois).
//
// No servidor, todo nascimento passa por aqui: roteador, passo `create_deal`
// do motor de automações e POST /api/v1/deals chamam esta função. (No client
// resta o formulário da tela de Funis, sob RLS.)
//
// ⚠️ A regra "um card por contato" NÃO mora aqui, de propósito: cada chamador
// a checa ANTES de chamar, porque a resposta certa difere (o roteador desiste
// em silêncio, a rota devolve 409, o motor loga 'deal already existed') — e o
// índice da 911 só cobre a corrida de `source: 'channel'`.
//
// O QUE ESTE MÓDULO GARANTE, e a rota/motor não precisa repetir:
//  - o funil é DA CONTA (a ingestão roda em service-role e ignora RLS);
//  - a etapa é DO funil (`pipeline_stages` não tem `account_id` — a tenancy
//    dela é indireta, via `pipeline_id`);
//  - a moeda é o real, sempre (`DEFAULT_CURRENCY`);
//  - colisão do índice único do roteador vira SUCESSO, não erro.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { DEFAULT_CURRENCY } from '@/lib/currency';

/** Quem criou o card. Espelha o CHECK de `deals.source` (migration 908). */
export type DealSource = 'manual' | 'automation' | 'channel';

export interface CreateDealArgs {
  db: SupabaseClient;
  accountId: string;
  /**
   * Dono de registro. Anulável desde a 908 — a FK virou `ON DELETE SET NULL`
   * justamente porque os cards automáticos pertencem todos à mesma pessoa, e
   * o CASCADE anterior apagaria o funil inteiro se ela saísse do `auth.users`.
   */
  ownerUserId: string | null;
  contactId: string;
  pipelineId: string;
  /** Quando ausente, cai na etapa de menor `position`. */
  stageId?: string | null;
  channelId?: string | null;
  /**
   * Conversa de onde o negócio nasceu — é o caminho de volta do card para o
   * atendimento. Só pôde passar a ser gravado depois da 910: até lá a FK era
   * NO ACTION e preenchê-la fazia apagar contato (e remover membro da equipe)
   * estourar violação. A FK composta de lá já barra conversa de outra conta,
   * então aqui não há validação a repetir.
   */
  conversationId?: string | null;
  title: string;
  /**
   * Quando GENTE escolheu este título (1007), e por isso o gatilho da 1007
   * não o troca mais pelo nome da ficha. Passam: o POST da API v1 (o título
   * vem escrito no corpo) e o passo `create_deal` QUANDO o autor configurou
   * um título literal, sem `{{…}}`. Deixam NULO de propósito: o roteador de
   * conexão e o `create_deal` com título interpolado — os dois derivam o
   * título do nome de alguém, e é isso que permite ao card acompanhar a
   * ficha quando ela ganhar um nome melhor.
   */
  tituloFixadoEm?: string | null;
  value?: number;
  source: DealSource;
}

export type CreateDealResult =
  /**
   * `created: false` = já existia (colisão do índice único) — não é erro.
   * `deal` é a linha inserida quando o insert aconteceu de fato; na colisão
   * ele é `null` (o card vencedor é o que já existia).
   */
  | { ok: true; created: boolean; deal: Record<string, unknown> | null }
  | {
      ok: false;
      code: 'pipeline_not_found' | 'stage_not_found' | 'no_stage' | 'insert_failed';
      message: string;
    };

export async function createDeal(args: CreateDealArgs): Promise<CreateDealResult> {
  const { db, accountId, ownerUserId, contactId, pipelineId, channelId, source } = args;

  // 1. O funil é desta conta? Filtro explícito por `account_id` — a FK
  //    composta da 908 já barraria no banco, mas assim o erro é legível em
  //    vez de um 23503 cru vindo do PostgREST.
  const { data: funil, error: funilErr } = await db
    .from('pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (funilErr) {
    return { ok: false, code: 'insert_failed', message: funilErr.message };
  }
  if (!funil) {
    return {
      ok: false,
      code: 'pipeline_not_found',
      message: 'Funil não encontrado nesta conta.',
    };
  }

  // 2. A etapa. Explícita → confere que pertence ao funil; ausente → a de
  //    menor `position`. Um funil pode ficar SEM nenhuma etapa (a tela
  //    permite apagar todas) e `deals.stage_id` é NOT NULL, então isto é um
  //    caminho real, não defesa em profundidade.
  let stageId = args.stageId ?? null;

  if (stageId) {
    const { data: etapa, error: etapaErr } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle();
    if (etapaErr) {
      return { ok: false, code: 'insert_failed', message: etapaErr.message };
    }
    if (!etapa) {
      return {
        ok: false,
        code: 'stage_not_found',
        message: 'A etapa escolhida não pertence a este funil.',
      };
    }
  } else {
    const { data: primeira, error: primeiraErr } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (primeiraErr) {
      return { ok: false, code: 'insert_failed', message: primeiraErr.message };
    }
    if (!primeira) {
      return {
        ok: false,
        code: 'no_stage',
        message: 'Este funil não tem nenhuma etapa. Crie uma etapa antes.',
      };
    }
    stageId = primeira.id as string;
  }

  // 3. Moeda: constante. Aqui havia uma consulta a `accounts` só para ler
  //    `default_currency` — um round-trip a mais em TODA criação automática
  //    de negócio (ingestão, automação, API) para escolher entre uma opção
  //    só. Com o real fixado, ela não decide mais nada.
  const { data: inserido, error: insertErr } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: contactId,
      channel_id: channelId ?? null,
      conversation_id: args.conversationId ?? null,
      title: args.title,
      titulo_fixado_em: args.tituloFixadoEm ?? null,
      value: args.value ?? 0,
      currency: DEFAULT_CURRENCY,
      status: 'open',
      source,
    })
    .select('*')
    .maybeSingle();

  if (insertErr) {
    // `cb_deals_contato_canal_idx` (911) barra o segundo insert de uma
    // corrida — duas mensagens do mesmo cliente chegando juntas, ou a
    // reentrega do webhook da Meta quando ela não recebe 200 a tempo. O card
    // que interessa já existe, então isto é o resultado desejado, não falha.
    if (isUniqueViolation(insertErr)) {
      return { ok: true, created: false, deal: null };
    }
    return { ok: false, code: 'insert_failed', message: insertErr.message };
  }

  return {
    ok: true,
    created: true,
    deal: (inserido as Record<string, unknown> | null) ?? null,
  };
}
