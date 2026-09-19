// ============================================================
// Automação PRESA À ETAPA: "interromper se o card sair desta etapa"
// (18/09/2026).
//
// O caso que motivou: a recuperação de No Show manda dez mensagens com o link
// de agendamento. Na 3ª o cliente agenda, a automação do Calendly move o card
// para "Reunião Agendada" — e as outras sete saíam assim mesmo, cobrando o
// retorno de quem já tinha voltado. O "Aguardar" acordava e seguia, estivesse
// o card onde estivesse; a única defesa era uma condição "ainda está em No
// Show?" escrita à mão depois de CADA espera, com o resto aninhado dentro do
// ramo (ramo vazio não para o escopo de fora) — dez níveis para dez mensagens.
//
// A opção mora no GATILHO (`trigger_config.parar_ao_sair`), sem migration.
// Decisão do operador (18/09/2026): é uma caixa POR AUTOMAÇÃO, que nasce
// MARCADA nas automações de etapa novas — e não uma regra geral invisível,
// porque existe sequência que DEVE sobreviver à etapa: as boas-vindas de
// "Contrato Fechado", cujo card é transferido para o funil do Jurídico logo
// em seguida. Automação gravada antes disto não tem a chave = não muda.
//
// ⚠️⚠️ SÃO DUAS PONTAS, e nenhuma dispensa a outra:
//
//   1. NA RETOMADA (`cardSaiuDaEtapa`, chamada por `resumePendingExecution`):
//      a GARANTIA. Lê a etapa do banco na hora em que a espera acorda — vale
//      para qualquer caminho que tenha movido o card (são cinco escritores de
//      etapa), inclusive os que não geram evento, e para o card APAGADO.
//   2. NO EVENTO DE FUNIL (`cancelarEsperasAoSairDaEtapa`, chamada pelo
//      dreno): a HONESTIDADE DA TELA. Só com a ponta 1, a aba Automações da
//      conversa e a marca "tem robô rodando" continuariam dizendo "próxima
//      mensagem em 27 h" sobre quem já reagendou, até a espera acordar — e o
//      operador iria lá clicar em Parar, que é o trabalho manual que isto
//      existe para acabar. E há um ganho de verdade: o card que SAI e VOLTA
//      para a etapa antes de a espera acordar recomeça a sequência do zero
//      (execução nova) em vez de ficar com DUAS correndo.
//
// ⚠️ A regra vale para QUALQUER execução da automação presa, inclusive a
// disparada à mão pelo "Executar automação" — de propósito. O caso comum de
// hoje é o card que JÁ estava em No Show quando a automação foi criada: o
// operador a executa à mão, o cliente agenda, e a sequência tem de parar
// igual. O preço: executar à mão uma automação presa para quem NÃO está na
// etapa não manda nada: a estadia é conferida antes de cada passo, e o 1º já
// encontra o card fora.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { anotarInterrupcao, marcarExecucoesInterrompidas } from './interrupcao';

/**
 * O motivo gravado quando a conferência da etapa FALHA (banco fora do ar): a
 * execução termina `failed`/`falhou`, visível — na retomada e, desde a 8ª
 * rodada do Codex, também ao nascer (`dispararAutomacoes`). Os dois palpites
 * são ruins em silêncio: seguir cobraria quem pode ter saído; cancelar calado
 * mataria a sequência de quem ficou.
 */
export const MOTIVO_ETAPA_DESCONHECIDA =
  'não consegui conferir em que etapa o card está — a sequência foi interrompida para não cobrar quem pode ter saído da etapa';

export const DETALHE_SAIU_DA_ETAPA =
  'interrompida: o card saiu da etapa desta automação';

interface AutomacaoComGatilho {
  trigger_type: string;
  trigger_config: unknown;
}

