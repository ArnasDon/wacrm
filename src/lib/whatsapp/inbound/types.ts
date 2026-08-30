// ============================================================
// Tipos compartilhados do pipeline de mensagens recebidas.
//
// `ProviderMediaRef` é o ponteiro opaco que um envelope recebido
// carrega no lugar de uma URL de mídia: cada provedor sabe resolver o
// SEU formato para bytes via `WhatsAppTransport.fetchMedia`. Meta usa
// `mediaId`; UAZAPI carrega o que precisar (resolvido na Onda 1c-ii).
//
// `InboundMessage`/`InboundStatus` entram nas tasks seguintes.
// ============================================================

export type ProviderMediaRef =
  | { provider: 'meta'; mediaId: string }
  | { provider: 'uazapi'; [k: string]: unknown };

export interface InboundStatus {
  connectionId: string;
  accountId: string;
  providerMessageId: string;
  status: string;
  timestamp: Date;
}
