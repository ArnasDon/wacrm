import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  InteractiveReplyTriggerConfig,
  TagTriggerConfig,
  DealStageTriggerConfig,
  DealStatusTriggerConfig,
  SendMessageStepConfig,
  SendButtonsStepConfig,
  SendListStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  MoveDealStepConfig,
  AssignConversationStepConfig,
  AutomationRefStepConfig,
  RunFlowStepConfig,
  SetAiStepConfig,
  SendMediaStepConfig,
  SendToNumberStepConfig,
  CalendlyTriggerConfig,
  WebhookTriggerConfig,
  AutomationLogStatus,
  CreateTaskStepConfig,
} from '@/types';
import { supabaseAdmin } from './admin-client';
import { resolverDestinatario } from './destinatario';
import { resolveEngineChannelPreferring } from '@/lib/cb-channels/engine-send';
import { ehGatilhoDaRegua } from '@/lib/asaas/regua';
import { digitosDoTelefone } from '@/lib/contacts/telefone';
import { nomeParaFixar } from '@/lib/contacts/nome-fixado';
import { urlDoInbox } from '@/lib/inbox/url';
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write';
import {
  MAX_TAG_CHAIN_DEPTH,
  getTagChainDepth,
} from '@/lib/contacts/tag-chain';
import {
  FUSO_DO_ESCRITORIO,
  TIPO_DATA,
  formatarParaMensagem,
} from '@/lib/contacts/campo-data';
import { diaNoFuso, somarDias } from '@/lib/tasks/prazo';
import {
  normalizarDescricao,
  normalizarHora,
  normalizarTitulo,
} from '@/lib/tasks/validar';
import {
  engineSendText,
  engineSendTemplate,
  engineSendInteractive,
} from './meta-send';
// ⚠️ Direto dos FLUXOS, como `engineSendInteractive*` já faz em
// `automations/meta-send.ts`. Não há ciclo: `flows/meta-send` só depende de
// `whatsapp/*` e `cb-channels/*`, nunca das automações.
import { engineSendMedia } from '@/lib/flows/meta-send';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import { createDeal } from '@/lib/deals/create-deal';
import { abortActiveRunsForContact } from '@/lib/flows/parar-run';
import { chaveDeAutomacao, chaveDeFluxo, encadear, lerCadeia } from './cadeia';
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';
import {
  CHAVE_DA_TENTATIVA,
  TENTATIVAS_MAX,
  contadorDe,
  decidirRetentativa,
  tentativasJaFeitas,
} from './retentativa';
import { contextoDaEspera, semMarcaDeResposta } from './parar-se-responder';
import {
  DETALHE_SAIU_DA_ETAPA,
  cardSaiuDaEtapa,
  etapasQuePrendem,
} from './so-na-etapa';
import {
  anotarInterrupcao,
  execucaoJaInterrompida,
  marcarExecucoesInterrompidas,
} from './interrupcao';
import {
  desfechoDoEscopo,
  desfechoDoRetorno,
  sinaisDoHistorico,
  type Desfecho,
} from './estado-da-execucao';

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string;
  /** Conversation the event belongs to, if any. */
  conversation_id?: string;
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>;
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string;
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string;
  /** Button / list-row id the customer tapped, for interactive_reply. */
  interactive_reply_id?: string;
  /**
   * Canal (cb_channels.id) por onde o disparo entrou. `null`/ausente = canal
   * desconhecido ou conta pré-multi-canal.
   *
   * Vem carimbado do webhook e sobrevive ao passo `wait` de graça: o contexto
   * é gravado como JSONB em `automation_pending_executions.context` e devolvido
   * intacto pelo cron. Sem isso, um follow-up de 24h sairia pelo canal que o
   * cliente usou nesse meio-tempo, e não pelo canal do disparo original.
   */
  channel_id?: string | null;
  /**
   * Negócio que este disparo diz respeito (migration 933). Vem preenchido nos
   * gatilhos de funil, onde o evento carrega o card EXATO — o que evita a
   * pergunta "qual card?" quando o contato tem mais de um aberto.
   *
   * Sobrevive ao passo `wait` de graça, como o `channel_id`: o contexto é
   * JSONB em `automation_pending_executions.context`.
   */
  deal_id?: string | null;
  /** Etapa de destino do evento de funil — a que o card ACABOU de entrar. */
  to_stage_id?: string | null;
  /**
   * `criado_em` do evento de funil que originou o disparo — QUANDO o card
   * entrou (7ª rodada do Codex, PR #223). É o que amarra a execução a UMA
   * estadia do card na etapa: se a fila de eventos tiver um movimento deste
   * card POSTERIOR a este instante, a estadia acabou — mesmo que o card tenha
   * voltado —, e a execução não nasce (dispatch) nem retoma. Sem isto, o
   * evento de entrada processado tarde (dois drenos concorrentes, ou o cron
   * atrasado) criava a execução DEPOIS de o card já ter saído, fora do
   * alcance da marca de saída. Atravessa o "Aguardar" como o resto do
   * contexto. Ausente na execução manual, que não é de estadia nenhuma.
   */
  evento_em?: string | null;
  /** Etapa de origem. Nula quando o card foi CRIADO na etapa. */
  from_stage_id?: string | null;
  /** Status de destino, para `deal_status_changed` (`won` | `lost` | `open`). */
  to_status?: string | null;
  /**
   * A automação EXATA que este disparo diz respeito — hoje só o lembrete por
   * data (`date_field_offset`) o carimba. O gatilho de lembrete é o único cujo
   * "aconteceu?" é decidido FORA do motor (a varredura pergunta ao banco quem
   * venceu a janela DESTA automação), então o dispatch por tipo não pode
   * abrir o leque: sem o carimbo, o alvo de um lembrete executava TODOS os
   * lembretes da conta — o de 48h saía junto com o de 24h, e depois de novo
   * na própria janela.
   */
  automation_id?: string;
  /**
   * URI do TIPO de evento do Calendly (`scheduled_event.event_type`) que
   * originou o disparo (migration 977). É o que `calendly_booking` compara
   * com `event_type_uri` da config; os dados do agendamento vêm em `vars`.
   */
  calendly_event_type?: string | null;
  /**
   * Id do webhook de entrada que originou o disparo (migration 982). É o
   * que `webhook_received` compara com `webhook_id` da config; o payload
   * achatado vem em `vars`.
   *
   * ⚠️ Atravessa o passo "Aguardar" de graça: o contexto inteiro vira
   * JSONB em `automation_pending_executions.context` e volta intacto pelo
   * agendador.
   */
  webhook_id?: string | null;
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string;
  triggerType: AutomationTriggerType;
  contactId?: string | null;
  context?: AutomationContext;
  /**
   * NOSSO: chamado UMA vez, logo antes da PRIMEIRA automação que passou em
   * todos os recortes (canal, gatilho, etapa) — e nunca quando nenhuma roda.
   * É onde o chamador faz o que só vale "se alguma automação vai rodar" e
   * precisa estar pronto ANTES dela: o Calendly fixa ali o nome da ficha, que
   * a automação fala em `{{contact.name}}`. Sem o gancho, o chamador teria de
   * repetir os recortes do motor para saber — e duas cópias divergem.
   * Falha dele não segura o disparo.
   */
  antesDeExecutar?: () => Promise<void>;
}

/**
 * O que aconteceu num disparo (977). Os chamadores antigos ignoram o
 * retorno (fire-and-forget); o Calendly grava isto no evento — sem ele o
 * log dizia "automação disparada" quando o escopo de conexão/etapa tinha
 * barrado tudo, ou quando um passo falhou (achado do Codex no PR #128).
 */
export interface ResultadoDoDisparo {
  /** Automações ativas deste gatilho na conta. */
  candidatas: number;
  /** Barradas por conexão, etapa ou pela config do gatilho. */
  foraDoEscopo: number;
  /** Chegaram a rodar (têm linha em `automation_logs`). */
  executadas: number;
  /** Rodaram e terminaram `failed` (ou estouraram antes do log). */
  comFalha: number;
  /**
   * Pararam num passo "Aguardar" (`partial`) — no escopo de fora OU dentro
   * de um ramo. O resto sai pelo agendador e fica no histórico da automação;
   * nada aqui é atualizado depois. Contar isso como "executada sem falha"
   * era afirmar "rodou até o fim" sobre execução que nem tinha terminado
   * (Codex, PR #128, 2ª rodada).
   */
  emEspera: number;
  /** O disparo em si não aconteceu (contato de outra conta, banco fora). */
  erro?: string;
}

const DISPARO_VAZIO: ResultadoDoDisparo = {
  candidatas: 0,
  foraDoEscopo: 0,
  executadas: 0,
  comFalha: 0,
  emEspera: 0,
};

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 *
 * Devolve `void` de propósito: os chamadores do upstream (webhook da Meta,
 * `inbound-store`) empilham a promessa num `Promise<void>[]`, e mudar o
 * tipo aqui mexeria em arquivos que o merge do upstream reescreve. Quem
 * precisa saber o que aconteceu chama `dispararAutomacoes`.
 */
export async function runAutomationsForTrigger(
  input: DispatchInput
): Promise<void> {
  await dispararAutomacoes(input);
}

