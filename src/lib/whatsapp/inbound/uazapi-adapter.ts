// ============================================================
// Adaptador de envelope da UAZAPI.
//
// Traduz o payload cru de webhook da UAZAPI (um `Message` — nested sob
// `data` no envelope `{ event, instance, data }` da spec-mãe, ou
// achatado direto no corpo) para os envelopes normalizados
// `InboundMessage` / `InboundStatus` que `processInboundMessage` /
// `processStatusUpdate` consomem. Toda a decisão por `messageType` fica
// aqui — mas produz `content.kind` + um `ProviderMediaRef` opaco
// (`{ provider: 'uazapi', messageId }`), nunca uma URL de mídia.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { InboundMessage, InboundStatus } from './types';

/** O subconjunto da linha `whatsapp_connections` que o adaptador estampa. */
export interface UazapiConnectionRowLite {
  id: string;
  account_id: string;
  user_id: string;
  uazapi_instance_id: string | null;
}

type Json = Record<string, unknown>;

/**
 * Fonte da mensagem: o envelope pode vir como `{ …, data: {msg} }` ou
 * achatado. Aceita as duas (defensivo — a OpenAPI só mostra
 * `{ EventType, token }` num exemplo de log; a spec-mãe diz
 * `{ event, instance, data }`).
 */
function msgOf(payload: Json): Json {
  const data = payload.data;
  return data && typeof data === 'object' ? (data as Json) : payload;
}

/** Tipo do evento — a rota da Task 3 usa isto para rotear. */
export function eventTypeOf(payload: Json): string {
  return String(payload.EventType ?? payload.event ?? '');
}

/** Canonical event kind, tolerant of UAZAPI's singular/plural vocab. */
export function eventKindOf(
  payload: Json
): 'message' | 'status' | 'connection' | 'other' {
  const raw = eventTypeOf(payload).toLowerCase();
  if (raw === 'messages' || raw === 'message') return 'message';
  if (raw === 'messages_update' || raw === 'status' || raw === 'messages_set')
    return 'status';
  if (raw === 'connection' || raw === 'connect' || raw === 'connection_update')
    return 'connection';
  return 'other';
}

const STATUS_MAP: Record<string, string> = {
  Sent: 'sent',
  Delivered: 'delivered',
  Read: 'read',
  Failed: 'failed',
};

const MEDIA_KINDS: Record<string, MediaKind> = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'audio',
  // stickers → image (paridade com o adaptador da Meta)
  sticker: 'image',
  ptt: 'audio',
};

function phoneFromChatId(chatid: unknown): string {
  const raw = String(chatid ?? '').split('@')[0];
  return normalizePhone(raw);
}

export function uazapiMessageToInbound(
  payload: Json,
  row: UazapiConnectionRowLite
): InboundMessage {
  const m = msgOf(payload);
  return {
    connectionId: row.id,
    accountId: row.account_id,
    configOwnerUserId: row.user_id,
    providerMessageId: String(m.messageid ?? ''),
    from: phoneFromChatId(m.chatid),
    senderName: (m.senderName as string) || undefined,
    // messageTimestamp é EM MILISSEGUNDOS — sem * 1000.
    timestamp: new Date(Number(m.messageTimestamp ?? 0)),
    replyToProviderMessageId: (m.quoted as string) || undefined,
    content: uazapiContent(m),
  };
}

export function uazapiContent(m: Json): InboundMessage['content'] {
  // Reação: o campo `reaction` carrega o id da msg reagida; o emoji vem
  // em `text`. (Confirmar contra `messageType` no payload real.)
  if (m.reaction) {
    return {
      kind: 'reaction',
      targetProviderMessageId: String(m.reaction),
      emoji: (m.text as string) ?? '',
    };
  }
  if (m.buttonOrListid) {
    return {
      kind: 'interactive_reply',
      replyId: String(m.buttonOrListid),
      title: (m.text as string) ?? String(m.buttonOrListid),
    };
  }
  const mt = String(m.messageType ?? '').toLowerCase();
  const mediaKind = MEDIA_KINDS[mt];
  if (mediaKind) {
    const content = (m.content as Json | undefined) ?? {};
    return {
      kind: 'media',
      mediaKind,
      caption: (m.text as string) || undefined,
      filename:
        (content.fileName as string) ??
        (content.filename as string) ??
        undefined,
      mimeType:
        (content.mimetype as string) ??
        (content.mimeType as string) ??
        undefined,
      ref: { provider: 'uazapi', messageId: String(m.messageid ?? '') },
    };
  }
  if (
    mt === 'text' ||
    mt === 'conversation' ||
    (!mt && typeof m.text === 'string')
  ) {
    return { kind: 'text', text: (m.text as string) ?? '' };
  }
  return { kind: 'unsupported', rawType: String(m.messageType ?? 'unknown') };
}

export function uazapiStatusToInbound(
  payload: Json,
  row: UazapiConnectionRowLite
): InboundStatus {
  const m = msgOf(payload);
  const raw = String(m.status ?? '');
  return {
    connectionId: row.id,
    accountId: row.account_id,
    providerMessageId: String(m.messageid ?? ''),
    // Valores não mapeados passam crus — o `isValidStatusTransition` da
    // Onda 1c-i descarta o que não reconhece.
    status: STATUS_MAP[raw] ?? raw,
    timestamp: new Date(Number(m.messageTimestamp ?? Date.now())),
  };
}