/**
 * As etapas que PRENDEM esta automação, ou `null` quando ela não é presa.
 *
 * ⚠️ Três condições, todas necessárias:
 *   - gatilho de etapa (em qualquer outro a chave não significa nada);
 *   - `parar_ao_sair === true` ESTRITO (JSONB entrega `"true"` e `1`, que são
 *     truthy — ligar por engano mata uma sequência em silêncio);
 *   - pelo menos uma etapa nomeada: com `stage_ids` vazio o gatilho vale para
 *     QUALQUER etapa, e "sair da etapa" não tem de onde.
 */
export function etapasQuePrendem(
  automation: AutomacaoComGatilho
): string[] | null {
  if (automation.trigger_type !== 'deal_stage_changed') return null;
  const cfg = automation.trigger_config as
    | { stage_ids?: unknown; parar_ao_sair?: unknown }
    | null
    | undefined;
  if (cfg?.parar_ao_sair !== true) return null;
  const etapas = Array.isArray(cfg.stage_ids)
    ? cfg.stage_ids.filter(
        (e): e is string => typeof e === 'string' && e.trim() !== ''
      )
    : [];
  return etapas.length > 0 ? etapas : null;
}

/**
 * O card está FORA das etapas que prendem?
 *
 * `etapaAtual` nula = não há card (apagado, ou o contato não tem negócio
 * aberto): não está em etapa nenhuma, logo está fora. É fato, não ignorância
 * — o mesmo trato de `stageInScope` para contato sem negócio.
 */
export function estaFora(etapas: string[], etapaAtual: string | null): boolean {
  return etapaAtual === null || !etapas.includes(etapaAtual);
}

export type SituacaoNaEtapa =
  /** A automação não é presa a etapa: nada a conferir. */
  | 'nao_se_aplica'
  | 'na_etapa'
  | 'saiu'
  /** A leitura falhou. Quem chama decide — e NÃO pode tratar como 'na_etapa'. */
  | 'erro';

/**
 * PONTA 1 — a espera acordou: o card ainda está numa etapa desta automação?
 *
 * ⚠️ Lê o BANCO, nunca o contexto: `context.to_stage_id` é onde o card estava
 * quando o evento nasceu, e depois de um "Aguardar" de 30 horas isso é
 * história. Mesma razão da condição `deal_stage` do motor.
 *
 * O card é o do CONTEXTO (`deal_id`, que o evento de funil carimba) e, sem
 * ele — execução disparada à mão —, o negócio ABERTO mais recente do contato:
 * a mesma resolução de `negocioAlvo` no motor.
 *
 * ⚠️ Erro de leitura é `'erro'`, nunca `'na_etapa'` nem `'saiu'`: o primeiro
 * cobraria quem pode ter saído, o segundo mataria a sequência de quem ficou —
 * e os dois em silêncio. Quem chama falha de forma VISÍVEL.
 */