/** `runAutomationsForTrigger` com o RESULTADO (977). Nunca lança. */
export async function dispararAutomacoes(
  input: DispatchInput
): Promise<ResultadoDoDisparo> {
  const r: ResultadoDoDisparo = { ...DISPARO_VAZIO };
  try {
    const db = supabaseAdmin();

    // Tenant isolation. `contactId` can be caller-supplied (the manual
    // POST /api/automations/engine entrypoint reads it straight from the
    // request body), and every step below runs through the service-role
    // client, which bypasses RLS. So before any step can touch the
    // contact, verify it actually belongs to this account. A foreign or
    // forged id is refused silently — callers are fire-and-forget, and a
    // distinct error would leak whether a given contact UUID exists.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle();
      if (ownErr) {
        console.error('[automations] contact ownership check failed:', ownErr);
        return { ...r, erro: 'contact ownership check failed' };
      }
      if (!owned) {
        console.warn(
          '[automations] contact not in account, refusing dispatch',
          input.contactId
        );
        return { ...r, erro: 'contact not in account' };
      }
    }

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true);

    if (error) {
      console.error('[automations] fetch failed:', error);
      return { ...r, erro: 'automations fetch failed' };
    }
    if (!automations || automations.length === 0) return r;
    r.candidatas = automations.length;

    let preparou = false;
    for (const automation of automations as Automation[]) {
      if (!channelInScope(automation, input.context)) {
        r.foraDoEscopo += 1;
        continue;
      }
      if (!triggerMatches(automation, input.context)) {
        r.foraDoEscopo += 1;
        continue;
      }
      // Depois do casamento de gatilho, e não antes: `stageInScope` pode
      // consultar o banco, e não faz sentido perguntar em que etapa o contato
      // está para uma automação que nem era desta palavra-chave.
      if (
        !(await stageInScope(db, automation, input.contactId, input.context))
      ) {
        r.foraDoEscopo += 1;
        continue;
      }
      // ⚠️ AUTOMAÇÃO PRESA À ETAPA: a estadia que este evento abriu ainda está
      // de pé? O evento de ENTRADA pode ser processado depois da SAÍDA (dois
      // drenos concorrentes, ou o cron atrasado até 1 h) — e a marca de saída
      // não alcança uma execução que ainda não existia. Sem isto ela nascia,
      // mandava a 1ª mensagem a quem já saiu da etapa e, se o card voltasse,
      // seguia ao lado da execução nova (7ª rodada do Codex, PR #223). Sai
      // como "fora do escopo": nem registro ganha. Erro de leitura NÃO deixa
      // passar — cobraria quem pode ter saído; é o mesmo trato da retomada.
      if (
        (await cardSaiuDaEtapa({
          db,
          automation,
          contactId: input.contactId ?? null,
          dealId: input.context?.deal_id,
          eventoEm: input.context?.evento_em,
        })) !== 'na_etapa' &&
        etapasQuePrendem(automation)
      ) {
        r.foraDoEscopo += 1;
        continue;
      }
      if (input.antesDeExecutar && !preparou) {
        preparou = true;
        try {
          await input.antesDeExecutar();
        } catch (err) {
          console.error('[automations] antesDeExecutar falhou:', err);
        }
      }
      try {
        const status = await executeAutomation(input, automation);
        r.executadas += 1;
        if (status === 'failed') r.comFalha += 1;
        else if (status === 'partial') r.emEspera += 1;
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err);
        r.executadas += 1;
        r.comFalha += 1;
      }
    }
    return r;
  } catch (err) {
    console.error('[automations] dispatch failed:', err);
    return {
      ...r,
      erro: err instanceof Error ? err.message : 'dispatch failed',
    };
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string;
  automation_id: string;
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string;
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string;
  contact_id: string | null;
  log_id: string | null;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  context: AutomationContext;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single();

  if (error || !automation) {
    console.error(
      '[automations] resume: missing automation',
      pending.automation_id,
      error
    );
    await markPending(pending.id, 'failed');
    return;
  }

  // ⚠️ DESATIVAR A AUTOMAÇÃO PARA O QUE ESTÁ PARADO (migration 936).
  //
  // Até aqui este bloco não existia: o resume relia a automação por id e
  // nunca olhava `is_active`. Uma automação desligada na tela continuava
  // acordando execuções paradas em "Aguardar" — ou seja, o interruptor não
  // era freio. O defeito ficou invisível porque o cron NUNCA foi chamado em
  // produção (nada resumia coisa nenhuma); ligar o laço de 60 s o tornaria
  // real no mesmo dia, com o "follow-up de 24h" saindo para clientes de uma
  // regra que o operador desligou ontem.
  //
  // `cancelled`, não `failed`: cancelamento não é erro e não deve alimentar
  // o painel de falhas.
  if (!automation.is_active) {
    await markPending(pending.id, 'cancelled');
    // A marca (1005): desligar a automação interrompe a execução inteira —
    // religá-la depois não pode acordar as outras esperas desta execução.
    await marcarExecucoesInterrompidas(db, [pending.log_id], 'desativacao');
    return;
  }

  // ⚠️⚠️ A EXECUÇÃO JÁ FOI INTERROMPIDA? (Codex, PR #223, duas rodadas.) A
  // resposta do cliente e a saída da etapa cancelam a espera que estava na
  // fila; esta pode ser a continuação que NÃO estava — o escopo de fora que
  // ainda rodava e estacionou logo depois, ou a espera fora do corte por data
  // do dreno. Sem isto ela acordava e a sequência seguia: no caso da etapa,
  // ao lado da execução NOVA que a reentrada do card iniciou. ANTES da
  // conferência de etapa, de propósito: o card pode ter voltado, e ainda
  // assim a execução antiga acabou. Ver `interrupcao.ts`.
  if (await execucaoJaInterrompida(db, pending.log_id)) {
    await markPending(pending.id, 'cancelled');
    return;
  }

  // ⚠️⚠️ AUTOMAÇÃO PRESA À ETAPA (18/09/2026): com "interromper se o card
  // sair desta etapa" marcado no gatilho, a espera que acorda com o card FORA
  // da etapa não retoma nada. É a GARANTIA da regra — a etapa é lida do banco
  // AGORA, então vale para qualquer caminho que tenha movido (ou apagado) o
  // card; o cancelamento imediato no dreno do funil é só o que mantém a tela
  // honesta até aqui. Ver `so-na-etapa.ts`.
  //
  // Antes disto o "Aguardar" acordava e seguia, estivesse o card onde
  // estivesse: o cliente de No Show que REAGENDOU na 3ª mensagem recebia as
  // outras sete cobrando o retorno.
  const situacao = await cardSaiuDaEtapa({
    db,
    automation: automation as Automation,
    contactId: pending.contact_id,
    dealId: pending.context?.deal_id,
    eventoEm: pending.context?.evento_em,
  });
  if (situacao === 'saiu') {
    // `cancelled`, não `failed`: a regra funcionou, não é erro (936). A MARCA
    // vem primeiro: é ela que segura as irmãs desta execução.
    await marcarExecucoesInterrompidas(db, [pending.log_id], 'etapa');
    await markPending(pending.id, 'cancelled');
    await anotarInterrupcao(db, pending.log_id, null, DETALHE_SAIU_DA_ETAPA);
    return;
  }
  if (situacao === 'erro') {
    // ⚠️ Não sei onde o card está — e os dois palpites são ruins EM SILÊNCIO:
    // seguir cobraria quem pode ter reagendado; cancelar mataria calada a
    // sequência de quem ficou. Falha VISÍVEL (fio, histórico e o bloco de
    // correções do Meu dia), como o motor já trata erro de banco na retomada.
    const motivo =
      'não consegui conferir em que etapa o card está — a sequência foi interrompida para não cobrar quem pode ter saído da etapa';
    await markPending(pending.id, 'failed');
    await appendResults(
      pending.log_id,
      [{ step_id: '', step_type: 'wait', status: 'failed', detail: motivo }],
      'failed',
      motivo
    );
    await fecharLog(pending.log_id, 'falhou');
    return;
  }

  try {
    const retorno = await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      // ⚠️ A marca "parar se o cliente responder" pertence à espera que
      // ACABOU, não à execução: sai do contexto antes de qualquer passo
      // rodar. Sem isto ela viajaria para a retentativa, para o
      // `run_automation` e para as esperas seguintes que o operador NÃO
      // marcou. Ver `parar-se-responder.ts`.
      context: semMarcaDeResposta(pending.context ?? {}),
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
      esperaEmCurso: pending.id,
    });
    // ⚠️ A espera precisa virar `done` ANTES de fechar o log: a guarda de
    // `fecharLog` procura espera VIVA deste log, e esta ainda está `running`.
    // Invertido, toda retomada sairia sem desfecho — e o sintoma seria a
    // execução ficar invisível no fio para sempre.
    await markPending(pending.id, 'done');

    // ⚠️ ESPERA NASCIDA DENTRO DE UM RAMO nunca ganhava desfecho: o resume
    // retoma com `parentStepId` preenchido, e nesse escopo o fim de
    // `executeStepsFrom` chama `appendResults(..., null, ...)`, que não grava
    // status nenhum — o log do ramo ficava para sempre no `partial` da espera.
    // Furo apontado pelos três juízes do desenho. No escopo de FORA não se
    // repete a escrita: `executeStepsFrom` já fechou lá dentro.
    if (pending.parent_step_id !== null) {
      const desfecho = desfechoDoRetorno(retorno);
      // ⚠️⚠️ 'concluida' aqui é PALPITE, não medição: `desfechoDoRetorno` só
      // enxerga o status do escopo, e o escopo de ramo joga fora o
      // `barrouPorCondicao` que calculou (sai pelo `else`, sem acumulador).
      // Medido no harness: a MESMA automação fecha 'barrada' com a espera na
      // raiz e 'concluida' com ela dentro de um ramo. E espera dentro de ramo
      // é a forma NORMAL das automações deste escritório — a trava por
      // etiqueta e o "ainda está em No Show?" só gateiam de verdade com o
      // corpo DENTRO do ramo. O registro persistido carrega o `skipped`, então
      // é dele que a resposta sai (Codex, PR #155, 2ª rodada).
      if (desfecho === 'concluida') {
        const sinais = await sinaisGravados(pending.log_id);
        await fecharLog(
          pending.log_id,
          desfechoDoEscopo({ falhou: false, ...sinais })
        );
      } else if (desfecho) {
        await fecharLog(pending.log_id, desfecho);
      }
    }
  } catch (err) {
    console.error('[automations] resume failed:', err);
    await markPending(pending.id, 'failed');
    await fecharLog(pending.log_id, 'falhou');
  }
}

/**
 * Roda UMA automação, por id — o passo `run_automation` (migration 936).
 *
 * Não passa por `triggerMatches` nem pelos recortes de canal/etapa, e isso é
 * o ponto: quem aciona é outra automação, explicitamente. Filtrar de novo
 * pelo gatilho da alvo seria pedir que ela também "casasse" com um evento que
 * não é o dela — e nunca rodaria.
 *
 * ⚠️ **Exige a automação ATIVA.** Mesmo raciocínio de `startFlowForContact`:
 * o interruptor da tela precisa continuar sendo o freio de emergência. Sem
 * isto, desligar uma automação que está mandando mensagem errada não a para,
 * e o operador não tem como saber que o freio está em outra regra.
 *
 * ⚠️ **Exige a mesma CONTA.** O motor roda em service-role e ignora RLS: sem
 * o `eq('account_id')`, um id de outra conta rodaria a automação dela, com os
 * contatos desta.
 *
 * Nunca lança — devolve o motivo, que o passo grava no registro.
 */
export async function runAutomationById(args: {
  automationId: string;
  accountId: string;
  contactId: string | null;
  context: AutomationContext;
  /** Gatilho do disparo que chegou até aqui, só para rastreabilidade. */
  triggerType: AutomationTriggerType;
  /**
   * O que gravar em `automation_logs.trigger_event`. Default
   * `'run_automation'` — o chamador clássico é o passo homônimo. A execução
   * manual da conversa (rota /api/cb/execucoes/executar) passa `'manual'`:
   * sem rótulo próprio o registro diria que outra automação chamou, e essa
   * diferença é tudo ao investigar quem disparou o quê.
   */
  rotuloDoDisparo?: string;
}): Promise<{ ok: boolean; detail: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('automations')
    .select('*')
    .eq('id', args.automationId)
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (error)
    return { ok: false, detail: `busca da automação falhou: ${error.message}` };
  if (!data) return { ok: false, detail: 'automação não encontrada' };

  const alvo = data as Automation;
  if (!alvo.is_active)
    return { ok: false, detail: 'automação alvo está desativada' };
  // A régua do Asaas (998) só roda pela VARREDURA, que reconfirma o
  // pagamento, trava o marco e monta as `{{vars.*}}`. Por aqui — o botão
  // "Executar automação" e o passo `run_automation` — ela sairia com "Olá, !
  // Consta em aberto:" e sem trava, para quem talvez já pagou.
  if (ehGatilhoDaRegua(alvo.trigger_type)) {
    return {
      ok: false,
      detail: 'a régua de cobrança do Asaas só roda pela varredura do Asaas',
    };
  }

  await executeAutomation(
    {
      accountId: args.accountId,
      triggerType: args.triggerType,
      contactId: args.contactId,
      context: args.context,
    },
    alvo,
    args.rotuloDoDisparo ?? 'run_automation'
  );
  return { ok: true, detail: `automação "${alvo.name}" acionada` };
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(
  input: DispatchInput,
  automation: Automation,
  /**
   * O que vai para `automation_logs.trigger_event`. Por padrão é o gatilho
   * que disparou; `run_automation` sobrescreve, senão o registro diria que
   * esta automação respondeu a uma mensagem — quando na verdade outra
   * automação a chamou, e a diferença é tudo ao investigar um laço.
   */
  rotuloDoDisparo?: string
): Promise<AutomationLogStatus> {
  const db = supabaseAdmin();

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      // Tenancy: matches automation.account_id (NOT NULL post-017).
      account_id: automation.account_id,
      // Audit: keeps the historical "author of this automation"
      // pointer so logs still attribute to the right user even
      // after teammates join the account.
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: rotuloDoDisparo ?? input.triggerType,
      // Sem isto, "por que isso respondeu pelo numero errado?" nao tem
      // resposta na tela de logs.
      channel_id: input.context?.channel_id ?? null,
      steps_executed: [],
      // Seeded pessimistically. The row is written BEFORE any step runs,
      // and every terminal path below overwrites it (`appendResults` at
      // the outermost scope, or `finalizeLog`). Seeding 'success' meant a
      // run that died mid-flight — the process frozen, the pod recycled —
      // left a permanent `status: 'success'` with `steps_executed: []`,
      // indistinguishable from an automation that genuinely had nothing
      // to do. 'failed' inverts that: the status only becomes success if
      // execution actually reached the end. See issue #409.
      status: 'failed',
    })
    .select()
    .single();

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr);
    return 'failed';
  }

  const status =
    (await executeStepsFrom({
      automation,
      contactId: input.contactId ?? null,
      context: input.context ?? {},
      parentStepId: null,
      branch: null,
      startPosition: 0,
      logId: log.id,
      triggerEvent: rotuloDoDisparo ?? input.triggerType,
    })) ?? 'success';

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc(
    'increment_automation_execution_count',
    {
      p_automation_id: automation.id,
    }
  );
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr);
  }
  return status;
}

interface ExecuteArgs {
  automation: Automation;
  contactId: string | null;
  context: AutomationContext;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  startPosition: number;
  logId: string | null;
  triggerEvent: string;
  /**
   * A espera que ESTÁ SENDO processada agora, quando isto é um resume.
   *
   * ⚠️ Sem ela, `fecharLog` enxerga a própria espera que o cron acabou de
   * reivindicar (`status='running'`), conclui que a execução continua e NUNCA
   * fecha o log. Medido no preview em 09/09: a automação com "Aguardar"
   * terminava com `desfecho` nulo para sempre, e ficava invisível no fio —
   * defeito que nenhum teste unitário pegou, porque o mock não simula o ciclo
   * de vida da linha da fila.
   */
  esperaEmCurso?: string | null;
  /**
   * Onde este escopo REPORTA ao pai o que fez (985).
   *
   * ⚠️ Existe porque `barrouPorCondicao`/`fezTrabalho` são locais a cada
   * escopo, e o retorno de `executeStepsFrom` é só o `AutomationLogStatus`.
   * Sem isto, `[condição A → ramo [condição B → ramo vazio]]` era gravada
   * como `concluida`: o escopo do ramo de A tinha passos (a condição B),
   * então devolvia 'success', e a raiz lia isso como "o ramo fez trabalho" —
   * quando ninguém fez nada além de avaliar condições (achado da revisão).
   */
  acumulador?: { fezTrabalho: boolean; barrouPorCondicao: boolean };
}

