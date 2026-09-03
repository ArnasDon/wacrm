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
 * Fonte da mensagem. Confirmado no smoke da 1c-ii contra uma instância
 * real: o evento `messages` aninha a `Message` em `payload.message` —
 * NEM `data` (a OpenAPI só mostra `{ EventType, token }` num exemplo de
 * log) NEM achatada (a spec-mãe dizia `{ event, instance, data }`,
 * também não bateu). Mantém `data` e achatado como fallback defensivo
 * para o resto do vocabulário de eventos, ainda não confirmado.
 */
function msgOf(payload: Json): Json {
  const message = payload.message;
  if (message && typeof message === 'object') return message as Json;
  // `messages_update` nests its body under `event`, not `message` —
  // also confirmed in the 1c-ii smoke (see uazapiStatusToInbound).
  const event = payload.event;
  if (event && typeof event === 'object') return event as Json;
  const data = payload.data;
  return data && typeof data === 'object' ? (data as Json) : payload;
}

/** Tipo do evento — a rota da Task 3 usa isto para rotear. */
export function eventTypeOf(payload: Json): string {
  return String(payload.EventType ?? payload.event ?? '');
}

/**
 * A mensagem foi enviada pela PRÓPRIA conexão (o operador digitando no
 * celular, ou um envio nosso que escapou do filtro `wasSentByApi`) —
 * confirmado em produção via smoke: `fromMe: true` chega sem filtro
 * algum. Nunca é a mensagem de um cliente; a rota usa isto pra não
 * processar como inbound (evita sobrescrever o nome do contato com o
 * do próprio dono e gravar a fala do operador como se fosse o cliente).
 */
export function isFromMe(payload: Json): boolean {
  return msgOf(payload).fromMe === true;
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

// Chaves = `messageType` em minúsculas. UAZAPI usa os nomes de struct
// Go do whatsmeow, não um kind simples como `"image"` — confirmado no
// smoke da 1c-ii para `ImageMessage`/`AudioMessage`. `VideoMessage` /
// `DocumentMessage` / `StickerMessage` seguem por inferência da mesma
// convenção (ainda não observados diretamente); se o nome real
// divergir, cai em `unsupported` com `rawType` logado — barato de
// corrigir quando aparecer. Voice-note não é um messageType à parte:
// vem como `AudioMessage` com `content.PTT: true`.
const MEDIA_KINDS: Record<string, MediaKind> = {
  imagemessage: 'image',
  audiomessage: 'audio',
  videomessage: 'video',
  documentmessage: 'document',
  stickermessage: 'image',
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
    // Real UAZAPI type for a text message that contains a URL (link
    // preview) — confirmed via the 1c-ii smoke. `m.text` still holds
    // the actual body.
    mt === 'extendedtextmessage' ||
    (!mt && typeof m.text === 'string')
  ) {
    return { kind: 'text', text: (m.text as string) ?? '' };
  }
  return { kind: 'unsupported', rawType: String(m.messageType ?? 'unknown') };
}

/**
 * Um `InboundStatus` por id — o `messages_update` real (confirmado via
 * 1c-ii smoke) pode batchar mais de um `MessageIDs` num único evento
 * (visto: 2 ids ao mesmo tempo, ambos "Read"). `{ MessageIDs: [...],
 * Type, Timestamp }` sob `event`, com nomes de campo E unidade
 * diferentes do formato achatado/`data` adivinhado: `Timestamp` é
 * SEGUNDOS, ao contrário do `messageTimestamp` (ms) do evento
 * `messages`.
 */
export function uazapiStatusToInbound(
  payload: Json,
  row: UazapiConnectionRowLite
): InboundStatus[] {
  const m = msgOf(payload);
  const ids = m.MessageIDs;
  const providerMessageIds =
    Array.isArray(ids) && ids.length > 0
      ? ids.map(String)
      : [String(m.messageid ?? '')];
  const raw = String(m.Type ?? m.status ?? '');
  const timestamp =
    m.Timestamp !== undefined
      ? new Date(Number(m.Timestamp) * 1000)
      : new Date(Number(m.messageTimestamp ?? Date.now()));
  // Valores não mapeados passam crus — o `isValidStatusTransition` da
  // Onda 1c-i descarta o que não reconhece.
  const status = STATUS_MAP[raw] ?? raw;
  return providerMessageIds.map((providerMessageId) => ({
    connectionId: row.id,
    accountId: row.account_id,
    providerMessageId,
    status,
    timestamp,
  }));
}