export async function cardSaiuDaEtapa(args: {
  db: SupabaseClient;
  automation: AutomacaoComGatilho & { account_id: string };
  contactId: string | null;
  dealId: string | null | undefined;
  /**
   * `criado_em` do evento que abriu a ESTADIA (o contexto da execução, 7ª
   * rodada do Codex). Com ele, a pergunta deixa de ser só "o card está na
   * etapa?" e passa a ser "o card ainda não se mexeu desde que entrou?":
   * qualquer `deal_stage_changed` deste card POSTERIOR ao instante encerra a
   * estadia — mesmo que o card tenha voltado, mesmo que tenha ido para outra
   * etapa da mesma automação (aí a entrada nova dispara execução nova, e a
   * antiga sairia em dobro). É o que fecha o caso do evento de entrada
   * processado DEPOIS da saída. Sem card no contexto (execução manual, ou
   * acionada por outra automação — `ancoraDaEstadia`), a pergunta é por
   * CONTATO: qualquer card dele que se mexa encerra. Ausente = só a posição.
   */
  eventoEm?: string | null;
}): Promise<SituacaoNaEtapa> {
  const etapas = etapasQuePrendem(args.automation);
  if (!etapas) return 'nao_se_aplica';

  const { db, automation, contactId, dealId, eventoEm } = args;
  try {
    if (eventoEm && (dealId || contactId)) {
      const base = db
        .from('cb_automation_events')
        .select('id')
        .eq('account_id', automation.account_id);
      const porCard = dealId
        ? base.eq('deal_id', dealId)
        : base.eq('contact_id', contactId as string);
      const { data: depois, error: erroDaFila } = await porCard
        .eq('tipo', 'deal_stage_changed')
        .gt('criado_em', eventoEm)
        .limit(1);
      if (erroDaFila) {
        console.error('[automations] so-na-etapa: leitura falhou:', erroDaFila.message);
        return 'erro';
      }
      if ((depois ?? []).length > 0) return 'saiu';
    }

    let etapaAtual: string | null = null;
    if (dealId) {
      const { data, error } = await db
        .from('deals')
        .select('stage_id')
        .eq('id', dealId)
        .eq('account_id', automation.account_id)
        .maybeSingle();
      if (error) {
        console.error('[automations] so-na-etapa: leitura falhou:', error.message);
        return 'erro';
      }
      etapaAtual = (data?.stage_id as string | undefined) ?? null;
    } else if (contactId) {
      const { data, error } = await db
        .from('deals')
        .select('stage_id')
        .eq('account_id', automation.account_id)
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('[automations] so-na-etapa: leitura falhou:', error.message);
        return 'erro';
      }
      etapaAtual = (data?.stage_id as string | undefined) ?? null;
    }
    return estaFora(etapas, etapaAtual) ? 'saiu' : 'na_etapa';
  } catch (err) {
    console.error('[automations] so-na-etapa: leitura estourou:', err);
    return 'erro';
  }
}

interface ExecucaoCandidata {
  id: string;
  automation_id: string;
  automations: AutomacaoComGatilho | AutomacaoComGatilho[] | null;
}

/**
 * Das execuções VIVAS de automações de etapa deste contato, as de automação
 * PRESA — que QUALQUER movimento do card encerra. PURO.
 *
 * ⚠️ A unidade é a EXECUÇÃO (o registro), não a espera (5ª rodada do Codex,
 * PR #223): entre o disparo e a primeira espera a execução está rodando e não
 * tem linha nenhuma na fila — e uma saída nesse instante não tinha onde se
 * gravar. O registro existe desde o primeiro passo.
 *
 * ⚠️ Entrar em OUTRA etapa da mesma lista (o cartão "expandido" na grade)
 * TAMBÉM encerra — a mesma régua da estadia (`cardSaiuDaEtapa` com
 * `eventoEm`): a entrada na etapa nova dispara execução nova, e a antiga
 * sairia em dobro. Até a revisão de 19/09 esta ponta lia isso como "continuar
 * dentro" e discordava da retomada.
 */
export function execucoesPresas(
  candidatas: ExecucaoCandidata[]
): ExecucaoCandidata[] {
  return candidatas.filter((execucao) => {
    const automacao = Array.isArray(execucao.automations)
      ? execucao.automations[0]
      : execucao.automations;
    if (!automacao) return false;
    return etapasQuePrendem(automacao) !== null;
  });
}

/**
 * PONTA 2 — o card mudou de etapa: cancela JÁ as esperas presas que ficaram
 * para trás, em vez de deixá-las na tela até acordarem.
 *
 * ⚠️ Chamada pelo dreno ANTES das guardas de ciclo e de atraso: evento velho
 * ou de ciclo não DISPARA automação, mas o card saiu da etapa do mesmo jeito.
 * E antes do despacho, por clareza — as automações da etapa NOVA têm essa
 * etapa no gatilho, então nunca são alcançadas aqui.
 *
 * ⚠️ As MESMAS cercas dos outros cancelamentos: conta + CONTATO +
 * `status = 'pending'`. A execução que está RODANDO (a própria automação
 * presa que moveu o card com `move_deal_stage`) é MARCADA e para no passo
 * seguinte — a estadia é conferida antes de cada passo (8ª rodada).
 *
 * NUNCA lança: roda dentro do dreno do funil, e uma falha aqui não pode
 * custar o disparo das automações da etapa nova. A ponta 1 cobre o que
 * escapar.
 */