/**
 * Roda os passos de um escopo e devolve o status DESTE escopo:
 *
 * - `failed`: um passo falhou — aqui ou num ramo abaixo. No escopo de fora é
 *   o que `appendResults` gravou; num ramo é devolvido SEM gravar status (o
 *   log é do escopo que abriu o ramo), e esse escopo PARA, como pararia se
 *   o passo estivesse fora do ramo. Até a 2ª rodada do Codex no PR #128 o
 *   ramo devolvia `null`, a execução seguia e o log terminava "success" com
 *   `error_message` preenchido.
 * - `partial`: parou num "Aguardar" — o próprio, ou um ramo. ⚠️ Ramo em
 *   espera NÃO segura o escopo de fora: os passos seguintes rodam e o LOG
 *   termina pelo status deles (semântica do upstream; o ramo continua pelo
 *   agendador). Só o RETORNO sobe como `partial`, para quem precisa saber
 *   se a execução terminou (`dispararAutomacoes` → `emEspera`).
 * - `success`: chegou ao fim. `null`: ramo sem passo nenhum.
 */
async function executeStepsFrom(
  args: ExecuteArgs
): Promise<AutomationLogStatus | null> {
  const db = supabaseAdmin();

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true });

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery
          .eq('parent_step_id', args.parentStepId)
          .eq('branch', args.branch ?? 'yes');

  const { data: steps, error: stepsErr } = await scoped;

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message);
    // ⚠️ `esperaEmCurso` aqui também: num resume de escopo RAIZ a guarda
    // enxergaria a própria espera que o cron reivindicou e o log ficaria sem
    // desfecho para sempre — o cartão de falha nunca apareceria (achado da
    // revisão, 09/09).
    await fecharLog(args.logId, 'falhou', args.esperaEmCurso);
    return 'failed';
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null);
      // ⚠️⚠️ Este ramo tem DOIS moradores, e por isso o desfecho sai do
      // REGISTRO em vez de ser cravado. No disparo fresco de uma automação sem
      // passo nenhum o histórico é vazio e a resposta é `concluida`, como
      // sempre foi. Mas a RETOMADA cai aqui também, sempre que o "Aguardar" é
      // o último passo (o motor enfileira `position + 1` sem perguntar se
      // sobrou algo) ou quando o operador apaga os passos seguintes com uma
      // execução estacionada — e aí a premissa da nota antiga ("não houve
      // condição nenhuma") é falsa: pode ter havido barreira e zero trabalho
      // horas antes, noutra chamada (Codex, PR #155, 2ª rodada).
      const sinais = await sinaisGravados(args.logId);
      await fecharLog(
        args.logId,
        desfechoDoEscopo({ falhou: false, ...sinais }),
        args.esperaEmCurso
      );
      return 'success';
    }
    return null;
  }

  const results: AutomationLogStepResult[] = [];
  let status: 'success' | 'partial' | 'failed' = 'success';
  let errorMessage: string | null = null;
  let ramoEmEspera = false;
  // Para o DESFECHO (985), que é pergunta diferente do `status`: "como isto
  // terminou?" em vez de "deu erro?". Ver `estado-da-execucao.ts`.
  let barrouPorCondicao = false;
  let fezTrabalho = false;

  for (const step of steps as AutomationStep[]) {
    // ⚠️ A EXECUÇÃO FOI INTERROMPIDA ENQUANTO ESTE ESCOPO RODAVA? (7ª rodada
    // do Codex, PR #223.) Com a espera marcada num RAMO, o escopo de fora
    // segue executando — e a resposta do cliente (ou a saída da etapa) que
    // chegasse nesse meio só era vista no próximo estacionamento: os passos
    // comuns até lá, inclusive mensagens, saíam depois da interrupção
    // prometida. Uma leitura por chave primária antes de cada passo; o
    // "Aguardar" tem a sua própria, dentro de `cb_estacionar_espera`.
    if (
      step.step_type !== 'wait' &&
      (await execucaoJaInterrompida(db, args.logId))
    ) {
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'skipped',
        detail: 'não executado: a execução já foi interrompida',
      });
      status = 'partial';
      await appendResults(args.logId, results, status, errorMessage);
      return status;
    }

    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig;
      const ms = waitMs(cfg);
      // ⚠️⚠️ ESTACIONA PELA FUNÇÃO `cb_estacionar_espera` (1005), nunca por
      // INSERT direto. Ela trava a linha do registro (`FOR UPDATE`), confere
      // `interrompida_em` e só então insere — numa transação só. Sem isso,
      // um cancelamento (resposta do cliente, saída da etapa, botão Parar)
      // que chegasse entre "perguntar" e "inserir" deixava uma linha
      // `pending` que ninguém mais cancelava: visível na aba por dias e, se
      // o card voltasse à etapa, retomada ao lado da execução nova (Codex,
      // 4ª e 5ª rodadas do PR #223). `null` = a execução JÁ foi interrompida
      // enquanto este escopo rodava: sem linha, sem zumbi.
      const { data: estacionada, error: erroDaEspera } = await db.rpc(
        'cb_estacionar_espera',
        {
          automation_id: args.automation.id,
          // Tenancy: account_id required NOT NULL post-017.
          account_id: args.automation.account_id,
          user_id: args.automation.user_id,
          contact_id: args.contactId,
          log_id: args.logId,
          parent_step_id: args.parentStepId,
          branch: args.branch,
          next_step_position: step.position + 1,
          // ⚠️ A decisão "parar se o cliente responder" é escrita a CADA
          // estacionamento — marca ou limpa —, nunca herdada: o contexto é
          // copiado de ponta a ponta da execução, e a marca de uma espera
          // vazaria para as seguintes. Ver `parar-se-responder.ts`.
          context: contextoDaEspera(args.context, cfg, step.id),
          run_at: new Date(Date.now() + ms).toISOString(),
        }
      );
      // ⚠️ Fila que recusa a linha NÃO pode virar "esperando": ninguém
      // retomaria, e a execução ficaria `partial` para sempre — invisível no
      // fio e fora do bloco de correções do Meu dia. É a mesma régua da
      // retentativa, logo abaixo; até 18/09/2026 este INSERT não era
      // conferido (o Supabase devolve `error`, não lança).
      if (erroDaEspera) {
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: `não consegui agendar a espera: ${erroDaEspera.message}`,
        });
        status = 'failed';
        errorMessage = erroDaEspera.message;
        break;
      }
      if (!estacionada) {
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'skipped',
          detail: 'não estacionada: a execução já foi interrompida',
        });
        // O mesmo estado de uma espera estacionada: a execução não terminou
        // por conta própria, e cancelamento não ganha desfecho (936).
        status = 'partial';
        await appendResults(args.logId, results, status, errorMessage);
        return status;
      }
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail:
          cfg.parar_se_responder === true
            ? `waiting ${cfg.amount} ${cfg.unit} (para se o cliente responder)`
            : `waiting ${cfg.amount} ${cfg.unit}`,
      });
      status = 'partial';
      await appendResults(args.logId, results, status, errorMessage);
      return status;
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig;
        const taken = await evaluateCondition(cfg, args);
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        });
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        // O que o RAMO fizer é reportado aqui, não inferido do status dele.
        const doRamo = { fezTrabalho: false, barrouPorCondicao: false };
        const ramo = await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
          acumulador: doRamo,
        });
        if (ramo === 'failed') {
          // O ramo já gravou seus resultados e o `error_message`; o status é
          // deste escopo. Sem isto o passo falhava lá dentro, a execução
          // seguia daqui e o log dizia "success" (Codex, PR #128, 2ª rodada).
          status = 'failed';
          break;
        }
        if (ramo === 'partial') ramoEmEspera = true;
        if (ramo === null) {
          // ⚠️ RAMO VAZIO — a barreira que o log não registrava (985). O motor
          // SEGUE nos passos seguintes deste escopo (semântica que já existia e
          // que esta entrega não muda); o que passa a existir é o registro.
          barrouPorCondicao = true;
          // A entrada da condição vira `skipped` para a tela poder dizer QUAL
          // condição desviou. É a última empurrada acima: a recursão do ramo
          // grava no array DELA, não neste.
          const ultima = results[results.length - 1];
          if (ultima) ultima.status = 'skipped';
        } else {
          // ⚠️ O que conta é o que o ramo REPORTOU, não o status dele: um ramo
          // que só avaliou outra condição e caiu em ramo vazio devolve
          // 'success' sem ter feito trabalho nenhum.
          if (doRamo.fezTrabalho) fezTrabalho = true;
          if (doRamo.barrouPorCondicao) barrouPorCondicao = true;
        }
        continue;
      }

      const detail = await runStep(step, args);
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      });
      fezTrabalho = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // ⚠️⚠️ RETENTATIVA (13/09/2026): antes daqui, QUALQUER erro encerrava a
      // execução — e o trabalho que faltava não tinha nada a ver com o que
      // falhou. Medido em produção: a automação do Calendly morreu no aviso
      // ao advogado ("Connection Closed") e o card do cliente ficou parado na
      // etapa antiga. Agora o passo volta para a MESMA fila do "Aguardar",
      // na SUA posição (o resume filtra por `gte('position', …)`), e a
      // execução continua de onde parou.
      //
      // ⚠️ A régua de "pode repetir?" é pura e mora em `retentativa.ts`. O
      // que ela precisa daqui é a única coisa que só este `catch` sabe: se o
      // erro veio do PROVEDOR e, nesse caso, se ele RECUSOU (4xx — processou
      // o pedido e disse não, nada saiu) ou se foi tempo esgotado/5xx, em que
      // a mensagem PODE ter saído. Sem essa distinção, repetir um envio manda
      // o texto duas vezes ao cliente — a lição do `entrega_incerta` (932). E
      // erro que NÃO é do provedor (configuração, banco) nunca repete: vai
      // falhar igual daqui a cinco minutos.
      const provedor =
        err instanceof EvolutionApiError
          ? { recusou: err.status >= 400 && err.status < 500 }
          : null;
      const tentativa = tentativasJaFeitas(args.context, step.position) + 1;
      const decisao = decidirRetentativa({
        stepType: step.step_type,
        tentativa,
        provedor,
      });

      if (decisao.repetir) {
        // Pela MESMA função do "Aguardar" (1005): trava o registro e recusa
        // se a execução já foi interrompida — a retentativa seria a mesma
        // linha zumbi, só que de 30 s a 5 min.
        const { data: reenfileirada, error: erroDaFila } = await db.rpc(
          'cb_estacionar_espera',
          {
            automation_id: args.automation.id,
            account_id: args.automation.account_id,
            user_id: args.automation.user_id,
            contact_id: args.contactId,
            log_id: args.logId,
            parent_step_id: args.parentStepId,
            branch: args.branch,
            // ⚠️ A posição DESTE passo, não a seguinte: é ele que vai rodar
            // de novo. O "Aguardar" enfileira `position + 1` porque ele já
            // terminou; aqui o passo não chegou a acontecer.
            next_step_position: step.position,
            context: {
              ...args.context,
              [CHAVE_DA_TENTATIVA]: contadorDe(step.position, tentativa),
            },
            run_at: new Date(Date.now() + decisao.esperaMs).toISOString(),
          }
        );

        if (!erroDaFila && !reenfileirada) {
          results.push({
            step_id: step.id,
            step_type: step.step_type,
            status: 'skipped',
            detail: `${msg} — não reenfileirada: a execução já foi interrompida`,
          });
          status = 'partial';
          await appendResults(args.logId, results, status, errorMessage);
          return status;
        }

        // ⚠️ Fila que não aceitou a linha NÃO pode virar "vai tentar de
        // novo": ninguém retomaria, e a execução ficaria `partial` para
        // sempre — invisível no fio e fora do bloco de correções do Meu dia.
        // Falhando o enfileiramento, o comportamento é o de antes.
        if (!erroDaFila) {
          results.push({
            step_id: step.id,
            step_type: step.step_type,
            status: 'failed',
            detail: `${msg} — tentativa ${tentativa} de ${TENTATIVAS_MAX}; nova tentativa em ${Math.round(decisao.esperaMs / 1000)}s`,
          });
          // `partial` é o mesmo estado do "Aguardar": a execução não terminou,
          // e é o que impede `fecharLog` de carimbar um desfecho agora.
          status = 'partial';
          await appendResults(args.logId, results, status, errorMessage);
          return status;
        }
        console.error(
          '[automations] não consegui enfileirar a retentativa:',
          erroDaFila.message
        );
      }

      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail:
          tentativa > 1
            ? `${msg} — desisti depois de ${tentativa} tentativas`
            : msg,
      });
      status = 'failed';
      errorMessage = msg;
      break;
    }
  }

  // Reporta ao escopo de cima o que aconteceu aqui. Na raiz não há pai, e é
  // ela que grava o desfecho logo abaixo.
  if (args.acumulador) {
    if (fezTrabalho) args.acumulador.fezTrabalho = true;
    if (barrouPorCondicao) args.acumulador.barrouPorCondicao = true;
  }

  if (args.parentStepId === null) {
    const historico = await appendResults(
      args.logId,
      results,
      status,
      errorMessage
    );
    // O DESFECHO (985) é gravado só no escopo de FORA, e só aqui: é o ponto em
    // que se sabe se houve barreira e se houve trabalho.
    //
    // ⚠️ Sem condicional de `status`: a espera DESTE escopo já saiu por
    // `return` bem acima (o compilador confirma — aqui `status` só pode ser
    // 'success' ou 'failed'). O caso que sobra é `ramoEmEspera`: o escopo
    // terminou mas um ramo continua parado, e aí quem impede o fechamento
    // prematuro é a guarda de espera viva de `fecharLog`, não um teste aqui.
    //
    // ⚠️⚠️ Os contadores acima só conhecem ESTA chamada, e uma execução com
    // "Aguardar" atravessa várias: a retomada zera tudo e enxerga só o trecho
    // depois da espera. Por isso somam-se os sinais do REGISTRO, que
    // atravessa as chamadas. Sem isso, `[enviar][aguardar][condição de ramo
    // vazio]` — a forma do follow-up de no-show — fechava como `barrada`, ou
    // seja, "não fez nada" sobre uma execução que já falou com o cliente
    // (Codex, PR #155).
    const doRegistro = sinaisDoHistorico(historico);
    await fecharLog(
      args.logId,
      desfechoDoEscopo({
        falhou: status === 'failed',
        barrouPorCondicao: barrouPorCondicao || doRegistro.barrouPorCondicao,
        fezTrabalho: fezTrabalho || doRegistro.fezTrabalho,
      }),
      args.esperaEmCurso
    );
  } else {
    // Nested branch — just append results; the parent scope writes the status.
    await appendResults(args.logId, results, null, errorMessage);
  }
  // Ramo parado em "Aguardar" não muda o que o log diz (acima), mas a
  // execução NÃO terminou — e é isso que o chamador pergunta.
  return status === 'success' && ramoEmEspera ? 'partial' : status;
}

