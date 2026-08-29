// ============================================================
// Transporte UAZAPI (API não-oficial, conexão por QR).
//
// `fetch` direto contra os 3 endpoints de envio do servidor UAZAPI do
// operador. Sem retry de variante de telefone (gambiarra da Meta). Sem
// templates nem interativo nas Ondas 1–2 — a API tem `/send/menu` mas o
// transporte declara `interactive: false` até a Onda 3 implementá-lo.
// `fetchMedia` (inbound) entra na Onda 1c com a interface.
// ============================================================

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import {
  UnsupportedCapabilityError,
  type TransportConnection,
  type TransportMediaArgs,
  type TransportReactionArgs,
  type TransportResult,
  type TransportTextArgs,
  type WhatsAppTransport,
} from './types';

type UazapiConnection = Extract<TransportConnection, { provider: 'uazapi' }>;

// MediaKind ('image'|'video'|'document'|'audio') já bate com os `type`
// da UAZAPI 1:1. Mapa explícito para não depender do acaso.
const MEDIA_TYPE: Record<MediaKind, string> = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'audio',
};

export function createUazapiTransport(
  conn: UazapiConnection
): WhatsAppTransport {
  const base = conn.baseUrl.replace(/\/$/, '');

  async function call(
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // securitySchemes.token: apiKey, in: header, name: `token`,
        // carregando o token da instância (docs/uazapi-openapi-spec.yaml ~54).
        token: conn.credential,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const msg =
        (json.error as string) ||
        (json.message as string) ||
        `UAZAPI ${path} failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  }

  // O 200 de `/send/text` e `/send/media` é `allOf: [Message, { response }]`.
  // No schema `Message`, `messageid` = "ID original da mensagem no provedor"
  // (o id endereçável, formato `3EB0…`); `id` é só o uuid interno da UAZAPI.
  // Schema inequívoco → sem cadeia de fallback.
  const messageId = (json: Record<string, unknown>): string =>
    (json.messageid as string) ?? '';

  return {
    provider: 'uazapi',
    capabilities: {
      templates: false,
      media: true,
      reactions: true,
      interactive: false,
    },

    async sendText(args: TransportTextArgs): Promise<TransportResult> {
      const json = await call('/send/text', {
        number: args.to,
        text: args.text,
        ...(args.replyToProviderMessageId
          ? { replyid: args.replyToProviderMessageId }
          : {}),
      });
      return { providerMessageId: messageId(json) };
    },

    async sendMedia(args: TransportMediaArgs): Promise<TransportResult> {
      const json = await call('/send/media', {
        number: args.to,
        type: MEDIA_TYPE[args.mediaKind],
        file: args.link,
        ...(args.caption ? { text: args.caption } : {}),
        ...(args.filename ? { docName: args.filename } : {}),
        ...(args.replyToProviderMessageId
          ? { replyid: args.replyToProviderMessageId }
          : {}),
      });
      return { providerMessageId: messageId(json) };
    },

    async sendReaction(args: TransportReactionArgs): Promise<TransportResult> {
      const json = await call('/message/react', {
        number: args.to,
        text: args.emoji,
        id: args.targetProviderMessageId,
      });
      // Uma reação não gera mensagem endereçável nova; devolve o id-alvo
      // (o caller não persiste este valor — paridade com o transporte Meta).
      // O schema formal expõe `messageid`/`id` no topo; a prosa dos exemplos
      // mostra `reaction.id`. Aceita ambos e cai no id-alvo.
      const reaction = json.reaction as Record<string, unknown> | undefined;
      return {
        providerMessageId:
          (reaction?.id as string) ??
          (json.messageid as string) ??
          args.targetProviderMessageId,
      };
    },

    sendTemplate(): Promise<TransportResult> {
      throw new UnsupportedCapabilityError('uazapi', 'templates');
    },
    sendInteractive(): Promise<TransportResult> {
      throw new UnsupportedCapabilityError('uazapi', 'interactive');
    },
  };
}