export async function cancelarEsperasAoSairDaEtapa(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string | null;
  dealId: string | null;
  toStageId: string | null;
  /**
   * `criado_em` do evento de funil — o instante em que o card se moveu.
   *
   * ⚠️⚠️ Só a execução que JÁ EXISTIA quando o card saiu (Codex, PR #223).
   * Os eventos não são processados em ordem garantida: o aviso imediato e o
   * cron drenam ao mesmo tempo, evento por evento, e o card que SAI e VOLTA
   * rápido pode ter a reentrada processada ANTES da saída. Sem este corte, a
   * saída atrasada enxergaria a execução NOVA — a que a reentrada acabou de
   * iniciar — e a mataria: o cliente voltou para No Show e ficaria sem a
   * sequência, em silêncio. Os dois carimbos são `now()` do MESMO banco.
   */
  movidoEm: string | null;
}): Promise<number> {
  const { db, accountId, contactId, dealId, toStageId, movidoEm } = args;
  if (!contactId || !dealId || !toStageId) return 0;
  try {
    // As execuções VIVAS (sem hora de fim) de automações de etapa deste
    // contato — inclusive a que está RODANDO agora, sem espera nenhuma.
    let consulta = db
      .from('automation_logs')
      .select('id, automation_id, automations!inner(trigger_type, trigger_config)')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .is('finalizado_em', null)
      .is('interrompida_em', null)
      .eq('automations.trigger_type', 'deal_stage_changed');
    if (movidoEm) consulta = consulta.lte('created_at', movidoEm);
    const { data, error } = await consulta;
    if (error) {
      console.error(
        '[automations] so-na-etapa: leitura das execuções falhou:',
        error.message
      );
      return 0;
    }
    const presas = execucoesPresas(
      (data ?? []) as unknown as ExecucaoCandidata[]
    );
    if (presas.length === 0) return 0;

    // ⚠️ O registro não guarda o card, mas a ESPERA guarda (`context.deal_id`):
    // execução estacionada por OUTRO card do mesmo contato fica de fora. A que
    // está RODANDO agora, sem espera, não tem como ser distinguida — aceito:
    // "um card por contato" é a regra desta casa, e a janela é de segundos.
    // Leitura que falha NÃO marca (a ponta 1 cobre): marcar sem saber de qual
    // card é poderia matar a sequência do outro.
    const { data: esperas, error: erroDasEsperas } = await db
      .from('automation_pending_executions')
      .select('log_id, card:context->>deal_id')
      .in(
        'log_id',
        presas.map((a) => a.id)
      )
      .eq('status', 'pending');
    if (erroDasEsperas) {
      console.error(
        '[automations] so-na-etapa: leitura das esperas falhou:',
        erroDasEsperas.message
      );
      return 0;
    }
    const deOutroCard = new Set(
      ((esperas ?? []) as { log_id: string | null; card: string | null }[])
        .filter((e) => e.card && e.card !== dealId)
        .map((e) => e.log_id)
    );
    const alvos = presas.filter((a) => !deOutroCard.has(a.id));
    if (alvos.length === 0) return 0;
    const logIds = alvos.map((a) => a.id);
    const marcadas = await marcarExecucoesInterrompidas(db, logIds, 'etapa');

    // A foto de agora: toda espera pendente dessas execuções cai — sem corte
    // por data, porque a execução NOVA da reentrada é outro registro.
    const { data: canceladas, error: erroDoCancelamento } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .in('log_id', logIds)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .select('id');
    if (erroDoCancelamento) {
      console.error(
        '[automations] so-na-etapa: cancelamento falhou:',
        erroDoCancelamento.message
      );
    }

    for (const logId of logIds) {
      await anotarInterrupcao(db, logId, null, DETALHE_SAIU_DA_ETAPA);
    }
    return marcadas + (canceladas ?? []).length;
  } catch (err) {
    console.error('[automations] so-na-etapa estourou:', err);
    return 0;
  }
}

