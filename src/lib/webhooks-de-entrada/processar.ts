// ============================================================
// O que acontece quando um webhook de entrada é acionado.
//
// Ordem deliberada, e ela é a mesma do Calendly (`src/lib/calendly/
// processar.ts`), pelas mesmas razões:
//
//   1. webhook desligado → `ignorado`, sem tocar em nada;
//   2. telefone → sem ele não há contato, e sem contato a automação não
//      tem sobre quem agir;
//   3. ALGUÉM ESCUTA? — a consulta de automações vem ANTES de criar a
//      ficha. Sem essa ordem, um acionamento numa conta que ainda não
//      configurou automação nenhuma materializaria um lead que ninguém
//      pediu, e a tela de Contatos encheria de gente vinda de um teste;
//   4. ficha e conversa (criando quando o telefone é novo);
//   5. disparo, e o resultado do disparo vira o resultado da linha.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { dispararAutomacoes } from "@/lib/automations/engine";
import { resolverDestinatario } from "@/lib/automations/destinatario";
import { digitosDoTelefone } from "@/lib/contacts/telefone";
import type { WebhookTriggerConfig } from "@/types";

import { valorDoCampo } from "./achatar";

export type ResultadoDaLinha =
  | "disparado"
  | "em_espera"
  | "sem_automacao"
  | "sem_contato"
  | "sem_telefone"
  | "ignorado"
  | "falhou";

export interface ResultadoDoAcionamento {
  resultado: ResultadoDaLinha;
  detalhe: string;
  contactId: string | null;
}

/** O que a rota precisa saber do webhook para processar um acionamento. */
export interface WebhookParaProcessar {
  id: string;
  nome: string;
  is_active: boolean;
  campo_telefone: string | null;
  campo_nome: string | null;
}

/** O acionamento gravado, remontado do banco ou recém-recebido. */
export interface AcionamentoParaProcessar {
  variaveis: Record<string, string>;
}

/**
 * Alguma automação ativa escuta ESTE webhook? Puro.
 *
 * ⚠️ Espelha `triggerMatches` do motor para `webhook_received` — config
 * vazia = qualquer webhook. Divergir daqui faria o pré-filtro barrar um
 * acionamento que o motor teria aceitado (ou o contrário, criando ficha
 * para ninguém). Há teste comparando os dois.
 */
export function escutamEsteWebhook(
  automacoes: readonly { trigger_config: unknown }[],
  webhookId: string
): boolean {
  return automacoes.some((a) => {
    const cfg = (a.trigger_config ?? {}) as WebhookTriggerConfig;
    const alvo = typeof cfg.webhook_id === "string" ? cfg.webhook_id.trim() : "";
    return !alvo || alvo === webhookId;
  });
}

/**
 * Traduz o retorno de `dispararAutomacoes` para o resultado da linha do
 * log. Puro.
 */
export function resultadoDoDisparo(
  r: {
    executadas: number;
    foraDoEscopo: number;
    comFalha: number;
    emEspera: number;
    erro?: string;
  },
  contactId: string | null
): ResultadoDoAcionamento {
  if (r.erro) {
    return {
      resultado: "falhou",
      detalhe: `o disparo não aconteceu: ${r.erro}`,
      contactId,
    };
  }
  if (r.executadas === 0) {
    return {
      resultado: "sem_automacao",
      detalhe:
        r.foraDoEscopo > 0
          ? "a automação existe, mas está fora do escopo (conexão ou etapa) para este contato"
          : "nenhuma automação ativa escuta este webhook",
      contactId,
    };
  }
  if (r.comFalha > 0) {
    return {
      resultado: "falhou",
      detalhe: `${r.comFalha} de ${r.executadas} automação(ões) terminou com erro — veja o histórico da automação`,
      contactId,
    };
  }
  if (r.emEspera > 0) {
    return {
      resultado: "em_espera",
      detalhe: `${r.emEspera} de ${r.executadas} automação(ões) parou num passo "Aguardar" — o restante sai pelo agendador e fica no histórico da automação; esta linha não é atualizada depois`,
      contactId,
    };
  }
  return {
    resultado: "disparado",
    detalhe: `${r.executadas} automação(ões) executada(s)`,
    contactId,
  };
}

