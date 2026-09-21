// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { aplicarAssinatura, custoDaAssinatura } from '@/lib/assinatura/assinatura';
import { nomeParaAssinar } from '@/lib/assinatura/resolver';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  getTransport,
  toEvolutionNumber,
  type ProviderMessageRef,
} from '@/lib/whatsapp/transport';
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { stampMessageChannel } from '@/lib/cb-channels/stamp';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { abortActiveRunsForContact } from '@/lib/flows/parar-run';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { CbGroup, MessageTemplate } from '@/types';
import {
  resolveTemplateRow,
  templateBodyParams,
  templateContentText,
} from '@/lib/whatsapp/template-body';
import { ehEvolution, ehInstagram, ehMeta } from '@/lib/cb-channels/transporte';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  /**
   * Quem apertou "enviar", quando foi gente. Vai para `messages.sender_id`.
   *
   * ⚠️ Fica NULO de propósito quando não há pessoa: envio pela API pública
   * (chave de API, sem usuário — `api/v1/messages/route.ts`) e pelo MCP. Nulo
   * ali significa "não foi uma pessoa desta conta", que é a verdade; preencher
   * com o dono da conta inventaria um autor que não apertou nada.
   *
   * ⚠️ Nunca chega ao cliente nem à API pública: `serializeMessage`
   * (`lib/api/v1/conversations.ts`) monta a resposta por allowlist de campos,
   * e há teste travando isso.
   */
  senderUserId?: string | null;
  /**
   * Sai por ESTE canal, e por nenhum outro (925).
   *
   * ⚠️ Não confundir com o `channel_id` da rota `/api/whatsapp/send`, que
   * FIXA a conversa naquele número (`channel_pinned`) e portanto muda o
   * rumo de tudo o que vier depois. Aqui é só desta mensagem: a conversa
   * continua respondendo pelo canal dela.
   *
   * ⚠️ E a diferença que importa: sem este parâmetro o núcleo resolve o
   * canal e DEGRADA EM SILÊNCIO para o padrão da conta. Com ele, canal que
   * não resolve exatamente para o id pedido é erro — a mensagem não sai.
   * Quem agenda um envio para as 9h da manhã não está na tela para ver
   * saindo pelo número errado.
   *
   * Ausente/nulo = comportamento de sempre (resolve pela conversa).
   */
  channelId?: string | null;
  /**
   * Pausar os fluxos ativos do contato (o padrão, e o que o envio manual
   * sempre fez). A agendada passa `false` (P4.5): a pausa existe para dizer
   * "tem gente aqui agora", e às 3 da manhã não tem.
   */
  pauseFlows?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
  /**
   * Canal (`cb_channels.id`) por onde a mensagem REALMENTE saiu — que pode
   * não ser o que o chamador esperava, já que o canal da conversa "segue o
   * cliente". `null` no fallback do espelho `whatsapp_config`.
   */
  channelId: string | null;
  /**
   * O texto como ficou GRAVADO — já com a assinatura, quando ligada (923).
   * Quem desenhou uma bolha otimista com o texto cru precisa disto para
   * corrigi-la sem esperar o realtime.
   */
  contentText: string | null;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
    senderUserId,
    channelId: canalExigido,
    pauseFlows = true,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact (ou grupo), account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*), group:cb_groups(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  // GRUPO (906). O destinatário é o JID do grupo, não um telefone — e é por
  // isso que as duas validações abaixo passam a ser condicionais:
  // `sanitizePhoneForMeta` + `isValidE164` reprovariam `120363…@g.us` antes
  // de qualquer envio. Era exatamente esta guarda que barrava grupo até aqui.
  const grupo = (conversation as { group?: CbGroup | null }).group ?? null;
  const ehGrupo = !!conversation.group_id;

  const contact = conversation.contact;
  if (!ehGrupo && !contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }
  if (ehGrupo && !grupo?.jid) {
    // Conversa de grupo sem a linha do grupo: só acontece com dado
    // inconsistente, e enviar às cegas não é opção — não há para onde.
    throw new SendMessageError(
      'bad_request',
      'Group not found for this conversation',
      400
    );
  }

  const sanitizedPhone = ehGrupo ? '' : sanitizePhoneForMeta(contact!.phone);
  if (!ehGrupo && !isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  /**
   * Para onde a mensagem vai. Em grupo é o JID; `toEvolutionNumber` preserva
   * o sufixo `@g.us` intacto de propósito — ver o comentário lá.
   */
  const destinatario = ehGrupo ? grupo!.jid : sanitizedPhone;

  /**
   * ASSINATURA (923). Resolvida aqui — depois de a conversa existir e antes
   * de qualquer envio — porque daqui para baixo `contentText` não é mais o
   * texto que vai ao cliente: `textoFinal` é.
   *
   * ⚠️ `senderUserId` nulo é envio por CHAVE DE API (v1/MCP), não por gente:
   * `nomeParaAssinar` assina esses com o nome do escritório, nunca com o de
   * uma pessoa.
   */
  /**
   * ⚠️ SÓ ASSINA O QUE REALMENTE SAI ASSINADO.
   *
   * A regra da P1.2 é "o CRM mostra exatamente o que o cliente recebeu". Ela
   * corta nos dois sentidos, e o caso abaixo violava justamente o lado que
   * importa num escritório de advocacia — o registro afirmando algo que não
   * aconteceu:
   *
   *  · TEMPLATE — o compositor manda `content_text` com o corpo já renderizado
   *    (`message-thread.tsx`), mas o envio à Meta é montado a partir do NOME
   *    do modelo e dos parâmetros; o texto daqui nunca é lido. Assinar fazia
   *    a Meta entregar o modelo aprovado LIMPO e o CRM gravar a versão
   *    assinada — uma atribuição fabricada, que não se corrige sozinha nunca
   *    (modelo não é editável e fica fora do contexto da IA).
   *  · INTERATIVA — o corpo vai no payload estruturado, e `interactiveBody`
   *    ganha do texto no insert. Além disso o operador decidiu não assinar
   *    menu de botões.
   *  · ÁUDIO — não tem legenda.
   *
   * Sobra o que de fato viaja como texto: mensagem de texto e legenda de
   * mídia. `podeAssinar` é a lista explícita disso.
   */
  const podeAssinar =
    messageType === 'text' ||
    (isMediaKind && messageType !== 'audio' && !!contentText?.trim());

  const nomeQueAssina = podeAssinar
    ? await nomeParaAssinar(db, accountId, senderUserId)
    : null;
  const textoFinal = aplicarAssinatura(contentText, nomeQueAssina);

  /**
   * ⚠️ O teto de 1024 é revalidado AQUI, com a assinatura já contada.
   *
   * `validateSendMessageParams` roda três vezes antes disto (as duas rotas e
   * o topo desta função) e sempre sobre o texto CRU — nenhuma delas sabe que
   * um prefixo vai aparecer. Sem esta segunda checagem, uma legenda de 1020
   * caracteres passa em todas, e quem recusa é a Meta: o operador recebe 502
   * de erro de servidor onde devia ler "sua legenda e longa demais".
   */
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof textoFinal === 'string' &&
    textoFinal.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      `Caption exceeds the 1024-character limit (the signature uses ${custoDaAssinatura(nomeQueAssina)} of them)`,
      400
    );
  }

  // Which number (channel) this conversation replies through. Resolves
  // the conversation's channel → the account default → whatsapp_config
  // fallback. Field names mirror whatsapp_config so the branches below
  // read the same. Behaviour is unchanged while only the default channel
  // exists (every conversation.channel_id is NULL → the default, which
  // the 901 backfill mirrored from whatsapp_config).
  //
  // ⚠️ Com `channelId` (mensagem agendada, 925) o caminho é OUTRO e não tem
  // degradação: pede-se aquele canal e confere-se que foi ele que voltou. O
  // `resolveChannelForConversation` cai para o padrão da conta quando o id
  // não resolve — silêncio que aqui vira "a mensagem saiu pelo número
  // errado". A comparação de id é o mesmo idioma de
  // `resolveEngineChannelPreferring`.
  const channel = canalExigido
    ? await resolveChannelForConversation(db, accountId, {
        channel_id: canalExigido,
      })
    : await resolveChannelForConversation(db, accountId, conversation);

  if (canalExigido && channel?.channelId !== canalExigido) {
    throw new SendMessageError(
      'channel_unavailable',
      'A conexão escolhida para esta mensagem não existe mais.',
      409
    );
  }

  if (!channel) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Instagram: o ramo de saída chega na Fase 4 do plano
  // (docs/PLANO-instagram-direct.md). Até lá falha FECHADO aqui — nunca o
  // ramo Meta com o token do Instagram e um IGSID no lugar do telefone.
  if (ehInstagram(channel)) {
    throw new SendMessageError(
      'not_supported',
      'Enviar pelo Instagram ainda não está disponível nesta versão.',
      400
    );
  }

  // ⚠️ Grupo NÃO existe na API oficial da Meta — não é limitação nossa nem
  // configuração faltando. A conversa chega aqui com canal Meta quando o
  // atendente fixou o canal na mão, e o texto precisa dizer o que fazer
  // (trocar de canal), não um "não suportado" que deixa ele sem saída.
  if (ehGrupo && ehMeta(channel)) {
    throw new SendMessageError(
      'not_supported',
      'Grupos não funcionam pela API oficial da Meta. Troque o canal desta conversa para uma conexão por QR Code antes de enviar.',
      400
    );
  }

  // Grupo com "só administradores podem enviar". Barrar aqui dá uma mensagem
  // legível; deixar seguir devolveria o erro cru da Evolution depois de a
  // mídia já ter subido. `is_announce` nulo (ainda não sincronizado) NÃO
  // bloqueia: no escuro, impedir de responder num grupo comum é pior que
  // deixar a própria Evolution recusar.
  if (ehGrupo && grupo?.is_announce === true && grupo?.we_are_admin !== true) {
    throw new SendMessageError(
      'not_allowed',
      'Neste grupo só administradores podem enviar mensagens.',
      403
    );
  }

  if (ehMeta(channel) && (!channel.phone_number_id || !channel.access_token)) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp (Meta) connection is incomplete — reconfigure it in Settings.',
      400
    );
  }

  // Meta keeps its token in access_token; Evolution its instance key in
  // api_key. Only the Meta path decrypts here (and self-heals legacy CBC —
  // only for the whatsapp_config fallback; channels are GCM from creation).
  const accessToken = ehMeta(channel) ? decrypt(channel.access_token!) : '';
  if (
    ehMeta(channel) &&
    channel.source === 'whatsapp_config' &&
    channel.legacyConfigId &&
    isLegacyFormat(channel.access_token!)
  ) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', channel.legacyConfigId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  let evolutionQuoted: ProviderMessageRef | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id, remote_jid, from_me')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no provider message id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
      // Evolution needs the whole Baileys key to quote; Meta uses just the id.
      evolutionQuoted = {
        id: parent.message_id,
        remoteJid: parent.remote_jid ?? undefined,
        fromMe: parent.from_me ?? undefined,
      };
    }
  }

  // Template row — needed for the send-builder's header + button
  // components AND for the body we persist. The lookup tolerates the
  // en / en_US split so a caller that omits the language still resolves
  // a row (see resolveTemplateRow).
  let templateRow: MessageTemplate | null = null;
  let sendLanguage = templateLanguage || 'en_US';
  if (messageType === 'template' && templateName) {
    // O 5o argumento e nosso: o catalogo da Meta e POR WABA, entao o modelo
    // tem que ser o DAQUELE numero. Sem o recorte, numa conversa fixada no 2o
    // numero Meta o atendente via o preview certo e o cliente recebia outro
    // texto — ou nada, com a Meta devolvendo "template does not exist".
    const resolved = await resolveTemplateRow(
      db,
      accountId,
      templateName,
      templateLanguage,
      channel.channelId
    );
    if (resolved.malformed) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = resolved.row;
    sendLanguage = resolved.language;
  }

  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  // For Evolution rows: the recipient JID, persisted so reactions/replies
  // can rebuild the Baileys key later. NULL for Meta.
  let outboundRemoteJid: string | null = null;

  if (ehEvolution(channel)) {
    // Evolution/Baileys has no HSM templates and unreliable native
    // buttons/lists — both are rejected up front until they degrade to
    // plain text in a later pass. Text + media are the reply MVP.
    if (messageType === 'template' || messageType === 'interactive') {
      throw new SendMessageError(
        'not_supported',
        'Templates and interactive messages are not supported on the Evolution transport yet.',
        400
      );
    }
    if (!channel.base_url || !channel.instance_name || !channel.api_key) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'Evolution connection is incomplete — reconnect WhatsApp in Settings.',
        400
      );
    }
    const transport = getTransport({
      provider: 'evolution',
      baseUrl: channel.base_url,
      instance: channel.instance_name,
      apikey: decrypt(channel.api_key),
    });
    try {
      const res = isMediaKind
        ? await transport.sendMedia({
            to: destinatario,
            kind: messageType as MediaKind,
            media: mediaUrl!,
            caption: textoFinal || undefined,
            filename: filename || undefined,
            quoted: evolutionQuoted,
          })
        : await transport.sendText({
            to: destinatario,
            text: textoFinal!,
            quoted: evolutionQuoted,
          });
      waMessageId = res.providerMessageId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Evolution error';
      console.error('[send-message] Evolution send failed:', message);
      /**
       * ⚠️ RECUSA (4xx) É DIFERENTE DE "NÃO SEI" (tempo esgotado, 5xx, rede),
       * e a diferença só passou a doer com a agendada de mídia (932).
       *
       * Quem consome isto é `CODIGOS_POS_ENTREGA` no disparador: `evolution_error`
       * significa "o WhatsApp pode já ter aceitado", e a linha vira
       * `entrega_incerta` — a tela então diz ao operador que a mensagem PODE
       * ter chegado e ESCONDE o "Tentar de novo".
       *
       * Um 4xx não é isso. A Evolution processou o pedido e recusou antes de
       * mandar: mime que o WhatsApp não aceita, arquivo grande demais, a URL
       * do anexo que ela não conseguiu baixar, chave inválida. Nada saiu.
       * Medido: agendei um anexo, apaguei o objeto do bucket e disparei — veio
       * `Request failed with status code 400` e a linha terminou afirmando que
       * o cliente podia ter recebido.
       *
       * Antes da 932 isto era raro (texto puro quase não é recusado); com
       * anexo passa a ser o modo de falha comum.
       */
      const recusa =
        err instanceof EvolutionApiError && err.status >= 400 && err.status < 500;
      throw new SendMessageError(
        recusa ? 'evolution_rejected' : 'evolution_error',
        `Evolution API error: ${message}`,
        502
      );
    }
    // Chave da Baileys para citar/reagir depois. Em grupo o JID JÁ é o
    // endereço final — pendurar `@s.whatsapp.net` nele produziria um JID
    // inválido e quebraria a citação de toda mensagem que enviarmos ao grupo.
    outboundRemoteJid = ehGrupo
      ? destinatario
      : `${toEvolutionNumber(sanitizedPhone)}@s.whatsapp.net`;
  } else {
    const attempt = async (phone: string): Promise<string> => {
      if (messageType === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: channel.phone_number_id!,
          accessToken,
          to: phone,
          templateName: templateName!,
          language: sendLanguage,
          template: templateRow ?? undefined,
          messageParams: templateMessageParams ?? undefined,
          params: templateParams || [],
          contextMessageId,
        });
        return result.messageId;
      }
      if (isMediaKind) {
        const result = await sendMediaMessage({
          phoneNumberId: channel.phone_number_id!,
          accessToken,
          to: phone,
          kind: messageType as MediaKind,
          link: mediaUrl!,
          caption: textoFinal || undefined,
          filename: filename || undefined,
          contextMessageId,
        });
        return result.messageId;
      }
      if (messageType === 'interactive') {
        const p = interactivePayload!;
        if (p.kind === 'buttons') {
          const result = await sendInteractiveButtons({
            phoneNumberId: channel.phone_number_id!,
            accessToken,
            to: phone,
            bodyText: p.body,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            buttons: p.buttons,
            contextMessageId,
          });
          return result.messageId;
        }
        const result = await sendInteractiveList({
          phoneNumberId: channel.phone_number_id!,
          accessToken,
          to: phone,
          bodyText: p.body,
          buttonLabel: p.button_label,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          sections: p.sections,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: channel.phone_number_id!,
        accessToken,
        to: phone,
        text: textoFinal!,
        contextMessageId,
      });
      return result.messageId;
    };

    // Send via Meta — retry across phone-number variants if Meta rejects
    // with "recipient not in allowed list"; persist a working variant
    // back to the contact so the next send goes straight through.
    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) {
            throw err;
          }
          lastError = err;
          console.warn(
            `[send-message] variant "${variant}" rejected by Meta, trying next…`
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[send-message] Meta send failed for all variants:', message);
      throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
    }

    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      );
      // `contact!` é seguro: este ramo inteiro é do provider Meta, e grupo
      // com canal Meta já foi recusado lá atrás — só conversa de contato
      // chega até aqui.
      await db
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact!.id);
    }
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  //
  // Templates persist the *substituted* body. The composer pre-renders
  // and posts it as contentText; every other caller (the public API,
  // most importantly) sends none, and storing null there left the
  // Inbox rendering an empty bubble — issue #483.
  const persistedText =
    messageType === 'interactive'
      ? interactivePayload!.body
      : messageType === 'template'
        ? templateContentText(
            templateRow,
            templateBodyParams(templateParams, templateMessageParams),
            contentText
          )
        : (textoFinal ?? contentText ?? null);

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      // ⚠️ Coluna que existe desde a 001 e nunca foi escrita — 894 mensagens
      // com `sender_id` nulo em produção. Sem ela não há como responder "quem
      // mandou isso" numa conta com mais de uma pessoa, que é o caso a partir
      // de agora. Nulo continua sendo resposta legítima: envio por chave de
      // API não teve gente.
      sender_id: senderUserId ?? null,
      content_type: messageType,
      // `persistedText` cobre os tres casos: corpo da interativa, corpo
      // SUBSTITUIDO do modelo (upstream #483) e, para texto, o `textoFinal`
      // ASSINADO — que e o que o cliente recebeu e o que o CRM tem de mostrar
      // (P1.2).
      content_text: persistedText,
      media_url: mediaUrl || null,
      // O nome do arquivo que a equipe subiu (969). Ele já chegava na função
      // e ia só para o WhatsApp — no CRM, a bolha do que NÓS enviamos caía no
      // mesmo rótulo genérico "Documento" que a do cliente.
      media_filename: filename || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      message_id: waMessageId,
      // Baileys key parts — only meaningful for Evolution (NULL for Meta).
      remote_jid: outboundRemoteJid,
      from_me: ehEvolution(channel) ? true : null,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  // Falar numa conversa encerrada a devolve à caixa de entrada, e quem falou
  // fica responsável por ela (regra do operador, 2026-09-02). `senderUserId`
  // nulo é envio por CHAVE DE API: reabre, mas não há quem nomear. Por aqui
  // passam os quatro envios decididos por gente — ver `reopen.ts` para o que
  // fica de fora (broadcast e robô) e por quê. LOGO DEPOIS de gravar: a
  // janela até aqui decide qual encerramento a reabertura desfaz.
  await reopenClosedConversation(db, conversation, {
    assignTo: senderUserId ?? null,
  });

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : persistedText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Carimbo de canal (Fase 3): registra por qual número esta resposta saiu.
  // Via supabaseAdmin (não depende de policy de UPDATE em messages para o
  // client do dashboard) e best-effort/deploy-safe. NULL no fallback
  // whatsapp_config → no-op.
  await stampMessageChannel(supabaseAdmin(), messageRecord.id, channel.channelId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  //
  // ⚠️ Pulado em GRUPO, e não é otimização: `flow_runs` é indexado por
  // contato, e grupo não tem um. Sem esta guarda, `contact.id` estoura em
  // todo envio para grupo — e como o bloco roda DEPOIS de a mensagem já ter
  // saído para o WhatsApp, o cliente receberia e o operador veria erro.
  //
  // ⚠️ Pulado também na mensagem AGENDADA (`pauseFlows: false`, 925). O
  // sinal é "tem gente aqui agora", e quem escreveu ontem à noite não está.
  // Uma agendada matando o fluxo de madrugada deixaria o cliente sem
  // resposta automática sem ninguém ter decidido isso.
  if (pauseFlows && !ehGrupo) {
    await abortActiveRunsForContact({
      db: supabaseAdmin(),
      accountId,
      contactId: contact!.id,
      status: 'paused_by_agent',
      reason: 'agent_replied',
    });
  }

  // Funil padrão da conexão. Este é o ponto que faz "o cliente que NÓS
  // abordamos também entra no funil" — ver o cabeçalho de
  // `pipeline-routing.ts`.
  //
  // ⚠️ DEPOIS da pausa de fluxos, de propósito. A pausa é sensível a TEMPO
  // ("tem gente aqui agora") e corre contra um robô que pode responder ao
  // cliente a qualquer momento; o funil não corre contra nada — o gatilho é
  // por estado e a próxima mensagem tentaria de novo. Pôr as consultas do
  // roteador na frente atrasaria o único dos dois que tem pressa.
  //
  // ⚠️ ESTÁ AQUI, no núcleo, de propósito — e a escolha é o que define
  // QUEM abre negócio. Por este caminho passam os quatro envios decididos
  // por gente: compositor do inbox, primeiro contato pela ficha, mensagem
  // agendada e API pública. Broadcast (`broadcast-core.ts`) e
  // automação/fluxo (`meta-send.ts`, `engine-send.ts`) NÃO passam, e é
  // assim que ficam de fora sem uma única linha de guarda: um disparo em
  // massa abriria centenas de cards de uma vez, e resposta de robô não é o
  // escritório decidindo abordar ninguém.
  //
  // ⚠️ Via `supabaseAdmin()`, como o carimbo acima: a rota
  // `/api/whatsapp/send` entrega o client do OPERADOR (sob RLS), e o
  // roteador lê `accounts` e escreve em `deals` — sob RLS isso dependeria
  // do papel de quem mandou a mensagem, e um `agent` deixaria de abrir
  // card em silêncio.
  //
  // Pulado em GRUPO pelo mesmo motivo do bloco acima: grupo não tem
  // contato individual, e card sem contato renderiza em branco no Kanban.
  // (O roteador tem a guarda própria; aqui é para nem chegar lá.)
  if (!ehGrupo && contact?.id) {
    await routeContactToPipeline({
      db: supabaseAdmin(),
      accountId,
      channelId: channel.channelId,
      contactId: contact.id,
      contactName: contact.name ?? null,
      conversationId,
    });
  }

  return {
    messageId: messageRecord.id,
    whatsappMessageId: waMessageId,
    channelId: channel.channelId,
    // O que ficou gravado — com assinatura, se ligada.
    contentText: (messageRecord.content_text as string | null) ?? null,
  };
}
