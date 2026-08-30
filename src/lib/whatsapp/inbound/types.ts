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

import type { MediaKind } from '@/lib/whatsapp/meta-api';

export type ProviderMediaRef =
  | { provider: 'meta'; mediaId: string }
  | { provider: 'uazapi'; [k: string]: unknown };

/**
 * Envelope de mensagem recebida, já normalizado — nenhum campo cru de
 * provedor sobrevive aqui. Produzido pelo adaptador de cada provedor
 * (`meta-adapter.ts`, e o de UAZAPI na Onda 1c-ii) e consumido por
 * `processInboundMessage`. O `content` é uma união discriminada por
 * `kind`; o caminho de mídia resolve `content.ref` para bytes via
 * `WhatsAppTransport.fetchMedia`.
 */
export interface InboundMessage {
  connectionId: string;
  accountId: string;
  configOwnerUserId: string;
  providerMessageId: string;
  /** Telefone já normalizado. */
  from: string;
  senderName?: string;
  timestamp: Date;
  replyToProviderMessageId?: string;
  content:
    | { kind: 'text'; text: string }
    | {
        kind: 'media';
        mediaKind: MediaKind;
        caption?: string;
        filename?: string;
        mimeType?: string;
        ref: ProviderMediaRef;
      }
    | {
        kind: 'location';
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
      }
    | { kind: 'interactive_reply'; replyId: string; title: string }
    | { kind: 'reaction'; targetProviderMessageId: string; emoji: string }
    | { kind: 'unsupported'; rawType: string };
}

export interface InboundStatus {
  connectionId: string;
  accountId: string;
  providerMessageId: string;
  status: string;
  timestamp: Date;
}
