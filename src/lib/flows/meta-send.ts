import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import { assertConversationInAccount } from '@/lib/whatsapp/conversation-scope'
import {
  resolveEngineChannelPreferring,
  evolutionTransportFor,
  evolutionRemoteJid,
} from '@/lib/cb-channels/engine-send'
import { stampMessageChannel } from '@/lib/cb-channels/stamp'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import { aplicarAssinatura } from '@/lib/assinatura/assinatura'
import { nomeAutomaticoParaAssinar } from '@/lib/assinatura/resolver'
import { ehEvolution, ehInstagram } from '@/lib/cb-channels/transporte'
import type { ResolvedChannel } from '@/lib/cb-channels/resolve'

// ------------------------------------------------------------
// Flows-side Meta sender (interactive variants).
//
// Mirrors src/lib/automations/meta-send.ts (engineSendText /
// engineSendTemplate) but emits interactive button + list messages.
// Kept separate from the automations file so the two engines don't
// fight over each other's shape — once both stabilize, the
// phone-variant retry + DB persistence are obvious extraction
// candidates into a shared base.
//
// PR #1 ships this in isolation: callers don't exist yet. PR #2
// brings the flow runner online and wires it up. Shipping it now
// keeps the foundation PR self-contained and unit-testable.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean
  /** Canal de saida preferido (passo/no do operador, ou o canal do RUN).
   *  Ausente = canal atual da conversa — o comportamento de antes. */
  preferredChannelId?: string | null
}

/**
 * D1 do plano do Instagram (docs/PLANO-instagram-direct.md): fluxo, resposta
 * de IA e automação NÃO respondem no Direct na v1. Lança com motivo claro —
 * o run/log registra — em vez de cair no ramo Meta com o token do Instagram.
 */