export async function processarAcionamento(
  admin: SupabaseClient,
  accountId: string,
  webhook: WebhookParaProcessar,
  acionamento: AcionamentoParaProcessar
): Promise<ResultadoDoAcionamento> {
  if (!webhook.is_active) {
    return {
      resultado: "ignorado",
      detalhe: "o webhook está desligado",
      contactId: null,
    };
  }

  // ── 2) telefone ────────────────────────────────────────────
  const cru = valorDoCampo(acionamento.variaveis, webhook.campo_telefone);
  const digitos = digitosDoTelefone(cru);
  if (!digitos) {
    return {
      resultado: "sem_telefone",
      detalhe: webhook.campo_telefone
        ? `o campo "${webhook.campo_telefone}" não veio no payload, ou não parece um telefone`
        : "este webhook não tem campo de telefone configurado",
      contactId: null,
    };
  }

  // ── 3) alguém escuta? ──────────────────────────────────────
  const { data: automacoes, error: erroAuto } = await admin
    .from("automations")
    .select("id, trigger_config")
    .eq("account_id", accountId)
    .eq("trigger_type", "webhook_received")
    .eq("is_active", true);

  if (erroAuto) {
    console.error("[webhooks-de-entrada] consulta de automações:", erroAuto);
    return {
      resultado: "falhou",
      detalhe: "não foi possível consultar as automações",
      contactId: null,
    };
  }
  if (!escutamEsteWebhook(automacoes ?? [], webhook.id)) {
    return {
      resultado: "sem_automacao",
      detalhe: "nenhuma automação ativa escuta este webhook",
      contactId: null,
    };
  }

  // ── 4) ficha e conversa ────────────────────────────────────
  // A ficha NASCE aqui quando o telefone é novo — mesma decisão da revisão
  // da D2 do Calendly: o lead que chega por um formulário ainda não
  // escreveu para o escritório, e exigir contato existente desligaria a
  // integração justamente no caso que ela existe para atender.
  let destinatario;
  try {
    // ⚠️ A conversa que nasce aqui nasce ENCERRADA (ninguém escreveu ainda);
    // a que já existia fica como está. A primeira mensagem do cliente ou da
    // equipe a reabre pelos caminhos de sempre (`reopen.ts`).
    destinatario = await resolverDestinatario(
      admin,
      accountId,
      digitos,
      valorDoCampo(acionamento.variaveis, webhook.campo_nome),
      { conversaNovaEncerrada: true }
    );
  } catch (err) {
    console.error("[webhooks-de-entrada] destinatário:", err);
    // `sem_contato`, e não `falhou`: nada da automação rodou, repetir é
    // seguro, e `sem_contato` é o que o botão "Processar de novo" aceita.
    return {
      resultado: "sem_contato",
      detalhe: "não foi possível criar ou encontrar o contato deste telefone",
      contactId: null,
    };
  }

  // ── 5) disparo ─────────────────────────────────────────────
  // ⚠️ `channel_id` vai NULO: a conversa nasce sem conexão, e o motor
  // deixa passar canal nulo (`channelInScope` falha ABERTA). Ou seja,
  // automação restrita a uma conexão AINDA dispara para lead novo. Apertar
  // essa regra desligaria o webhook justamente para quem acabou de chegar.
  const r = await dispararAutomacoes({
    accountId,
    triggerType: "webhook_received",
    contactId: destinatario.contactId,
    context: {
      conversation_id: destinatario.conversationId,
      channel_id: null,
      webhook_id: webhook.id,
      vars: acionamento.variaveis,
    },
  });

  return resultadoDoDisparo(r, destinatario.contactId);
}

/**
 * Carimba o resultado na linha do log. Nunca lança — é o fim de um
 * `after()`.
 *
 * ⚠️ SOLTA o cadeado (`processando_desde: null`) na mesma escrita: é o
 * caminho normal de liberação. Um caminho novo que esqueça deixa o
 * acionamento travado até o recolhimento por idade.
 *
 * ⚠️ E leva CERCA DE POSSE quando recebe `claimIso`: sem ela, um dono
 * recolhido como abandonado terminaria tarde e sobrescreveria o resultado
 * de quem assumiu. `gravou: false` com cerca é NORMAL — é a cerca agindo.
 */
export async function gravarResultado(
  admin: SupabaseClient,
  eventoId: string,
  r: ResultadoDoAcionamento,
  claimIso?: string
): Promise<{ gravou: boolean }> {
  const escrita = admin
    .from("cb_webhook_eventos")
    .update({
      resultado: r.resultado,
      detalhe: r.detalhe,
      contact_id: r.contactId,
      processado_em: new Date().toISOString(),
      processando_desde: null,
    })
    .eq("id", eventoId);

  const { data, error } = await (claimIso
    ? escrita.eq("processando_desde", claimIso)
    : escrita
  ).select("id");

  if (error) {
    console.error("[webhooks-de-entrada] gravar resultado:", error);
    return { gravou: false };
  }
  const gravou = (data ?? []).length > 0;
  if (!gravou && claimIso) {
    console.warn(
      `[webhooks-de-entrada] cerca de posse descartou a escrita do evento ${eventoId} — outro processo assumiu`
    );
  }
  return { gravou };
}