async function runStep(
  step: AutomationStep,
  args: ExecuteArgs
): Promise<string> {
  const db = supabaseAdmin();

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig;
      if (!args.contactId) throw new Error('send_message needs a contact');
      const text = await interpolate(cfg.text, args);
      if (!text.trim()) throw new Error('send_message has empty text');
      const conversationId = await resolveConversationId(args);
      // ⚠️ Na régua do Asaas (998, D19) a conexão do passo FALHA FECHADA —
      // a mesma cerca do `send_to_number`. `resolveEngineChannelPreferring`
      // cai em silêncio no canal da conversa (e daí no padrão) quando o id
      // não resolve; numa cobrança isso é o link de pagamento saindo por
      // outro número sem ninguém saber.
      if (ehGatilhoDaRegua(args.automation.trigger_type) && cfg.channel_id) {
        const canal = await resolveEngineChannelPreferring(
          db,
          args.automation.account_id,
          conversationId,
          cfg.channel_id
        );
        if (!canal || canal.channelId !== cfg.channel_id) {
          throw new Error(
            'send_message: a conexão escolhida não está disponível nesta conta'
          );
        }
      }
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
        preferredChannelId: stepChannel(
          step.step_config as SendMessageStepConfig,
          args
        ),
        // "Assinar como" (998, D18): o prefixo desta automação, sob o
        // interruptor da conta; NULL = o nome automático do escritório.
        assinarComo: args.automation.assinatura_personalizada ?? null,
      });
      // Sem "via Meta": engineSendText resolve o canal da conversa e pode ter
      // saído pela Evolution. O canal efetivo entra no detalhe na Fase E1.
      return `sent (${whatsapp_message_id})`;
    }

    case 'send_buttons':
    case 'send_list': {
      const payload = step.step_config as
        SendButtonsStepConfig | SendListStepConfig;
      if (!args.contactId) throw new Error(`${step.step_type} needs a contact`);
      // Validate against Meta's limits before the network call so a bad
      // payload surfaces as a clear failed-step detail rather than a raw
      // Meta 400 mid-conversation.
      const check = validateInteractivePayload(payload);
      if (!check.ok) throw new Error(check.error);
      const conversationId = await resolveConversationId(args);
      const { whatsapp_message_id } = await engineSendInteractive({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        payload,
        preferredChannelId: stepChannel(
          step.step_config as { channel_id?: string | null },
          args
        ),
      });
      return `interactive sent (${whatsapp_message_id})`;
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig;
      if (!args.contactId) throw new Error('send_template needs a contact');
      if (!cfg.template_name)
        throw new Error('send_template needs template_name');
      const conversationId = await resolveConversationId(args);
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a);
              const nb = Number(b);
              const aNum = Number.isFinite(na);
              const bNum = Number.isFinite(nb);
              if (aNum && bNum) return na - nb;
              if (aNum) return -1;
              if (bNum) return 1;
              return a.localeCompare(b);
            })
            .map((k) => String(cfg.variables![k]))
        : [];
      const { whatsapp_message_id } = await engineSendTemplate({
        preferredChannelId: stepChannel(cfg, args),
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      });
      return `template sent (${whatsapp_message_id})`;
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig;
      if (!args.contactId || !cfg.tag_id)
        throw new Error('add_tag needs contact + tag_id');
      const added = await addContactTagIfAbsent(db, {
        accountId: args.automation.account_id,
        contactId: args.contactId,
        tagId: cfg.tag_id,
      });
      if (!added) return `tag ${cfg.tag_id} already present`;

      const depth = getTagChainDepth(args.context);
      if (depth >= MAX_TAG_CHAIN_DEPTH) {
        console.warn('[automations] tag_added chain depth limit reached', {
          automationId: args.automation.id,
          contactId: args.contactId,
          tagId: cfg.tag_id,
          depth,
        });
        return `tag ${cfg.tag_id} added; tag_added dispatch skipped at depth ${depth}`;
      }

      await runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'tag_added',
        contactId: args.contactId,
        context: {
          ...args.context,
          tag_id: cfg.tag_id,
          vars: {
            ...(args.context.vars ?? {}),
            _tag_chain_depth: depth + 1,
          },
        },
      });
      return `tag ${cfg.tag_id} added and tag_added dispatched`;
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig;
      if (!args.contactId || !cfg.tag_id)
        throw new Error('remove_tag needs contact + tag_id');
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id);
      return `tag ${cfg.tag_id} removed`;
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig;
      if (!args.contactId)
        throw new Error('assign_conversation needs a contact');
      let agentId = cfg.agent_id;
      if (cfg.mode === 'round_robin') {
        // Pick any member of the account. The existing implementation
        // only ever returned the automation's author; preserving that
        // shape until a real round-robin algorithm replaces it.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', args.automation.account_id)
          .limit(1);
        agentId = profiles?.[0]?.user_id;
      }
      if (!agentId) return 'no agent resolved';

      // ⚠️ A conversa DO DISPARO, não todas as do contato. O código anterior
      // filtrava só por conta+contato, então um contato com três conversas
      // tinha as três atribuídas de uma vez — inclusive as de outro número, o
      // que atropela o recorte por conexão que a Fase 1 acabou de fechar.
      // Cai para "todas" só quando o disparo não tem conversa (etiqueta
      // adicionada na ficha, por exemplo), que é o comportamento de antes.
      const conversaDoDisparo =
        typeof args.context.conversation_id === 'string'
          ? args.context.conversation_id
          : null;

      let q = db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id);
      q = conversaDoDisparo
        ? q.eq('id', conversaDoDisparo)
        : q.eq('contact_id', args.contactId);
      const { error: assignErr } = await q;
      if (assignErr)
        throw new Error(`assign_conversation falhou: ${assignErr.message}`);

      return conversaDoDisparo
        ? `assigned to ${agentId}`
        : `assigned to ${agentId} (todas as conversas do contato)`;
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig;
      if (!args.contactId)
        throw new Error('update_contact_field needs a contact');
      // Resolve workflow variables ({{ vars.* }}, {{ message.text }}) so custom
      // values can be populated dynamically from the triggering context.
      // ⚠️ CRU: este passo GRAVA. Ver `camposCru` — data formatada aqui deixa
      // o campo de destino inútil para a tela e para o lembrete.
      const value = await interpolate(cfg.value, args, { cru: true });

      // Custom fields are encoded as `custom:<custom_field_id>`; anything else
      // is a built-in contact column.
      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length);
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`;
        }
        // Defense in depth: the service-role client bypasses RLS, so confirm
        // the field definition belongs to this account before writing.
        const { data: field } = await db
          .from('custom_fields')
          .select('id')
          .eq('id', customFieldId)
          .eq('account_id', args.automation.account_id)
          .maybeSingle();
        if (!field) {
          return `field ${cfg.field} not writable from automations`;
        }
        // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
        // runs overwrite rather than duplicate. Tenancy is enforced above and,
        // for the contact side, by the entry-point ownership guard.
        await db.from('contact_custom_values').upsert(
          {
            contact_id: args.contactId,
            custom_field_id: customFieldId,
            value,
          },
          { onConflict: 'contact_id,custom_field_id' }
        );
        return `custom field updated`;
      }

      const allowed = new Set(['name', 'email', 'company']);
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`;
      }

      // ⚠️⚠️ O NOME é escrita DELIBERADA de quem configurou a automação, e
      // segue a régua do agendamento do Calendly (999): valor que não é nome
      // — vazio, ou o telefone que o formulário devolveu no campo de nome —
      // NÃO sobrescreve a ficha; nome de verdade é gravado FIXADO. Sem isto,
      // a automação ativa do Calendly (passo 0: nome = {{vars.agendamento_nome}})
      // gravava o número por cima de um nome já fixado, e a marca antiga o
      // CONGELAVA — a mensagem seguinte do cliente não consertava mais; e um
      // "Atualizar nome" vindo do Typebot durava só até o pushName seguinte
      // (revisão do PR #208).
      if (cfg.field === 'name') {
        const nome = nomeParaFixar(value);
        if (!nome) return 'name not updated: the value is not a name';
        const agora = new Date().toISOString();
        await db
          .from('contacts')
          .update({ name: nome, nome_fixado_em: agora, updated_at: agora })
          .eq('id', args.contactId)
          .eq('account_id', args.automation.account_id);
        return 'name updated';
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id);
      return `${cfg.field} updated`;
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig;
      if (!cfg.pipeline_id || !cfg.stage_id)
        throw new Error('create_deal needs pipeline + stage');
      // A moeda não é decidida aqui: `createDeal` grava real, sempre. (Isto
      // já descreveu uma leitura de `accounts.default_currency` com queda
      // para USD — o modelo de uma-moeda-por-conta do upstream, issue #218.
      // O CB Advogados fixou o real e os seletores saíram da interface.)
      if (!args.contactId) throw new Error('create_deal needs a contact');

      // ⚠️ Um card por contato, checado AQUI porque o banco não cobre este
      // caminho: o índice da 911 é parcial (WHERE source = 'channel') e o
      // insert abaixo sai com source 'automation' — sem esta consulta, o
      // contato que já tem card ganharia um segundo. Mesma largura do
      // roteador (pipeline-routing.ts, guarda 4) e do POST /api/v1/deals:
      // card aberto ou fechado, em qualquer funil, de qualquer origem.
      const { data: cardExistente, error: cardErr } = await db
        .from('deals')
        .select('id')
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
        .limit(1)
        .maybeSingle();
      if (cardErr) throw new Error(`create_deal falhou: ${cardErr.message}`);
      if (cardExistente) return 'deal already existed';

      // ⚠️ Passa a usar o criador CENTRAL. O insert direto que estava aqui era
      // herança do upstream e não validava nada: funil de outra conta, etapa
      // que não pertence ao funil e moeda da conta passavam batido, e o
      // cabeçalho de `create-deal.ts` já avisava que as regras de lá NÃO
      // valiam para automação. Agora valem, e a mensagem de recusa é
      // específica em vez de um código de FK cru no log.
      const conversationIdParaCard =
        typeof args.context.conversation_id === 'string'
          ? args.context.conversation_id
          : null;

      const criado = await createDeal({
        db,
        accountId: args.automation.account_id,
        // Autor da REGRA como dono de registro — a coluna é anulável e
        // `ON DELETE SET NULL` desde a 908 justamente por causa destes cards.
        ownerUserId: args.automation.user_id,
        contactId: args.contactId,
        pipelineId: cfg.pipeline_id,
        stageId: cfg.stage_id,
        title: await interpolate(cfg.title, args),
        value: cfg.value ?? 0,
        // Canal do disparo, mesmo carimbo que a linha de automation_logs
        // recebe. Sem ele o card some de qualquer recorte por número.
        channelId: args.context.channel_id ?? null,
        conversationId: conversationIdParaCard,
        // Sem isto a linha cai no DEFAULT 'manual' e o card de automação fica
        // indistinguível do digitado à mão — a distinção que a coluna existe
        // para fazer (908).
        source: 'automation',
      });

      if (!criado.ok) throw new Error(`create_deal falhou: ${criado.message}`);
      // `created: false` (colisão de índice único) não acontece com source
      // 'automation' — o índice da 911 não alcança este insert. Quem barra
      // duplicata aqui é a checagem acima; o ramo fica pelo contrato de
      // createDeal.
      return criado.created ? 'deal created' : 'deal already existed';
    }

    case 'move_deal_stage':
    case 'set_deal_status': {
      const cfg = step.step_config as MoveDealStepConfig;
      const alvo = await negocioAlvo(db, args);
      if (!alvo) throw new Error('nenhum negócio aberto para este contato');

      const ehMover = step.step_type === 'move_deal_stage';
      if (ehMover && !cfg.stage_id)
        throw new Error('move_deal_stage precisa de etapa');
      if (!ehMover && !cfg.status)
        throw new Error('set_deal_status precisa de status');

      // ⚠️ Vai por RPC, e não por `.update()` direto, por DOIS motivos que se
      // somam: (1) a trilha da 912 exige que funil e etapa mudem no MESMO
      // update, senão ela grava que o lead saiu e voltou; (2) só de dentro da
      // transação dá para carimbar a cadeia que o trigger copia para o evento
      // — é ela que impede X→Y→X de girar para sempre.
      const { data, error } = await db.rpc('cb_atualizar_negocio', {
        p_deal_id: alvo,
        p_account_id: args.automation.account_id,
        p_pipeline_id: null,
        p_stage_id: ehMover ? cfg.stage_id : null,
        p_status: ehMover ? null : cfg.status,
        p_cadeia: cadeiaDoContexto(args),
      });
      if (error) throw new Error(`${step.step_type} falhou: ${error.message}`);
      const r = Array.isArray(data) ? data[0] : data;
      if (!r?.ok)
        throw new Error(
          `${step.step_type} recusado: ${r?.motivo ?? 'motivo desconhecido'}`
        );

      return ehMover
        ? `negócio movido para ${cfg.stage_id}`
        : `negócio marcado ${cfg.status}`;
    }

    // ------------------------------------------------------------
    // Orquestração (migration 936) — acionar e parar.
    //
    // Os quatro primeiros passam pela guarda anti-ciclo. Não é zelo
    // decorativo: "A aciona B, B aciona A" manda mensagem ao cliente a cada
    // volta, para sempre. O teto de profundidade foi recusado pelo operador
    // (esteira comercial longa é legítima), então a guarda é anti-ciclo —
    // ver `cadeia.ts`.
    // ------------------------------------------------------------

    case 'run_automation': {
      const cfg = step.step_config as AutomationRefStepConfig;
      if (!cfg.automation_id)
        throw new Error('run_automation precisa de uma automação');

      const passo = encadear(
        cadeiaDoContexto(args),
        chaveDeAutomacao(args.automation.id),
        chaveDeAutomacao(cfg.automation_id)
      );
      if (!passo.ok)
        throw new Error(`run_automation recusado: ${passo.motivo}`);

      const r = await runAutomationById({
        automationId: cfg.automation_id,
        accountId: args.automation.account_id,
        contactId: args.contactId,
        // A cadeia viaja no contexto porque é assim que ela atravessa o passo
        // "Aguardar" da automação acionada: o contexto inteiro vira JSONB em
        // `automation_pending_executions.context`. Sem isso, "aguardar 1 min e
        // acionar A" driblaria a guarda em toda volta.
        context: {
          ...args.context,
          vars: { ...(args.context.vars ?? {}), _cadeia: passo.cadeia },
        },
        triggerType: args.automation.trigger_type,
      });
      if (!r.ok) throw new Error(r.detail);
      return r.detail;
    }

    case 'stop_automation': {
      const cfg = step.step_config as AutomationRefStepConfig;
      if (!cfg.automation_id)
        throw new Error('stop_automation precisa de uma automação');
      if (!args.contactId)
        throw new Error('stop_automation precisa de um contato');

      // ⚠️ Recortado por CONTATO, sempre. Sem o `.eq('contact_id')` isto
      // cancelaria as esperas da automação alvo para a conta inteira: um
      // cliente entrando numa etapa apagaria o follow-up de 24h de todos os
      // outros, em silêncio e sem desfazer.
      const { data, error } = await db
        .from('automation_pending_executions')
        .update({ status: 'cancelled' })
        .eq('automation_id', cfg.automation_id)
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
        .eq('status', 'pending')
        .select('id, log_id');
      if (error) throw new Error(`stop_automation falhou: ${error.message}`);

      // A marca (1005): a execução parada não retoma pela continuação que
      // ainda não estava na fila.
      const execucoes = [
        ...new Set(
          (data ?? [])
            .map((l) => (l as { log_id?: string | null }).log_id)
            .filter((id): id is string => typeof id === 'string')
        ),
      ];
      await marcarExecucoesInterrompidas(db, execucoes, 'passo');

      // ⚠️ Segunda varredura por registro, DEPOIS da marca (Codex, 6ª rodada):
      // a irmã estacionada entre a foto do UPDATE acima e a marca não retoma
      // (a marca a barra), mas ficaria `pending` na aba até acordar. Depois da
      // marca ninguém mais insere, então isto pega tudo o que sobrou.
      let irmas = 0;
      if (execucoes.length > 0) {
        const { data: outras } = await db
          .from('automation_pending_executions')
          .update({ status: 'cancelled' })
          .in('log_id', execucoes)
          .eq('account_id', args.automation.account_id)
          .eq('contact_id', args.contactId)
          .eq('status', 'pending')
          .select('id');
        irmas = (outras ?? []).length;
      }

      const n = (data ?? []).length + irmas;
      return n === 0
        ? 'nada parado (nenhuma espera pendente)'
        : `${n} espera(s) cancelada(s)`;
    }

    case 'run_flow': {
      const cfg = step.step_config as RunFlowStepConfig;
      if (!cfg.flow_id) throw new Error('run_flow precisa de um robô');
      if (!args.contactId) throw new Error('run_flow precisa de um contato');

      const passo = encadear(
        cadeiaDoContexto(args),
        chaveDeAutomacao(args.automation.id),
        chaveDeFluxo(cfg.flow_id)
      );
      if (!passo.ok) throw new Error(`run_flow recusado: ${passo.motivo}`);

      const conversationId = await resolveConversationId(args);
      // ⚠️ Import DINÂMICO, e é load-bearing: `flows/engine` importa
      // `contacts/tag-events`, que importa ESTE módulo. Um import estático
      // fecharia o ciclo. (`parar-run.ts` foi separado justamente para não
      // precisar disto no caminho de parar.)
      const { startFlowForContact } = await import('@/lib/flows/engine');
      const r = await startFlowForContact({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        contactId: args.contactId,
        conversationId,
        flowId: cfg.flow_id,
        channelId: args.context.channel_id ?? null,
      });
      if (!r.ok) throw new Error(`run_flow falhou: ${r.detail}`);
      return r.detail;
    }

    case 'stop_flow': {
      if (!args.contactId) throw new Error('stop_flow precisa de um contato');
      const n = await abortActiveRunsForContact({
        db,
        accountId: args.automation.account_id,
        contactId: args.contactId,
        status: 'stopped_by_automation',
        reason: 'stopped_by_automation',
      });
      return n === 0 ? 'nenhum robô ativo' : 'robô parado';
    }

    case 'set_ai': {
      const cfg = step.step_config as SetAiStepConfig;
      const conversationId = await resolveConversationId(args);

      // Grupo está fora da IA por decisão de produto (906). Automação não
      // dispara em grupo hoje (garantia estrutural em `cb-groups/persist.ts`),
      // então isto é a segunda tranca — barata, e o dia em que a primeira cair
      // é justamente o dia em que ninguém vai lembrar desta regra.
      const { data: conv, error: convErr } = await db
        .from('conversations')
        .select('group_id')
        .eq('id', conversationId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle();
      if (convErr)
        throw new Error(`set_ai falhou ao ler a conversa: ${convErr.message}`);
      if (!conv) throw new Error('set_ai: conversa não encontrada nesta conta');
      if (conv.group_id)
        throw new Error('set_ai não vale em conversa de grupo');

      const update: Record<string, unknown> = {
        ai_autoreply_disabled: !cfg.enabled,
      };
      if (cfg.enabled) {
        // Espelha a rota manual: devolver o fio ao robô exige soltar QUALQUER
        // atribuição, não só a de quem clicou — a IA fica muda enquanto houver
        // humano atribuído, então um responsável esquecido faria "religar" ser
        // um nada silencioso.
        update.assigned_agent_id = null;
        // ⚠️ Zera o teto de respostas da IA nesta conversa, por decisão do
        // operador (D10). O comentário da rota manual dizia que isso era
        // "não-automatizável de propósito": o contador é o que impede o robô
        // de responder para sempre, e a lentidão humana era a proteção.
        // Automatizado, o teto passa a depender de quem monta a regra — "a
        // cada mensagem recebida, religar a IA" fura o teto para sempre.
        update.ai_reply_count = 0;
        update.ai_handoff_summary = null;
      }

      const { error: upErr } = await db
        .from('conversations')
        .update(update)
        .eq('id', conversationId)
        .eq('account_id', args.automation.account_id);
      if (upErr) throw new Error(`set_ai falhou: ${upErr.message}`);

      return cfg.enabled ? 'IA ligada na conversa' : 'IA desligada na conversa';
    }

    case 'send_media': {
      const cfg = step.step_config as SendMediaStepConfig;
      if (!args.contactId) throw new Error('send_media precisa de um contato');
      if (!cfg.url) throw new Error('send_media precisa de um arquivo');

      // ⚠️ ÁUDIO NÃO LEVA LEGENDA, e o dano é silencioso: a nota de voz sai por
      // `sendWhatsAppAudio`, que não tem campo de legenda. O texto seria
      // gravado em `messages.content_text`, apareceria no fio para a equipe e
      // NÃO viajaria ao cliente — a equipe leria uma conversa que o cliente
      // nunca teve. Mesma guarda da 932, aqui em terceiro lugar (banco, tela,
      // motor), porque a config pode ter sido gravada antes desta regra.
      const legenda =
        cfg.kind === 'audio'
          ? undefined
          : (await interpolate(cfg.caption ?? '', args)) || undefined;

      const conversationId = await resolveConversationId(args);
      const { whatsapp_message_id } = await engineSendMedia({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        kind: cfg.kind,
        link: cfg.url,
        caption: legenda,
        // Só documento; o WhatsApp ignora nos demais.
        filename: cfg.kind === 'document' ? cfg.filename : undefined,
        preferredChannelId: stepChannel(cfg, args),
      });
      return `${cfg.kind} enviado (${whatsapp_message_id})`;
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig;
      if (!cfg.url) throw new Error('send_webhook needs url');
      // SSRF guard: the URL and headers are account-controlled and the
      // server makes the request, so refuse any destination that resolves
      // to a private / loopback / link-local / reserved address. Mirrors
      // the webhook_endpoints delivery path (see lib/webhooks/deliver.ts).
      if (!(await isDeliverableUrl(cfg.url))) {
        throw new Error('send_webhook: destination not allowed');
      }
      // ⚠️ CRU: do outro lado há um sistema, não uma pessoa — ISO é o formato
      // que ele sabe ler, e trocá-lo quebraria integração já em pé.
      const body = cfg.body_template
        ? await interpolate(cfg.body_template, args, { cru: true })
        : JSON.stringify(args.context);
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
        // Do NOT follow redirects — a public URL could 3xx-bounce to an
        // internal address, defeating the guard above. Bound the request
        // so a hung/slow internal host can't tie up the runner.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      return `webhook ${res.status}`;
    }

    case 'send_to_number': {
      // Aviso para a EQUIPE (977): um número fixo, não o contato do disparo.
      //
      // ⚠️ Sai por `engineSendText`, como robô — e é isso que o mantém fora
      // do `routeContactToPipeline` e do reabrir: o número avisado ganha
      // ficha e conversa (é assim que a mensagem aparece no inbox), mas não
      // vira card no funil nem "conversa reaberta" a cada aviso.
      const cfg = step.step_config as SendToNumberStepConfig;
      // A mesma leitura do telefone do Calendly: "(83) 98874-5316" ganha o 55,
      // "+1 404…" entra como veio. Sem isso o número digitado sem DDI no
      // editor saía para um destino que não existe.
      const digitos = digitosDoTelefone(cfg.phone);
      if (!digitos) throw new Error('send_to_number: telefone inválido');
      const text = await interpolate(cfg.text ?? '', args);
      if (!text.trim()) throw new Error('send_to_number has empty text');
      const accountId = args.automation.account_id;

      const destino = await resolverDestinatario(
        db,
        accountId,
        digitos,
        cfg.contact_name
      );

      // ⚠️ A conexão escolhida tem de resolver DE FATO. `resolveEngineChannelPreferring`
      // cai no canal da conversa (e daí no padrão) quando a preferida não
      // resolve — para uma resposta ao cliente é a degradação certa; para
      // "avise o advogado pelo número X" seria a mensagem saindo pelo número
      // errado sem ninguém saber. Falha fechada.
      if (cfg.channel_id) {
        const canal = await resolveEngineChannelPreferring(
          db,
          accountId,
          destino.conversationId,
          cfg.channel_id
        );
        if (!canal || canal.channelId !== cfg.channel_id) {
          throw new Error(
            'send_to_number: a conexão escolhida não está disponível nesta conta'
          );
        }
      }

      const { whatsapp_message_id } = await engineSendText({
        accountId,
        userId: args.automation.user_id,
        conversationId: destino.conversationId,
        contactId: destino.contactId,
        text,
        preferredChannelId: cfg.channel_id ?? undefined,
      });
      return `sent to ${digitos} (${whatsapp_message_id})`;
    }

    case 'close_conversation': {
      if (!args.contactId)
        throw new Error('close_conversation needs a contact');
      // Encerrar SOLTA o responsável, como no cabeçalho do fio (regra do
      // operador, 2026-09-02): a atribuição dura até o encerramento, e quem
      // reabrir depois — cliente ou equipe — recebe a conversa sem dono
      // velho. Ver `src/lib/conversations/situacao.ts`.
      await db
        .from('conversations')
        .update({
          status: 'closed',
          assigned_agent_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId);
      return 'conversation closed';
    }

    // ------------------------------------------------------------
    // Abrir tarefa para a equipe.
    //
    // ⚠️ ESPELHA `POST /api/cb/tasks`, e as três razões daquela rota valem
    // aqui: `notifications` não tem policy de INSERT (só service-role
    // escreve), os nomes são CARIMBADOS no servidor (é o carimbo que faz a
    // autoria sobreviver à saída do membro) e o destinatário é conferido
    // contra a conta — sem isso, um `responsavel_user_id` gravado na config
    // encaminharia tarefa para gente de outro escritório.
    // ------------------------------------------------------------
    case 'create_task': {
      const cfg = step.step_config as CreateTaskStepConfig;
      if (!args.contactId) throw new Error('create_task precisa de um contato');
      if (!cfg.responsavel_user_id)
        throw new Error('create_task precisa de um responsável');

      const titulo = normalizarTitulo(
        await interpolate(cfg.titulo ?? '', args)
      );
      if (!titulo)
        throw new Error('create_task precisa de um título (1–200 caracteres)');
      const descricao = normalizarDescricao(
        await interpolate(cfg.descricao ?? '', args)
      );
      if (descricao === undefined)
        throw new Error('create_task: descrição longa demais');

      const hora = normalizarHora(cfg.hora);
      if (hora === undefined)
        throw new Error('create_task: hora deve ser HH:MM');

      // ⚠️ "Hoje" é o dia em BRASÍLIA, não no contêiner (que roda em UTC):
      // depois das 21h os dois discordam, e a tarefa nasceria com prazo de
      // amanhã sem ninguém ter pedido.
      const hoje = diaNoFuso(new Date(), FUSO_DO_ESCRITORIO);
      const vence_em = somarDias(hoje, Number(cfg.prazo_em_dias) || 0);

      // Uma consulta que responde duas coisas: o responsável é membro desta
      // conta? E quais nomes congelar nas colunas.
      const autorId = args.automation.user_id;
      const { data: perfis, error: erroPerfis } = await db
        .from('profiles')
        .select('user_id, full_name, email')
        .eq('account_id', args.automation.account_id)
        .in('user_id', [autorId, cfg.responsavel_user_id]);
      if (erroPerfis)
        throw new Error(
          `create_task: leitura de perfis falhou: ${erroPerfis.message}`
        );

      const nomeDe = (id: string): string | null => {
        const p = (perfis ?? []).find((x) => x.user_id === id);
        const nome = (p?.full_name as string | null)?.trim();
        return nome || ((p?.email as string | null) ?? null);
      };
      if (!(perfis ?? []).some((p) => p.user_id === cfg.responsavel_user_id)) {
        throw new Error('create_task: responsável não é membro desta conta');
      }

      const { data: tarefa, error: erroTarefa } = await db
        .from('cb_tasks')
        .insert({
          account_id: args.automation.account_id,
          contact_id: args.contactId,
          // O AUTOR da automação, que é quem o projeto usa como responsável
          // de registro em todo caminho sem gente na tela. Pode ser null se
          // ele já saiu — a coluna é ON DELETE SET NULL de qualquer forma.
          criador_user_id: autorId,
          responsavel_user_id: cfg.responsavel_user_id,
          criador_nome: nomeDe(autorId),
          responsavel_nome: nomeDe(cfg.responsavel_user_id),
          titulo,
          descricao,
          vence_em,
          vence_as: hora,
          importante: cfg.importante === true,
          tipo: 'tarefa',
        })
        .select('id')
        .single();
      if (erroTarefa)
        throw new Error(`create_task falhou: ${erroTarefa.message}`);

      // ⚠️ AVISA MESMO QUANDO O RESPONSÁVEL É O AUTOR DA AUTOMAÇÃO — e aqui
      // divergimos da rota de propósito. Lá o silêncio existe porque a pessoa
      // ACABOU de escrever a tarefa e não quer sino do próprio gesto; aqui
      // ela escreveu uma REGRA, possivelmente meses antes, e o aviso é o
      // ponto: é ele que diz que um contrato fechou agora.
      //
      // Best-effort, como na rota: perder o sino é chato, perder a tarefa que
      // a automação abriu é pior. O passo não falha por causa dele.
      const { error: erroSino } = await db.from('notifications').insert({
        account_id: args.automation.account_id,
        user_id: cfg.responsavel_user_id,
        type: 'task_assigned',
        // Nulo de propósito: a tela roteia por `task_id`; com
        // `conversation_id` o clique cairia no fio em vez da tarefa.
        contact_id: args.contactId,
        task_id: tarefa.id,
        actor_user_id: autorId,
        // Texto cru, sem dicionário — como o trigger da 027 e a rota.
        title: `A automação "${args.automation.name}" abriu uma tarefa para você`,
        body: titulo,
      });
      if (erroSino) {
        console.error(
          '[automations] create_task: aviso não saiu:',
          erroSino.message
        );
        return `tarefa criada (${tarefa.id}), sem aviso`;
      }
      return `tarefa criada (${tarefa.id})`;
    }

    default:
      return `unknown step: ${step.step_type}`;
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id;
  if (fromCtx) return fromCtx;
  if (!args.contactId)
    throw new Error('cannot resolve conversation: no contact');
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle();
  if (error) throw new Error(`conversation lookup failed: ${error.message}`);
  if (!data?.id) {
    const prefix =
      args.triggerEvent === 'tag_added'
        ? 'tag_added automation cannot send'
        : 'cannot send';
    throw new Error(`${prefix}: contact has no existing conversation`);
  }
  return data.id as string;
}

/**
 * A automação pode disparar no canal por onde este evento entrou?
 *
 * Sem este filtro, TODA automação ativa disparava em TODOS os números da
 * conta: o menu de triagem do número Comercial respondia também quem
 * escrevesse no WhatsApp pessoal do sócio — pelo próprio número dele. A
 * única saída do operador era desligar a automação inteira.
 *
 * Semântica de `channel_ids`:
 *   null/ausente -> todos os canais (comportamento pré-multi-canal)
 *   array vazio  -> tratado como "todos", porque o estado é inválido e
 *                   silenciar a automação seria pior que o excesso; a 903
 *                   impede que ele exista (normaliza para NULL + desativa)
 *   com valores  -> só os canais listados
 *
 * ⚠️ Contexto SEM canal (`channel_id` null/ausente) passa em qualquer
 * escopo — e desde a Fase 1 sobra POUCO caso. `tag_added` passou a carregar
 * canal (`canalDoContato`, em `src/lib/contacts/tag-events.ts`, resolve a
 * conversa mais recente do contato; fluxo e automação já trazem o canal da
 * run/do disparo), então automação de etiqueta restrita a um canal É filtrada
 * aqui — de propósito: antes o escopo era inerte nela, e a condição `channel`,
 * que falha FECHADA, dava sempre falso.
 *
 * O passe livre vale para o resíduo, e ele é real: contato sem nenhuma
 * conversa com canal, falha na busca do canal (best-effort, engolida com
 * warning), inbound anterior à 903 e o POST manual em `/api/automations/engine`.
 * Barrá-los faria a automação parar sem erro e sem log — regressão silenciosa
 * pior que o excesso de disparo.
 *
 * `conversation_assigned` e `time_based` não entram na lista: não têm call site
 * nenhum e saíram do seletor da tela (voltam com a caixa de saída da Fase 2 e
 * com o gatilho por data, respectivamente).
 */
export function channelInScope(
  automation: Automation,
  ctx: AutomationContext | undefined
): boolean {
  const escopo = automation.channel_ids;
  if (!escopo || escopo.length === 0) return true;
  const canal = ctx?.channel_id;
  if (!canal) return true;
  return escopo.includes(canal);
}

/**
 * A automação pode disparar para o negócio em que este contato está?
 *
 * Recorta os gatilhos EXISTENTES pelo estado do funil: "responda automático,
 * mas só para quem está na etapa Proposta". Sem isto, a única forma de
 * restringir por etapa seria uma condição no primeiro passo — que executa a
 * automação, escreve no log e só então descobre que não era para agir.
 *
 * ⚠️ Assíncrona, e de propósito: precisa perguntar ao banco em que etapa o
 * contato está. Por isso o dispatch só chama quando HÁ escopo (a maioria das
 * automações não tem), e uma vez por automação com escopo — não por passo.
 *
 * Semântica igual à do canal: escopo vazio/nulo = TODAS as etapas.
 *
 * ⚠️ Falha ABERTA, como `channelInScope`: sem contato, sem negócio ou com
 * erro na consulta, deixa passar. Barrar faria a automação parar sem erro e
 * sem log — o modo de falha que este projeto trata como o pior de todos.
 */
export async function stageInScope(
  db: ReturnType<typeof supabaseAdmin>,
  automation: Automation,
  contactId: string | null | undefined,
  ctx: AutomationContext | undefined
): Promise<boolean> {
  const escopo = automation.stage_ids;
  if (!escopo || escopo.length === 0) return true;

  // Gatilho de funil já traz a etapa no evento — não custa consulta nenhuma.
  if (ctx?.to_stage_id) return escopo.includes(ctx.to_stage_id);

  if (!contactId) return true;

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
    console.warn(
      '[automations] stageInScope: consulta falhou, deixando passar',
      error
    );
    return true;
  }
  // Contato sem negócio aberto NÃO está em etapa nenhuma. Aqui a resposta
  // honesta é não — diferente do erro acima, isto não é ignorância, é fato.
  if (!data?.stage_id) return false;
  return escopo.includes(data.stage_id as string);
}