/**
 * A ESTADIA de uma execução que NÃO nasce de evento — a manual ("Executar
 * automação") e a acionada por outra automação (`run_automation`) —, para
 * automação presa à etapa (Codex, 9ª e 10ª rodadas). Resolve DUAS coisas que
 * o contexto de evento traz de graça e o manual não tem:
 *
 * - o CARD-ALVO (`deal_id`): o negócio ABERTO mais recente do contato que está
 *   numa etapa da automação — é dele que o operador está falando ao clicar —,
 *   senão o aberto mais recente (a conferência de posição dirá "saiu"). Sem o
 *   card no contexto, a saída de etapa (ponta 2) não conseguia dizer de qual
 *   card era a execução, e mover QUALQUER card do contato a matava.
 * - a ÂNCORA (`evento_em`): o último movimento de etapa conhecido DESSE card.
 *   Qualquer movimento POSTERIOR encerra a execução — o card que sai e volta
 *   enquanto ela espera não a acorda ao lado da execução nova da reentrada.
 *
 * ⚠️ A âncora é o `criado_em` de um evento, nunca `now()` do app: os
 * movimentos são carimbados pelo relógio do BANCO, e a mãe que move o card e
 * aciona a filha no passo seguinte tem o evento gravado milissegundos antes do
 * clique — com o relógio do app atrasado, o próprio movimento que a trouxe
 * pareceria "posterior" e a filha morreria ao nascer.
 *
 * Sem card aberto, ou sem movimento conhecido (30 dias da poda), o campo vem
 * `null` e vale só a posição, como antes. Nunca lança; leitura que falha
 * devolve tudo `null`.
 */
export async function estadiaSemEvento(args: {
  db: SupabaseClient;
  automation: AutomacaoComGatilho & { account_id: string };
  contactId: string | null;
}): Promise<{ deal_id: string | null; evento_em: string | null }> {
  const nada = { deal_id: null, evento_em: null };
  const { db, automation, contactId } = args;
  const etapas = etapasQuePrendem(automation);
  if (!etapas || !contactId) return nada;
  try {
    const { data: abertos, error: erroDosCards } = await db
      .from('deals')
      .select('id, stage_id')
      .eq('account_id', automation.account_id)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20);
    if (erroDosCards) {
      console.error('[automations] so-na-etapa: cards do contato falharam:', erroDosCards.message);
      return nada;
    }
    const cards = (abertos ?? []) as { id: string; stage_id: string | null }[];
    const alvo = cards.find((c) => !estaFora(etapas, c.stage_id)) ?? cards[0];
    if (!alvo) return nada;

    const { data, error } = await db
      .from('cb_automation_events')
      .select('criado_em')
      .eq('account_id', automation.account_id)
      .eq('deal_id', alvo.id)
      .eq('tipo', 'deal_stage_changed')
      .order('criado_em', { ascending: false })
      .limit(1);
    if (error) {
      console.error('[automations] so-na-etapa: âncora da estadia falhou:', error.message);
      return { deal_id: alvo.id, evento_em: null };
    }
    const ultimo = (data ?? [])[0] as { criado_em?: string | null } | undefined;
    return {
      deal_id: alvo.id,
      evento_em: typeof ultimo?.criado_em === 'string' ? ultimo.criado_em : null,
    };
  } catch (err) {
    console.error('[automations] so-na-etapa: estadia sem evento estourou:', err);
    return nada;
  }
}
