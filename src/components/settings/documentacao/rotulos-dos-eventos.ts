"use client";

// ============================================================
// Rótulo e descrição, na língua do operador, de cada evento de webhook
// ENVIADO — usados pela aba Webhooks → Enviados (checkboxes, cartões, o
// seletor do "Enviar teste") e pela aba Documentação (a lista de eventos).
// Um lugar só: duas cópias divergiriam, e o operador leria um nome na tela
// de cadastro e outro na documentação para o mesmo evento.
//
// ⚠️ Chaves LITERAIS, uma por evento — nunca `catalogoDeEventos.${ev}`. O
// portão de i18n do CI só confere literais; chave montada escapa dele, e um
// evento novo sem tradução apareceria cru (`Settings.webhooks.…`) na tela.
// O `Record<WebhookEvent, …>` faz o compilador cobrar a entrada de todo
// evento novo, e `rotulo-do-evento.test.ts` cobra as chaves nos DOIS
// dicionários.
//
// As chaves são camelCase (`messageReceived`) porque o ponto do nome do
// evento é o separador de caminho do next-intl.
// ============================================================

import { useTranslations } from "next-intl";

import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";

export interface RotuloDoEvento {
  rotulo: string;
  descricao: string;
}

export function useRotulosDosEventos(): Record<WebhookEvent, RotuloDoEvento> {
  const t = useTranslations("Settings.webhooks");
  return {
    "message.received": {
      rotulo: t("catalogoDeEventos.messageReceived.rotulo"),
      descricao: t("catalogoDeEventos.messageReceived.descricao"),
    },
    "message.status_updated": {
      rotulo: t("catalogoDeEventos.messageStatusUpdated.rotulo"),
      descricao: t("catalogoDeEventos.messageStatusUpdated.descricao"),
    },
    "conversation.created": {
      rotulo: t("catalogoDeEventos.conversationCreated.rotulo"),
      descricao: t("catalogoDeEventos.conversationCreated.descricao"),
    },
    "deal.created": {
      rotulo: t("catalogoDeEventos.dealCreated.rotulo"),
      descricao: t("catalogoDeEventos.dealCreated.descricao"),
    },
    "deal.stage_changed": {
      rotulo: t("catalogoDeEventos.dealStageChanged.rotulo"),
      descricao: t("catalogoDeEventos.dealStageChanged.descricao"),
    },
    "deal.status_changed": {
      rotulo: t("catalogoDeEventos.dealStatusChanged.rotulo"),
      descricao: t("catalogoDeEventos.dealStatusChanged.descricao"),
    },
  };
}

/**
 * Os eventos em GRUPOS, na ordem da tela. Grupo por evento é um `Record`
 * para o compilador obrigar quem acrescentar um evento a decidir onde ele
 * aparece — derivar "o que não é negócio é mensagem" poria um futuro
 * `task.*` no grupo errado sem ninguém notar.
 */
export type GrupoDeEventos = "mensagens" | "negocios";

const GRUPO_DO_EVENTO: Record<WebhookEvent, GrupoDeEventos> = {
  "message.received": "mensagens",
  "message.status_updated": "mensagens",
  "conversation.created": "mensagens",
  "deal.created": "negocios",
  "deal.stage_changed": "negocios",
  "deal.status_changed": "negocios",
};

export const EVENTOS_POR_GRUPO: ReadonlyArray<{
  grupo: GrupoDeEventos;
  eventos: WebhookEvent[];
}> = (["mensagens", "negocios"] as const).map((grupo) => ({
  grupo,
  eventos: WEBHOOK_EVENTS.filter((ev) => GRUPO_DO_EVENTO[ev] === grupo),
}));

/** Rótulo do grupo — chaves literais, pelo mesmo motivo dos eventos. */
export function useRotulosDosGrupos(): Record<GrupoDeEventos, string> {
  const t = useTranslations("Settings.webhooks");
  return {
    mensagens: t("grupoMensagens"),
    negocios: t("grupoNegocios"),
  };
}