/** Letter, digit or underscore in any script — the "inside a word" test. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * Whole-word keyword test, behind `match_type: 'word'` (issue #409 — a
 * one-letter keyword under `contains` fires on every message containing
 * that letter, e.g. "k" on "thanks").
 *
 * Deliberately NOT `\b`, which is defined against `[A-Za-z0-9_]` and so
 * breaks two cases that matter for WhatsApp traffic:
 *
 *   - A keyword carrying punctuation: `/\bhi!\b/` demands a word character
 *     after the "!", so it never matches "say hi!".
 *   - Any non-Latin script: every character of "안녕" is a non-word
 *     character to `\b`, so `/\b안녕\b/` matches nothing at all.
 *
 * Unicode-aware lookarounds handle both. Note this really is word-based:
 * it won't find "안녕" inside "안녕하세요", because a language that doesn't
 * delimit words with spaces has no word edge there. That's what `contains`
 * is for, and it stays the default.
 *
 * Exported for direct unit testing of the escaping / boundary edges.
 */
export function matchesWholeWord(
  text: string,
  keyword: string,
  caseSensitive = false
): boolean {
  if (!keyword) return false;
  // The keyword is account-supplied free text, so metacharacters have to
  // be literal — otherwise "(" is an unterminated group and RegExp throws.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu'
  );
  return pattern.test(text);
}

