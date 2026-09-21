import type { SupabaseClient } from "@supabase/supabase-js";

import type { DateFieldTriggerConfig } from "@/types";

import { TETO_DE_PROCESSAMENTO_MS } from "./claim";
import type { ProcessamentoDoAgendamento } from "./processar";
import { EVENTO_AGENDADO, type Cancelamento } from "./payload";

// ------------------------------------------------------------
// Reunião CANCELADA no Calendly (1013): desarmar os lembretes.
//
// O problema medido em 20/09/2026: o CRM só assinava `invitee.created`, então
// o cancelamento era invisível. A data continuava no campo do contato, o card
// continuava em "Reunião Agendada", e a varredura de lembretes (que pergunta
// só a data) mandava os quatro avisos de uma reunião que não vai acontecer.
//
// ⚠️⚠️ O DESARME NÃO APAGA A DATA DA FICHA. Ele PRÉ-ARMA a trava da 935 —
// `cb_automation_reminders (automation_id, contact_id, valor)` —, que é o
// mecanismo que aquela migration criou para dizer "este lembrete está
// resolvido, não mande". Três razões para não apagar o campo:
//   1. a ficha perderia a informação de que havia reunião às 14h;
//   2. exigiria adivinhar QUAL campo guarda a data (não há um canônico);
//   3. o campo é lido por outras regras, e apagá-lo mexe nelas em silêncio.
// A trava leva `motivo: 'cancelamento'` para não mentir: `disparado_em`
// preenchido sem envio seria lido como "o cliente recebeu".
// ------------------------------------------------------------

/**
 * O valor gravado na ficha ainda aponta para a reunião que foi cancelada?
 *
 * ⚠️ É a guarda contra o REAGENDAMENTO processado fora de ordem. O Calendly
 * manda `invitee.canceled` (do antigo) e `invitee.created` (do novo) sem
 * ordem garantida: se o novo chegou primeiro, o campo já tem o horário NOVO,
 * e desarmar aqui deixaria o cliente sem lembrete de uma reunião que existe.
 * Comparação por INSTANTE, porque as duas pontas escrevem ISO com formatos
 * diferentes ("…Z" e "…+00:00"); igualdade de texto fica como queda.
 *
 * ⚠️ Falha para o lado de NÃO desarmar: valor em formato que não parseia
 * (ou sem fuso) não casa, e o lembrete sai. É o lado escolhido — desarmar
 * por engano cala um aviso legítimo, e isso ninguém percebe.
 */
export function mesmaReuniao(valor: string | null | undefined, inicio: string | null): boolean {
  if (!valor || !inicio) return false;
  const a = Date.parse(valor);
  const b = Date.parse(inicio);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return valor.trim() === inicio.trim();
}

/** O campo de data que um gatilho de lembrete observa, ou null. */
export function campoDoLembrete(triggerConfig: unknown): string | null {
  const cfg = (triggerConfig ?? {}) as DateFieldTriggerConfig;
  // `fonte: 'reuniao'` lê `cb_meetings.starts_at`, não campo do contato — e
  // ali o cancelamento é outro caminho (a reunião muda de status).
  if ((cfg.fonte ?? "campo") !== "campo") return null;
  return typeof cfg.custom_field_id === "string" && cfg.custom_field_id.trim() !== ""
    ? cfg.custom_field_id
    : null;
}

const ignorado = (detalhe: string, contactId: string | null = null): ProcessamentoDoAgendamento => ({
  resultado: "ignorado",
  detalhe,
  contactId,
});

/**
 * Nunca lança: é chamado do `after()` do webhook, como o processamento do
 * agendamento. Devolve o mesmo formato, para `gravarResultado` servir aos
 * dois caminhos.
 */
export interface OpcoesDoCancelamento {
  /** Quanto tempo, no total, esperar o agendamento terminar de ser processado. */
  tetoDeEsperaMs?: number;
  /** Injetável para o teste não dormir de verdade. */
  esperar?: (ms: number) => Promise<void>;
}

const ESPERA_ENTRE_LEITURAS_MS = 5_000;

/**
 * ⚠️⚠️ O orçamento de espera é o TETO DO AGENDAMENTO, derivado e não
 * digitado (Codex, PR #235, duas rodadas). O processamento MEDIDO leva 1,4 a
 * 3,5 s, mas `comTetoDeProcessamento` permite que ele vá até 4 min: parar
 * antes disso deixa um vão em que o agendamento AINDA VAI gravar o contato e
 * a data, e o cancelamento já terá desistido. E desistir aqui é DEFINITIVO —
 * a linha do cancelamento existe, então a reentrega do Calendly não tenta de
 * novo. Duas versões erraram por digitar o número (10 s, depois 2 min); o
 * valor agora acompanha a constante.
 */