function exigirWhatsApp(channel: ResolvedChannel): void {
  if (ehInstagram(channel)) {
    throw new Error('flows and automations do not send on Instagram channels (v1)')
  }
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 *
 * Wraps the same phone-variant retry + DB persistence pattern as the
 * interactive senders; the duplication will be DRY'd into a shared
 * `engineSendBase` once the v2 features (templates with variables,
 * media sends) settle.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  /**
   * ASSINATURA (923) — fluxo e IA NUNCA assinam com nome de gente.
   *
   * ⚠️ Este caminho serve os DOIS: `engineSendText` e chamado pelo motor de
   * fluxos e tambem pela resposta automatica da IA (`ai/auto-reply.ts`). Nem
   * um nem outro tem autor humano — o `userId` que chega aqui e o dono da
   * configuracao, nao quem respondeu. Assinar com ele diria ao cliente que
   * aquela pessoa leu o caso. Quem assina e o escritorio (P1.5), e o selo de
   * robo na bolha conta a verdade para a equipe.
   */
  const nomeQueAssina = await nomeAutomaticoParaAssinar(db, args.accountId)
  const textoFinal = aplicarAssinatura(args.text, nomeQueAssina) as string


  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  // A CONVERSA em que a mensagem vai ser gravada também tem de ser desta
  // conta (upstream #589, GHSA-m4fx-g6pr-hrw8). O id vinha de confiança, e o
  // `POST /api/automations/engine` copia o contexto do corpo: um admin de
  // outra conta gravava mensagem no fio desta. Conferido ANTES do provedor —
  // depois de a mensagem sair não há o que desfazer. Ver conversation-scope.ts.
  await assertConversationInAccount(db, args.conversationId, args.accountId, args.contactId)

  // Ficha só do Instagram (989) não tem telefone — e o robô não responde no
  // Direct na v1 (D1). Dizer isso é melhor que "contact phone invalid: null".
  if (!contact.phone) {
    throw new Error(
      'contact has no phone number (Instagram-only contact) — flows and automations do not send on Instagram (v1)',
    )
  }
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // Canal da conversa (multi-canal, Fase 5): resolve como o envio manual —
  // conversations.channel_id → canal padrão → fallback whatsapp_config.
  const channel = await resolveEngineChannelPreferring(
    db,
    args.accountId,
    args.conversationId,
    args.preferredChannelId,
  )
  if (!channel) {
    throw new Error('WhatsApp not configured for this account')
  }

  let waMessageId = ''
  let workingPhone = sanitized
  let outboundRemoteJid: string | null = null

  exigirWhatsApp(channel)
  if (ehEvolution(channel)) {
    // Texto sai pelo transport da Evolution (Baileys) — sem janela de 24h.
    const transport = evolutionTransportFor(channel)
    const res = await transport.sendText({ to: sanitized, text: textoFinal })
    waMessageId = res.providerMessageId
    outboundRemoteJid = evolutionRemoteJid(sanitized)
  } else {
    if (!channel.phone_number_id || !channel.access_token) {
      throw new Error('WhatsApp (Meta) connection is incomplete for this account')
    }
    const accessToken = decrypt(channel.access_token)

    const attempt = async (phone: string): Promise<string> => {
      const r = await sendTextMessage({
        phoneNumberId: channel.phone_number_id!,
        accessToken,
        to: phone,
        text: textoFinal,
      })
      return r.messageId
    }

    const variants = phoneVariants(sanitized)
    let lastError: unknown = null
    for (const v of variants) {
      try {
        waMessageId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError

    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
    }
  }

  const { data: insertedMsg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'text',
      // O texto ASSINADO: e o que o cliente recebeu.
      content_text: textoFinal,
      message_id: waMessageId,
      // Partes da chave Baileys — só Evolution (NULL no Meta).
      remote_jid: outboundRemoteJid,
      from_me: ehEvolution(channel) ? true : null,
      status: 'sent',
      ai_generated: args.aiGenerated ?? false,
    })
    .select('id')
    .single()
  if (msgErr) {
    throw new Error(`sent but DB insert failed: ${msgErr.message}`)
  }

  // Carimbo de canal (Fase 3) — best-effort; NULL no fallback → no-op.
  if (insertedMsg) await stampMessageChannel(db, insertedMsg.id, channel.channelId)

  await db
    .from('conversations')
    .update({
      last_message_text: textoFinal,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)

  return { whatsapp_message_id: waMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
  /** Canal de saida preferido (passo/no do operador, ou o canal do RUN).
   *  Ausente = canal atual da conversa — o comportamento de antes. */
  preferredChannelId?: string | null
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Auto-advances after the
 * send lands (same suspend semantics as send_message). Same
 * phone-variant retry + DB persistence as the text/interactive
 * senders; persists the outgoing message with `content_type` matching
 * the media kind so the inbox renders the right preview.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  /**
   * A LEGENDA tambem e assinada — mesma regra de robo do texto acima.
   * `aplicarAssinatura` devolve legenda vazia intacta, entao midia sem
   * legenda continua saindo sem assinatura (e audio nem tem legenda).
   */
  const nomeQueAssina = await nomeAutomaticoParaAssinar(db, args.accountId)
  const legendaFinal = aplicarAssinatura(args.caption, nomeQueAssina) ?? undefined


  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  // A CONVERSA em que a mensagem vai ser gravada também tem de ser desta
  // conta (upstream #589, GHSA-m4fx-g6pr-hrw8). O id vinha de confiança, e o
  // `POST /api/automations/engine` copia o contexto do corpo: um admin de
  // outra conta gravava mensagem no fio desta. Conferido ANTES do provedor —
  // depois de a mensagem sair não há o que desfazer. Ver conversation-scope.ts.
  await assertConversationInAccount(db, args.conversationId, args.accountId, args.contactId)

  // Ficha só do Instagram (989) não tem telefone — e o robô não responde no
  // Direct na v1 (D1). Dizer isso é melhor que "contact phone invalid: null".
  if (!contact.phone) {
    throw new Error(
      'contact has no phone number (Instagram-only contact) — flows and automations do not send on Instagram (v1)',
    )
  }
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // Canal da conversa (multi-canal, Fase 5) — mesmo resolve do envio manual.
  const channel = await resolveEngineChannelPreferring(
    db,
    args.accountId,
    args.conversationId,
    args.preferredChannelId,
  )
  if (!channel) {
    throw new Error('WhatsApp not configured for this account')
  }

  let waMessageId = ''
  let workingPhone = sanitized
  let outboundRemoteJid: string | null = null

  exigirWhatsApp(channel)
  if (ehEvolution(channel)) {
    // Mídia sai pelo transport da Evolution (aceita URL pública).
    const transport = evolutionTransportFor(channel)
    const res = await transport.sendMedia({
      to: sanitized,
      kind: args.kind,
      media: args.link,
      caption: legendaFinal,
      filename: args.filename,
    })
    waMessageId = res.providerMessageId
    outboundRemoteJid = evolutionRemoteJid(sanitized)
  } else {
    if (!channel.phone_number_id || !channel.access_token) {
      throw new Error('WhatsApp (Meta) connection is incomplete for this account')
    }
    const accessToken = decrypt(channel.access_token)

    const attempt = async (phone: string): Promise<string> => {
      const r = await sendMediaMessage({
        phoneNumberId: channel.phone_number_id!,
        accessToken,
        to: phone,
        kind: args.kind,
        link: args.link,
        caption: legendaFinal,
        filename: args.filename,
      })
      return r.messageId
    }

    const variants = phoneVariants(sanitized)
    let lastError: unknown = null
    for (const v of variants) {
      try {
        waMessageId = await attempt(v)
        workingPhone = v
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError

    if (workingPhone !== sanitized) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
    }
  }

  // content_type='image'|'video'|'document' — these are already in the
  // messages_content_type_check constraint (migration 001 + 010).
  // content_text carries the caption (or empty) so the conversation
  // list preview shows something meaningful when the user glances at it.
    // ⚠️ `legendaFinal`, não `args.caption`: a linha gravada leva a legenda
  // ASSINADA, e a prévia lia a crua. A lista de conversas e o fio mostravam
  // textos diferentes para a mesma mensagem. O `engineSendText` logo acima já
  // usava o texto final — as duas funções do mesmo arquivo discordavam.
const preview = legendaFinal?.trim() || `[${args.kind}]`
  const { data: insertedMsg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: args.kind,
      content_text: legendaFinal ?? null,
      // ⚠️ SEM ISTO A MÍDIA SOME DO FIO. A linha nascia com
      // `content_type = 'image'` e `media_url` nulo, então o cliente recebia a
      // imagem pelo WhatsApp e a EQUIPE via uma bolha vazia no CRM — o pior
      // formato de defeito, porque ninguém desconfia do que já saiu. O envio
      // manual sempre gravou (`send-message.ts:783`); só este caminho não.
      media_url: args.link,
      message_id: waMessageId,
      remote_jid: outboundRemoteJid,
      from_me: ehEvolution(channel) ? true : null,
      status: 'sent',
    })
    .select('id')
    .single()
  if (msgErr) {
    throw new Error(`sent but DB insert failed: ${msgErr.message}`)
  }

  // Carimbo de canal (Fase 3) — best-effort; NULL no fallback → no-op.
  if (insertedMsg) await stampMessageChannel(db, insertedMsg.id, channel.channelId)

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
  /** Canal de saida preferido (passo/no do operador, ou o canal do RUN).
   *  Ausente = canal atual da conversa — o comportamento de antes. */
  preferredChannelId?: string | null
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
  /** Canal de saida preferido (passo/no do operador, ou o canal do RUN).
   *  Ausente = canal atual da conversa — o comportamento de antes. */
  preferredChannelId?: string | null
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the Meta message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact + whatsapp_config lookups by account_id —
  // same defense-in-depth rationale as automations/meta-send.ts.
  // Migration 017 moved both tables to account-scoped tenancy.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  // A CONVERSA em que a mensagem vai ser gravada também tem de ser desta
  // conta (upstream #589, GHSA-m4fx-g6pr-hrw8). O id vinha de confiança, e o
  // `POST /api/automations/engine` copia o contexto do corpo: um admin de
  // outra conta gravava mensagem no fio desta. Conferido ANTES do provedor —
  // depois de a mensagem sair não há o que desfazer. Ver conversation-scope.ts.
  await assertConversationInAccount(db, input.conversationId, input.accountId, input.contactId)

  // Ficha só do Instagram (989) não tem telefone — e o robô não responde no
  // Direct na v1 (D1). Dizer isso é melhor que "contact phone invalid: null".
  if (!contact.phone) {
    throw new Error(
      'contact has no phone number (Instagram-only contact) — flows and automations do not send on Instagram (v1)',
    )
  }
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // Canal da conversa (multi-canal). Botões/listas não entregam via
  // Baileys — em canal Evolution o nó falha com motivo CLARO (o run
  // registra o erro), em vez de fingir que enviou.
  const channel = await resolveEngineChannelPreferring(
    db,
    input.accountId,
    input.conversationId,
    input.preferredChannelId,
  )
  if (!channel) {
    throw new Error('WhatsApp not configured for this account')
  }
  exigirWhatsApp(channel)
  if (ehEvolution(channel)) {
    throw new Error(
      'interactive messages (buttons/lists) are not supported on the Evolution (unofficial) channel',
    )
  }
  if (!channel.phone_number_id || !channel.access_token) {
    throw new Error('WhatsApp (Meta) connection is incomplete for this account')
  }

  const accessToken = decrypt(channel.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: channel.phone_number_id!,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: channel.phone_number_id!,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
    return r.messageId
  }

  // Same phone-variant retry as automations/meta-send.ts. Numbers
  // registered with/without a trunk 0 + Meta's sandbox quirks all
  // need this to reliably land a message.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // Persist the bot's prompt to the messages table so it appears in
  // the inbox. content_type='interactive' is supported as of
  // migration 010; sender_type='bot' distinguishes flow sends from
  // manual agent sends (the conversation list preview will pick up
  // last_message_text as a sensible summary).
  //
  // We do NOT set interactive_reply_id here — that column is reserved
  // for the customer's tap on this message, populated by the webhook
  // when their reply arrives. We DO persist the structured payload so
  // the inbox thread re-renders the buttons/rows the bot sent (round-
  // trip), matching the composer + automation send paths.
  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  const { data: insertedMsg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: input.bodyText,
      interactive_payload: interactivePayload,
      message_id: waMessageId,
      status: 'sent',
    })
    .select('id')
    .single()
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  // Carimbo de canal (Fase 3) — best-effort; NULL no fallback → no-op.
  if (insertedMsg) await stampMessageChannel(db, insertedMsg.id, channel.channelId)

  await db
    .from('conversations')
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)
    .eq('account_id', input.accountId)

  return { whatsapp_message_id: waMessageId }
}