export function triggerMatches(
  automation: Automation,
  ctx: AutomationContext | undefined
): boolean {
  if (automation.trigger_type === 'keyword_match') {
    const cfg = automation.trigger_config as KeywordMatchTriggerConfig;
    if (!cfg?.keywords || cfg.keywords.length === 0) return false;
    const text = (ctx?.message_text ?? '').toString();
    if (!text) return false;
    if (cfg.match_type === 'word') {
      return cfg.keywords.some((raw) =>
        matchesWholeWord(text, raw, cfg.case_sensitive)
      );
    }
    const haystack = cfg.case_sensitive ? text : text.toLowerCase();
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase();
      return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k);
    });
  }

  // Match on the tapped button / list-row id (exact). Lets multi-step
  // menus be chained: automation A sends buttons, automation B fires on
  // the reply id and sends the next step.
  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig;
    const replyId = ctx?.interactive_reply_id;
    if (
      !replyId ||
      !Array.isArray(cfg?.reply_ids) ||
      cfg.reply_ids.length === 0
    ) {
      return false;
    }
    return cfg.reply_ids.includes(replyId);
  }

  if (automation.trigger_type === 'tag_added') {
    const cfg = automation.trigger_config as TagTriggerConfig;
    const tagId = ctx?.tag_id;
    return Boolean(tagId && cfg?.tag_id && cfg.tag_id === tagId);
  }

  // Card entrou numa etapa — movido OU criado nela (933).
  //
  // ⚠️ Config vazia = QUALQUER etapa, igual ao resto do projeto. É o que faz
  // "toda vez que um card se mexer" ser exprimível sem listar as 9 etapas.
  if (automation.trigger_type === 'deal_stage_changed') {
    const cfg = automation.trigger_config as DealStageTriggerConfig;
    const alvo = ctx?.to_stage_id;
    if (!Array.isArray(cfg?.stage_ids) || cfg.stage_ids.length === 0)
      return true;
    // Sem etapa no contexto não há como afirmar que é ESTA etapa. Falha
    // fechada, ao contrário do escopo: aqui a pergunta é "entrou na etapa X?",
    // e a resposta honesta para um disparo sem etapa é não.
    return Boolean(alvo && cfg.stage_ids.includes(alvo));
  }

  if (automation.trigger_type === 'deal_status_changed') {
    const cfg = automation.trigger_config as DealStatusTriggerConfig;
    const alvo = ctx?.to_status;
    if (!Array.isArray(cfg?.statuses) || cfg.statuses.length === 0) return true;
    return Boolean(alvo && cfg.statuses.includes(alvo));
  }

  // Lembrete por data (935/947): SÓ a automação carimbada no contexto.
  //
  // ⚠️ Fail closed, ao contrário do `return true` final. Nos outros gatilhos o
  // contexto carrega o EVENTO (palavra, tag, etapa) e cada automação decide se
  // ele lhe diz respeito; aqui o evento é "a janela DESTA automação venceu
  // para este contato" — decidido pela varredura, fora do motor. Sem o caso, o
  // dispatch por tipo abria o leque: o alvo de um lembrete executava todos os
  // lembretes da conta (o de 48h saía junto com o de 24h, e a trava
  // anti-repetição, que é da varredura, não via nada). Dispatch manual
  // (`POST /api/automations/engine`) sem `automation_id` no contexto não roda
  // lembrete nenhum — e é o certo: rodar "todos, agora" ignoraria as datas.
  if (automation.trigger_type === 'date_field_offset') {
    return ctx?.automation_id === automation.id;
  }

  // Agendamento no Calendly (977): config vazia = qualquer evento, como o
  // gatilho de funil. Com URI, só aquele tipo de evento — e um disparo sem
  // URI no contexto falha fechado, pela mesma razão da etapa: "foi ESTE
  // evento?" não tem resposta honesta sem saber qual foi.
  if (automation.trigger_type === 'calendly_booking') {
    const cfg = automation.trigger_config as CalendlyTriggerConfig;
    const alvo =
      typeof cfg?.event_type_uri === 'string' ? cfg.event_type_uri.trim() : '';
    if (!alvo) return true;
    return Boolean(
      ctx?.calendly_event_type && ctx.calendly_event_type === alvo
    );
  }

  // Webhook de entrada (982): mesma forma do Calendly acima. Config vazia =
  // qualquer webhook da conta; com id, só aquele — e um disparo sem
  // `webhook_id` no contexto falha fechado.
  //
  // ⚠️ Sem este ramo o `return true` abaixo faria TODO acionamento disparar
  // TODA automação deste gatilho, e a falha seria silenciosa: nada estoura,
  // a automação do webhook A responde ao webhook B.
  if (automation.trigger_type === 'webhook_received') {
    const cfg = automation.trigger_config as WebhookTriggerConfig;
    const alvo =
      typeof cfg?.webhook_id === 'string' ? cfg.webhook_id.trim() : '';
    if (!alvo) return true;
    return Boolean(ctx?.webhook_id && ctx.webhook_id === alvo);
  }

  // A régua do Asaas (998): SÓ a automação carimbada no contexto, como o
  // lembrete por data — o "aconteceu?" é decidido pela varredura, fora do
  // motor, e o dispatch por tipo abriria o leque (a de 5 dias sairia junto
  // com a de 1). Disparo manual sem `automation_id` não roda nenhuma.
  if (ehGatilhoDaRegua(automation.trigger_type)) {
    return ctx?.automation_id === automation.id;
  }

  return true;
}