const TETO_DE_ESPERA_MS = TETO_DE_PROCESSAMENTO_MS;

/**
 * O teto do PRÓPRIO cancelamento, que a rota passa a `comTetoDeProcessamento`.
 *
 * ⚠️ Tem de ser MAIOR que a espera acima (senão o cancelamento se corta
 * esperando) e MENOR que `RECOLHER_CLAIM_MS` (senão "cadeado velho" deixa de
 * significar "dono morto"). Há teste cobrando as duas margens.
 */
export const TETO_DO_CANCELAMENTO_MS = TETO_DE_ESPERA_MS + 60_000;

export async function processarCancelamento(
  db: SupabaseClient,
  accountId: string,
  c: Cancelamento,
  opcoes: OpcoesDoCancelamento = {},
): Promise<ProcessamentoDoAgendamento> {
  // ⚠️ Reagendamento NÃO tem porta própria aqui — quem decide é
  // `mesmaReuniao`, mais abaixo. O porquê está escrito lá.
  if (!c.inicio) {
    return ignorado("o cancelamento não trouxe o horário da reunião");
  }

  // De quem era o agendamento: a linha do `invitee.created` do MESMO invitee
  // já resolveu o contato. Não se refaz a busca por telefone — ela pode dar
  // outro resultado hoje, e o desarme tem de valer para quem recebeu o
  // agendamento, não para quem o telefone acharia agora.
  // ⚠️⚠️ O AGENDAMENTO PODE AINDA ESTAR SENDO PROCESSADO. A rota responde 200
  // ao Calendly e processa em `after()` (criar ficha, disparar automação):
  // quem marca e cancela em seguida chega aqui com `contact_id` ainda nulo, e
  // desistir nesse instante deixaria os lembretes ARMADOS — a linha do
  // cancelamento já existe, então a reentrega do Calendly não tenta de novo.
  // Medido em produção: o processamento leva 1,4 a 3,5 s — mas o teto dele é
  // de 4 min, e o orçamento daqui acompanha essa constante, não um número
  // digitado (Codex, PR #235, duas rodadas). Relê até o agendamento sair do
  // processamento ou o orçamento acabar.
  const teto = opcoes.tetoDeEsperaMs ?? TETO_DE_ESPERA_MS;
  const tentativas = Math.max(1, Math.ceil(teto / ESPERA_ENTRE_LEITURAS_MS));
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let contactId: string | null = null;
  let aindaProcessando = false;
  for (let i = 0; i < tentativas; i += 1) {
    const { data: original, error: erroOriginal } = await db
      .from("cb_calendly_eventos")
      .select("contact_id, resultado, processando_desde")
      .eq("account_id", accountId)
      .eq("evento", EVENTO_AGENDADO)
      .eq("invitee_uri", c.inviteeUri)
      .maybeSingle();
    if (erroOriginal) {
      return { resultado: "falhou", detalhe: `leitura do agendamento original falhou: ${erroOriginal.message}`, contactId: null };
    }
    contactId = (original?.contact_id as string | null) ?? null;
    if (contactId) break;
    // Só espera enquanto houver por que esperar: linha em processamento (ou
    // ainda sem desfecho). Agendamento já finalizado SEM contato não muda.
    aindaProcessando =
      !!original &&
      (original.processando_desde != null || original.resultado === "recebido");
    if (!aindaProcessando || i === tentativas - 1) break;
    await esperar(ESPERA_ENTRE_LEITURAS_MS);
  }
  if (!contactId) {
    return ignorado(
      aindaProcessando
        ? "o agendamento ainda estava sendo processado e não tinha contato — os lembretes podem ter ficado armados"
        : "o agendamento cancelado não tem contato no log",
    );
  }

  // ⚠️ TODAS as automações de lembrete da conta, LIGADAS OU NÃO. Uma
  // desligada hoje pode ser ligada amanhã, antes do horário da reunião — e
  // aí a trava que faltou deixaria sair o aviso de um evento cancelado.
  const { data: autos, error: erroAuto } = await db
    .from("automations")
    .select("id, trigger_config")
    .eq("account_id", accountId)
    .eq("trigger_type", "date_field_offset");
  if (erroAuto) {
    return { resultado: "falhou", detalhe: `leitura dos lembretes falhou: ${erroAuto.message}`, contactId };
  }

  const lembretes = (autos ?? [])
    .map((a) => ({ id: a.id as string, campo: campoDoLembrete(a.trigger_config) }))
    .filter((a): a is { id: string; campo: string } => !!a.campo);
  if (lembretes.length === 0) {
    // ⚠️ CONHECIDO, NÃO TRATADO (Codex, PR #235): sem nenhum lembrete por
    // data, não há onde gravar a exclusão — a trava da 935 é por AUTOMAÇÃO.
    // Se um lembrete for criado depois disto e antes do horário cancelado,
    // ele sai. Fechar de vez pede guardar o horário cancelado em lugar
    // próprio (tabela ou coluna), e não a trava por automação. Inalcançável
    // nesta conta hoje: os quatro lembretes existem. O detalhe diz isso na
    // tela para o caso não ficar invisível.
    return ignorado(
      "nenhum lembrete por data nesta conta — se um for criado antes do horário cancelado, ele sairá",
      contactId,
    );
  }

  const campos = [...new Set(lembretes.map((l) => l.campo))];
  const { data: valores, error: erroValor } = await db
    .from("contact_custom_values")
    .select("custom_field_id, value")
    .eq("contact_id", contactId)
    .in("custom_field_id", campos);
  if (erroValor) {
    return { resultado: "falhou", detalhe: `leitura dos campos do contato falhou: ${erroValor.message}`, contactId };
  }

  const valorPorCampo = new Map<string, string>();
  for (const v of valores ?? []) {
    const id = v.custom_field_id as string;
    const valor = v.value as string | null;
    if (typeof valor === "string") valorPorCampo.set(id, valor);
  }

  // ⚠️⚠️ SÓ DESARMA O LEMBRETE CUJO CAMPO AINDA APONTA PARA A REUNIÃO
  // CANCELADA, e é aqui que o REAGENDAMENTO se resolve (Codex, PR #235).
  //
  // A primeira versão desistia lá em cima quando `reagendado` era verdadeiro,
  // com o argumento de que o horário novo re-arma sozinho — e isso deixava o
  // horário ANTIGO destravado no intervalo em que a ficha ainda o guarda:
  // quem reagenda 40 minutos antes recebia o lembrete da reunião que acabou
  // de desmarcar. Travar o antigo é seguro porque a chave da 935 inclui o
  // VALOR, então o horário novo tem chave própria. E se o `invitee.created`
  // já escreveu o horário novo na ficha, nada casa e nada é travado — que é
  // o outro lado da mesma corrida. O sinalizador `reagendado` sobrou como
  // INFORMAÇÃO no log.
  //
  // ⚠️ O que fica de fora, escrito: reagendar para o MESMO horário (o
  // Calendly oferece a vaga que a própria pessoa está liberando). Ali a
  // trava do antigo vale para o novo, e o lembrete não sai. É raro, e é o
  // lado menos ruim — o outro é mandar aviso de reunião desmarcada.
  const alvos = lembretes
    .map((l) => ({ id: l.id, valor: valorPorCampo.get(l.campo) }))
    .filter((l): l is { id: string; valor: string } => mesmaReuniao(l.valor, c.inicio));

  if (alvos.length === 0) {
    return ignorado(
      c.reagendado
        ? "reagendamento: a ficha já tem o horário novo — nada a desarmar"
        : "a data na ficha não é mais a da reunião cancelada — nada a desarmar",
      contactId,
    );
  }

  const { error: erroTrava } = await db.from("cb_automation_reminders").upsert(
    alvos.map((a) => ({
      account_id: accountId,
      automation_id: a.id,
      contact_id: contactId,
      valor: a.valor,
      motivo: "cancelamento",
    })),
    // ⚠️⚠️ PROMOVE a linha que já existe (sem `ignoreDuplicates`), e isso é
    // load-bearing: a varredura insere a trava ANTES de disparar e a DEVOLVE
    // quando o recorte barra. Ignorando o conflito, um cancelamento que
    // corresse com a varredura não deixava marca nenhuma — a varredura
    // apagava a linha em seguida e o ciclo seguinte mandava o lembrete da
    // reunião cancelada (Codex, PR #235). Promovida para `cancelamento`, a
    // devolução não a alcança (ela só apaga `motivo = 'disparo'`).
    //
    // O preço, escrito: uma trava que JÁ tinha disparado e depois é
    // cancelada perde o rótulo "disparo". `disparado_em` não é tocado (não
    // vai no payload), e o que o `motivo` precisa garantir é o contrário —
    // nunca afirmar envio que não houve.
    { onConflict: "automation_id,contact_id,valor" },
  );
  if (erroTrava) {
    return { resultado: "falhou", detalhe: `não foi possível desarmar os lembretes: ${erroTrava.message}`, contactId };
  }

  return {
    resultado: "cancelado",
    detalhe: `${alvos.length} lembrete(s) desarmado(s) para ${c.inicio}${c.reagendado ? " (reagendamento: o horário novo re-arma sozinho)" : ""}`,
    contactId,
  };
}
