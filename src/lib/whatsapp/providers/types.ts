// ============================================================
// Contrato de transporte de WhatsApp.
//
// Um transporte é a ÚNICA coisa que fala com a API de um provedor.
// Ele não vê o banco: recebe uma conexão já resolvida (credencial
// decriptada) e devolve o id de mensagem do provedor. Quem persiste é
// o núcleo (`send-core.ts`) ou, no caso do broadcast e da reação, o
// próprio call site — os dois gravam em tabelas que não são `messages`.
// ============================================================

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

export type ProviderName = 'meta' | 'uazapi';

/**
 * O que o transporte IMPLEMENTA hoje — não o que a API do provedor é
 * capaz de fazer. O núcleo consulta isto antes de enviar e a UI usa o
 * mesmo descritor para esconder affordances que não se aplicam.
 */
export interface ProviderCapabilities {
  templates: boolean;
  interactive: boolean;
  reactions: boolean;
  media: boolean;
}

/**
 * Linha de configuração com a credencial JÁ DECRIPTADA. Produzida por
 * `resolveConnection()`; consumida só por transportes.
 */
export interface TransportConnection {
  id: string;
  accountId: string;
  provider: ProviderName;
  /** Meta: `phone_number_id`. Null para provedores que não usam um. */
  phoneNumberId: string | null;
  /** Meta: access token. (Onda 1: UAZAPI usa a mesma coluna.) */
  credential: string;
}

export interface TransportResult {
  providerMessageId: string;
  /**
   * Telefone que a API realmente aceitou, quando o transporte aplicou
   * normalização própria (o retry de variantes da Meta). Ausente quando
   * o número enviado foi o número aceito. O chamador decide se grava
   * isso de volta no contato — inbox/Flows/Automations gravam, o
   * broadcast não.
   */
  normalizedRecipient?: string;
}

interface BaseSendArgs {
  /** Telefone sanitizado, só dígitos. */
  to: string;
  /** Id de mensagem DO PROVEDOR que está sendo respondida (quote). */
  replyToProviderMessageId?: string;
}

export interface TransportTextArgs extends BaseSendArgs {
  text: string;
}

export interface TransportMediaArgs extends BaseSendArgs {
  mediaKind: MediaKind;
  /** URL pública que o provedor busca no momento do envio. */
  link: string;
  caption?: string;
  filename?: string;
}

export interface TransportInteractiveArgs extends BaseSendArgs {
  payload: InteractiveMessagePayload;
}

export interface TransportTemplateArgs extends BaseSendArgs {
  templateName: string;
  language?: string;
  template?: MessageTemplate;
  messageParams?: SendTimeParams;
  params?: string[];
}

export interface TransportReactionArgs {
  to: string;
  targetProviderMessageId: string;
  /** Emoji único, ou string vazia para remover. */
  emoji: string;
}

export interface WhatsAppTransport {
  readonly provider: ProviderName;
  readonly capabilities: ProviderCapabilities;
  sendText(args: TransportTextArgs): Promise<TransportResult>;
  sendMedia(args: TransportMediaArgs): Promise<TransportResult>;
  sendInteractive(args: TransportInteractiveArgs): Promise<TransportResult>;
  sendTemplate(args: TransportTemplateArgs): Promise<TransportResult>;
  sendReaction(args: TransportReactionArgs): Promise<TransportResult>;
}

/**
 * Lançado quando se pede a um transporte algo que ele não declara em
 * `capabilities`. O núcleo mapeia para um 400 com mensagem clara, em vez
 * de deixar a chamada morrer no fio com erro opaco do provedor.
 */
export class UnsupportedCapabilityError extends Error {
  readonly provider: ProviderName;
  readonly capability: keyof ProviderCapabilities;
  constructor(provider: ProviderName, capability: keyof ProviderCapabilities) {
    super(`Provider "${provider}" does not support ${capability} messages`);
    this.name = 'UnsupportedCapabilityError';
    this.provider = provider;
    this.capability = capability;
  }
}