async function evaluateCondition(
  cfg: ConditionStepConfig,
  args: ExecuteArgs
): Promise<boolean> {
  const db = supabaseAdmin();
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false;
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand);
      return (count ?? 0) > 0;
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false;
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle();
      const v = (data as Record<string, unknown> | null)?.[cfg.operand];
      return v != null && String(v) === String(cfg.value ?? '');
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString();
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase());
    }
    case 'channel': {
      // Ramifica pelo número por onde o cliente escreveu, dentro de UMA
      // automação — sem isso, "se veio pelo Comercial faça X, senão Y" exigia
      // duplicar a automação inteira. Contexto sem canal é FALSE (e não true
      // como no filtro de escopo): aqui a pergunta é "é ESTE canal?", e a
      // resposta honesta para um disparo sem canal é não.
      return (
        Boolean(args.context.channel_id) &&
        args.context.channel_id === (cfg.operand ?? cfg.value ?? null)
      );
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-');
      if (!from || !to) return false;
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const f = parse(from);
      const t = parse(to);
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t;
    }
    /**
     * O negócio está NESTA etapa AGORA? (934)
     *
     * ⚠️ Lê o banco, não o contexto — e é essa a razão de existir. O padrão
     * central do print do Kommo é "movido para a etapa DEPOIS DE 240 horas →
     * agir", que aqui se escreve gatilho de etapa → `wait` → esta condição →
     * ação. Sem ela, o `wait` acordaria e agiria às cegas sobre um card que o
     * operador já moveu nesse meio-tempo — mandando ao cliente a cobrança de
     * uma proposta que ele já aceitou.
     *
     * `operand` guarda a etapa, como na condição de canal.
     */
    case 'deal_stage': {
      const alvo = cfg.operand ?? cfg.value;
      if (!alvo) return false;
      const deal = await negocioAtualDoContexto(args);
      return deal?.stage_id === alvo;
    }
    /** O negócio está ganho/perdido/aberto AGORA? Mesma leitura fresca. */
    case 'deal_status': {
      const alvo = cfg.operand ?? cfg.value;
      if (!alvo) return false;
      const deal = await negocioAtualDoContexto(args);
      return deal?.status === alvo;
    }
    default:
      return false;
  }
}

/**
 * O estado ATUAL do negócio deste disparo — lido agora, não o do contexto.
 *
 * ⚠️ O contexto guarda `to_stage_id`, que é onde o card estava quando o evento
 * nasceu. Depois de um `wait` de 240 horas isso é história, não fato. Estas
 * condições existem justamente para perguntar ao banco.
 */
async function negocioAtualDoContexto(
  args: ExecuteArgs
): Promise<{ stage_id: string; status: string } | null> {
  const db = supabaseAdmin();
  const id = await negocioAlvo(db, args);
  if (!id) return null;
  const { data, error } = await db
    .from('deals')
    .select('stage_id, status')
    .eq('id', id)
    .eq('account_id', args.automation.account_id)
    .maybeSingle();
  if (error) {
    console.warn(
      '[automations] condição de funil: leitura do negócio falhou',
      error
    );
    return null;
  }
  return (data as { stage_id: string; status: string } | null) ?? null;
}

/**
 * Canal de SAIDA deste passo. Precedencia deliberada:
 *   1. `cfg.channel_id` — escolha explicita do operador naquele passo
 *      ("a confirmacao formal sai SEMPRE pelo numero oficial");
 *   2. `context.channel_id` — o canal do DISPARO, nao o atual da conversa.
 *      E o que faz o follow-up de 24h voltar pelo numero por onde o cliente
 *      escreveu, e nao pelo que ele usou no meio-tempo;
 *   3. undefined — o sender cai no canal atual da conversa (comportamento
 *      de antes do multi-canal).
 */
function stepChannel(
  cfg: { channel_id?: string | null } | null | undefined,
  args: ExecuteArgs
): string | null | undefined {
  return cfg?.channel_id ?? args.context.channel_id ?? undefined;
}

/**
 * Qual negócio esta ação vai mexer.
 *
 * ⚠️ O contexto vence sempre. Num gatilho de funil o evento carrega o card
 * EXATO que se moveu — e é o único jeito de acertar quando o contato tem mais
 * de um negócio aberto (o CRM permite; só a 911 garante unicidade para card
 * nascido de conexão).
 *
 * Sem card no contexto (ex.: "quando chegar mensagem → mova o card"), a regra
 * é o negócio ABERTO mais recente (D8). Fechado fica de fora de propósito:
 * mexer sozinho num negócio que alguém deu por encerrado é surpresa ruim.
 */
async function negocioAlvo(
  db: ReturnType<typeof supabaseAdmin>,
  args: ExecuteArgs
): Promise<string | null> {
  if (args.context.deal_id) return args.context.deal_id;
  if (!args.contactId) return null;
  const { data, error } = await db
    .from('deals')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`busca do negócio falhou: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

/**
 * A cadeia deste encadeamento, para repassar ao banco.
 *
 * Quem a ACRESCENTA é o drenador (`drain-events.ts`), ao entregar o evento —
 * um lugar só, senão as duas pontas divergem e a guarda anti-ciclo passa a
 * depender de qual delas escreveu. Aqui ela só é lida e devolvida.
 *
 * Vazia = ação de gente ou de conexão: cadeia nova, nada a barrar.
 */
function cadeiaDoContexto(args: ExecuteArgs): string[] {
  return lerCadeia(args.context.vars);
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs =
    cfg.unit === 'days'
      ? 86_400_000
      : cfg.unit === 'hours'
        ? 3_600_000
        : cfg.unit === 'seconds'
          ? 1_000
          : 60_000;
  return Math.max(1_000, cfg.amount * unitMs);
}

// ------------------------------------------------------------
// Variáveis de texto — `{{ns.prop}}` em mensagem, campo, legenda, webhook.
//
// Namespaces:
//   message.text, vars.<nome>, channel.id — do CONTEXTO do disparo (baratos);
//   contact.name|phone|email|company|link, contact.campo.<chave_do_campo>,
//   contact.origem, conversation.link — do CONTATO, carregados do banco (977).
//
// ⚠️ O contato é carregado UMA vez por execução (WeakMap por `args`) e SÓ
// quando o texto cita `contact.`/`conversation.`: sem a guarda, todo
// `send_message` pagaria três consultas para nada. `contact.campo.<chave>`
// usa a `field_key` (a chave estável do catálogo, 948), não o nome exibido.
// Os links saem de `NEXT_PUBLIC_SITE_URL`; sem ela, caminho relativo.
// ------------------------------------------------------------

interface DadosDoContato {
  contato: {
    name: string;
    phone: string;
    email: string;
    company: string;
  } | null;
  /**
   * Para texto que GENTE lê: campo de data já formatado ("30/08/2026 às
   * 16:00h").
   */
  campos: Record<string, string>;
  /**
   * ⚠️ O MESMO campo, exatamente como está guardado — e existe porque duas
   * saídas de `interpolate` não são texto para gente: `update_contact_field`
   * ESCREVE no banco e `send_webhook` manda para uma máquina.
   *
   * Copiar um campo de data para outro com o valor formatado deixaria o
   * destino ilegível para o `<input type="datetime-local">` e, pior, para a
   * varredura de lembretes: `cb_para_timestamp('30/08/2026 às 16:00h')`
   * devolve NULL, e o lembrete simplesmente NUNCA sai — sem erro em lugar
   * nenhum. E um consumidor de webhook que esperava ISO passaria a receber
   * data em português. Achado do Codex no PR #152.
   */
  camposCru: Record<string, string>;
  conversationId: string | null;
}

const dadosPorExecucao = new WeakMap<ExecuteArgs, Promise<DadosDoContato>>();

function dadosDoContato(args: ExecuteArgs): Promise<DadosDoContato> {
  let p = dadosPorExecucao.get(args);
  if (!p) {
    p = carregarDadosDoContato(args);
    dadosPorExecucao.set(args, p);
  }
  return p;
}

async function carregarDadosDoContato(
  args: ExecuteArgs
): Promise<DadosDoContato> {
  const conversaDoContexto = args.context.conversation_id ?? null;
  if (!args.contactId)
    return {
      contato: null,
      campos: {},
      camposCru: {},
      conversationId: conversaDoContexto,
    };
  const db = supabaseAdmin();
  const accountId = args.automation.account_id;
  const [contato, valores, conversa] = await Promise.all([
    db
      .from('contacts')
      .select('name, phone, email, company')
      .eq('id', args.contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
    // `contact_custom_values` não tem `account_id`: a conta vem pelo campo.
    // `field_type` vem junto porque campo de DATA guarda ISO em UTC e não
    // pode sair assim numa mensagem — ver a formatação logo abaixo.
    db
      .from('contact_custom_values')
      .select('value, custom_fields(field_key, field_type, account_id)')
      .eq('contact_id', args.contactId),
    conversaDoContexto
      ? Promise.resolve({ data: null })
      : db
          .from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', args.contactId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
  ]);

  const campos: Record<string, string> = {};
  const camposCru: Record<string, string> = {};
  for (const linha of (valores.data ?? []) as Array<{
    value: string | null;
    custom_fields: {
      field_key?: string;
      field_type?: string;
      account_id?: string;
    } | null;
  }>) {
    const def = linha.custom_fields;
    if (!def?.field_key || def.account_id !== accountId) continue;
    const bruto = linha.value ?? '';
    camposCru[def.field_key] = bruto;
    // ⚠️ EM TEXTO PARA GENTE, campo de data sai FORMATADO. A coluna guarda
    // ISO em UTC (`campo-data.ts`), então o valor cru numa mensagem chega ao
    // cliente como "2026-08-30T19:00:00.000Z" — e, pior que feio, com a hora
    // errada por três horas para quem souber lê-lo. Lixo no campo (é TEXT
    // livre) cai no `|| bruto`: melhor o que a pessoa digitou do que nada.
    campos[def.field_key] =
      def.field_type === TIPO_DATA
        ? formatarParaMensagem(bruto) || bruto
        : bruto;
  }
  const c = contato.data as {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
  } | null;
  return {
    contato: c
      ? {
          name: c.name ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          company: c.company ?? '',
        }
      : null,
    campos,
    camposCru,
    conversationId:
      conversaDoContexto ??
      (conversa.data as { id?: string } | null)?.id ??
      null,
  };
}

/** URL absoluta no CRM quando `NEXT_PUBLIC_SITE_URL` existe; senão o caminho. */
function linkDoCrm(caminho: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}${caminho}` : caminho;
}

const RE_VARIAVEL = /\{\{\s*([\w.]+)\s*\}\}/g;
const RE_CITA_CONTATO = /\{\{\s*(contact|conversation)\./;

/**
 * ⚠️ `cru: true` para as saídas que NÃO são texto para gente —
 * `update_contact_field` (escreve no banco) e `send_webhook` (fala com uma
 * máquina). Só o campo de DATA difere entre os dois modos, e a diferença
 * importa: formatado, o valor copiado para outro campo de data fica ilegível
 * para a tela e invisível para a varredura de lembretes.
 */
async function interpolate(
  s: string,
  args: ExecuteArgs,
  opcoes: { cru?: boolean } = {}
): Promise<string> {
  if (!s) return '';
  const dados = RE_CITA_CONTATO.test(s) ? await dadosDoContato(args) : null;
  return s.replace(RE_VARIAVEL, (_, key) => {
    const partes = String(key).split('.');
    const [ns, prop] = partes;
    if (ns === 'message' && prop === 'text')
      return String(args.context.message_text ?? '');
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '');
    // `{{channel.id}}` no corpo de um send_webhook faz o sistema externo
    // saber por qual número o cliente falou, sem depender do webhook nativo.
    if (ns === 'channel' && prop === 'id')
      return String(args.context.channel_id ?? '');
    if (ns === 'contact' && dados) {
      if (prop === 'campo') {
        const chave = partes.slice(2).join('.');
        return (opcoes.cru ? dados.camposCru : dados.campos)[chave] ?? '';
      }
      // "Campanha - Conjunto - Anúncio" dos campos de traqueamento da 949,
      // SÓ as partes preenchidas: escrito com três `contact.campo.*` no
      // texto, um contato sem anúncio saía como " -  - " (medido no
      // primeiro aviso real, 07/09).
      if (prop === 'origem') {
        return [
          dados.campos.nome_da_campanha,
          dados.campos.nome_do_conjunto,
          dados.campos.nome_do_anuncio,
        ]
          .map((v) => (v ?? '').trim())
          .filter(Boolean)
          .join(' - ');
      }
      if (prop === 'link')
        return args.contactId
          ? linkDoCrm(`/contacts?contact=${args.contactId}`)
          : '';
      if (
        prop === 'name' ||
        prop === 'phone' ||
        prop === 'email' ||
        prop === 'company'
      ) {
        return dados.contato?.[prop] ?? '';
      }
      return '';
    }
    if (ns === 'conversation' && prop === 'link' && dados) {
      return dados.conversationId
        ? linkDoCrm(urlDoInbox({ c: dados.conversationId }))
        : '';
    }
    return '';
  });
}

/**
 * Acumula os passos na coluna e devolve o HISTÓRICO COMPLETO da execução.
 *
 * ⚠️ Devolver o mesclado não é conveniência: é o que permite ao escopo raiz
 * saber o que aconteceu ANTES de um "Aguardar" sem pagar uma segunda leitura
 * — esta função já lê a linha para mesclar. Ver `sinaisDoHistorico`.
 */
async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null
): Promise<AutomationLogStepResult[]> {
  if (!logId) return newItems;
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single();
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ??
      []),
    ...newItems,
  ];
  const update: Record<string, unknown> = { steps_executed: merged };
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status;
  }
  if (errorMessage) update.error_message = errorMessage;
  await db.from('automation_logs').update(update).eq('id', logId);
  return merged;
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null
) {
  if (!logId) return;
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId);
}

/**
 * Grava o DESFECHO da execução (985) — o ÚNICO escritor de
 * `automation_logs.desfecho` / `finalizado_em`.
 *
 * ⚠️ A guarda é "não sobrou espera VIVA deste log". Sem ela, uma automação com
 * "Aguardar" seria fechada como concluída no instante em que o escopo de fora
 * termina — e o follow-up de no-show, que tem nove esperas pela frente,
 * apareceria no fio como "concluiu" na primeira mensagem. Ela também resolve o
 * caso que os três juízes do desenho apontaram: a espera nascida DENTRO de um
 * ramo, cujo escopo de fora termina sem saber que o ramo continua.
 *
 * ⚠️ Consulta da guarda que FALHA não fecha o log. Fechar às cegas afirmaria
 * "terminou" sobre execução que pode ter mensagem por sair; não fechar deixa a
 * execução sem desfecho, que a tela trata como "não sei" e simplesmente não
 * mostra. Entre afirmar errado e calar, cala.
 *
 * Nunca lança: é a última coisa que roda numa execução, e derrubá-la aqui
 * transformaria uma automação bem-sucedida em erro no log.
 */
/**
 * Os sinais de trabalho/barreira do que JÁ está gravado neste log.
 *
 * Uma consulta, e só nos dois fechamentos que não têm o histórico em mão — o
 * escopo raiz sem passos e a retomada de ramo. O fechamento normal do escopo
 * raiz não passa por aqui: `appendResults` já devolve o mesclado de graça.
 *
 * ⚠️ Leitura que falha responde "nada consta", não estoura: é o mesmo trato
 * do resto do fechamento — entre afirmar errado e calar, cala. O preço é
 * cair no `concluida`, que é o desfecho menos alarmante dos três.
 */
async function sinaisGravados(
  logId: string | null
): Promise<{ fezTrabalho: boolean; barrouPorCondicao: boolean }> {
  const vazio = { fezTrabalho: false, barrouPorCondicao: false };
  if (!logId) return vazio;
  try {
    const { data, error } = await supabaseAdmin()
      .from('automation_logs')
      .select('steps_executed')
      .eq('id', logId)
      .maybeSingle();
    if (error) {
      console.error('[automations] sinaisGravados falhou:', error.message);
      return vazio;
    }
    return sinaisDoHistorico(data?.steps_executed);
  } catch (err) {
    console.error('[automations] sinaisGravados estourou:', err);
    return vazio;
  }
}

async function fecharLog(
  logId: string | null,
  desfecho: Desfecho,
  esperaEmCurso?: string | null
): Promise<void> {
  if (!logId) return;
  try {
    const db = supabaseAdmin();
    let consulta = db
      .from('automation_pending_executions')
      .select('id')
      .eq('log_id', logId)
      .in('status', ['pending', 'running']);
    // A espera que o cron acabou de reivindicar está `running` e é ESTA
    // execução — contá-la como "ainda vai rodar" trava o fechamento para
    // sempre.
    if (esperaEmCurso) consulta = consulta.neq('id', esperaEmCurso);
    const { data: vivas, error } = await consulta.limit(1);

    if (error) {
      console.error(
        '[automations] fecharLog: guarda de espera falhou:',
        error.message
      );
      return;
    }
    const aindaCorre = Boolean(vivas && vivas.length > 0);

    // ⚠️⚠️ O DESFECHO É GRAVADO SEMPRE; o que a espera viva adia é só o
    // `finalizado_em`. Antes esta função DESCARTAVA o desfecho quando havia
    // espera viva — e o 'falhou' de um escopo cujo ramo continuava era perdido
    // para sempre: horas depois o resume daquele ramo gravava 'concluida', e a
    // tela mostrava "concluiu" sobre uma execução em que a mensagem NÃO saiu.
    // Sinal invertido, exatamente a mentira que a 985 existe para matar
    // (achado da revisão adversarial, 09/09).
    //
    // ⚠️⚠️ SÃO DUAS ESCRITAS, e separá-las é o conserto do buraco que a
    // primeira versão desta cerca abriu (Codex, PR #155). O filtro
    // anti-regressão recusa a LINHA INTEIRA quando o log já diz 'falhou' —
    // então ele descartava junto o `finalizado_em` que vinha no mesmo update.
    // A régua do fio exige as DUAS colunas (`itensDoFio` descarta linha sem
    // hora de fim), logo: ramo que estoura enquanto a espera irmã segue viva,
    // e depois uma retomada que termina bem, deixava a execução SEM hora de
    // fim e invisível no fio e no histórico — sumia justamente o cartão de
    // falha, que é o que a 985 existe para mostrar.
    //
    // 1) O desfecho, com a cerca. NUNCA REGREDIR: falha registrada não vira
    //    conclusão. Duas esperas irmãs (dois ramos parados) resolvem em ordem
    //    imprevisível, e a que termina bem não pode apagar a que estourou.
    //    `falhou` grava sem filtro porque é o pior desfecho — sempre pode
    //    sobrescrever os outros.
    let update = db
      .from('automation_logs')
      .update({ desfecho })
      .eq('id', logId);
    if (desfecho !== 'falhou') {
      update = update.or('desfecho.is.null,desfecho.neq.falhou');
    }
    const { error: erroDesfecho } = await update;
    if (erroDesfecho) {
      console.error(
        '[automations] fecharLog: desfecho falhou:',
        erroDesfecho.message
      );
    }

    // 2) A hora de fim, SEM cerca — ela não regride nada, só PUBLICA o que
    //    já está gravado. Vai depois de propósito: entre as duas escritas a
    //    linha tem desfecho e não tem hora, e a régua do fio simplesmente não
    //    a mostra ainda. O inverso (publicar antes de decidir) exibiria por um
    //    instante o desfecho da execução anterior.
    if (!aindaCorre) {
      const { error: erroFim } = await db
        .from('automation_logs')
        .update({ finalizado_em: new Date().toISOString() })
        .eq('id', logId);
      if (erroFim) {
        console.error(
          '[automations] fecharLog: hora de fim falhou:',
          erroFim.message
        );
      }
    }
  } catch (err) {
    console.error('[automations] fecharLog estourou:', err);
  }
}

async function markPending(
  id: string,
  status: 'done' | 'failed' | 'cancelled'
) {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id);
}
