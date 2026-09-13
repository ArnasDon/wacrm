import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send'
import { decrypt } from '@/lib/whatsapp/encryption'
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
import {
  resolveTemplateRow,
  templateContentText,
} from '@/lib/whatsapp/template-body'
import { supabaseAdmin } from './admin-client'
import { aplicarAssinatura } from '@/lib/assinatura/assinatura'
import { nomeAutomaticoParaAssinar, nomePersonalizadoParaAssinar } from '@/lib/assinatura/resolver'
import { ehEvolution, ehInstagram } from '@/lib/cb-channels/transporte'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Canal de saida preferido: o do passo (cfg.channel_id) ou o do DISPARO.
   *  Ausente = canal atual da conversa (comportamento de antes). */
  preferredChannelId?: string | null
  /**
   * "Assinar como" (998, D18): o texto que assina no lugar do nome automático
   * do escritório — "Carol - financeiro". Continua sob o interruptor
   * `accounts.assinatura_ativa` e passa por `saneiaNome`. Ausente/vazio = o
   * nome automático, como sempre.
   */
  assinarComo?: string | null
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
  preferredChannelId?: string | null
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
  preferredChannelId?: string | null
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Delegates to the Flows interactive senders
 * (`engineSendInteractiveButtons` / `engineSendInteractiveList`), which
 * already own the account-scoped lookup, phone-variant retry, and the
 * `messages` insert with `interactive_payload` + `sender_type='bot'`.
 * Both engines want identical behaviour here, so there's one
 * implementation rather than a second hand-rolled copy that could drift.
 *
 * ⚠️ `preferredChannelId` PRECISA entrar no `common`. Ele já era declarado em
 * `SendInteractiveArgs` e já era calculado pelo motor (`stepChannel`), mas
 * ficava de fora do objeto repassado — e como os dois destinos aceitam o campo
 * como opcional, o compilador não reclamava. Resultado: botão e lista eram os
 * únicos envios que ignoravam tanto a escolha do passo quanto o canal do
 * DISPARO, saindo sempre pelo canal atual da conversa. É o mesmo bug que
 * apagaria o follow-up de 24h do número certo — só que calado.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { payload, accountId, userId, conversationId, contactId, preferredChannelId } = args
  const common = { accountId, userId, conversationId, contactId, preferredChannelId }
  if (payload.kind === 'buttons') {
    return engineSendInteractiveButtons({
      ...common,
      bodyText: payload.body,
      headerText: payload.header,
      footerText: payload.footer,
      buttons: payload.buttons,
    })
  }
  return engineSendInteractiveList({
    ...common,
    bodyText: payload.body,
    buttonLabel: payload.button_label,
    headerText: payload.header,
    footerText: payload.footer,
    sections: payload.sections,
  })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact + config lookups by account_id, not user_id.
  // The engine uses the service-role client (bypassing RLS); without
  // this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send via
  // their own WhatsApp config to that contact's phone. The 017
  // migration moved both tables to account-scoped tenancy, so the
  // check is the same defense-in-depth as before, just keyed on the
  // new tenancy column.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

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

  // Canal de SAIDA (multi-canal, Fase E1). Ordem: canal preferido do passo/
  // disparo → canal atual da conversa → padrão da conta → espelho legado.
  // Separar "por onde a conversa está" de "por onde ESTE envio sai" é o que
  // impede o follow-up de 24h de sair pelo número que o cliente usou no
  // meio-tempo.
  const channel = await resolveEngineChannelPreferring(
    db,
    input.accountId,
    input.conversationId,
    input.preferredChannelId,
  )
  if (!channel) {
    throw new Error('WhatsApp not configured for this account')
  }

  /**
   * ASSINATURA (923) — automacao NUNCA assina com nome de gente.
   *
   * ⚠️ `nomeAutomaticoParaAssinar`, e nao o `input.userId` que esta bem ali
   * na mao. Aquele campo e o AUTOR DA REGRA, nao quem respondeu: assinar com
   * ele diria ao cliente que aquela pessoa leu o caso e escreveu, quando na
   * verdade uma regra disparou sozinha — possivelmente de madrugada, meses
   * depois de a regra ter sido criada. Num escritorio de advocacia isso e uma
   * afirmacao seria, e falsa. Quem assina e o escritorio (P1.5).
   */
  const nomeQueAssina =
    input.kind === 'text' && input.assinarComo?.trim()
      ? await nomePersonalizadoParaAssinar(db, input.accountId, input.assinarComo)
      : await nomeAutomaticoParaAssinar(db, input.accountId)
  const textoFinal =
    input.kind === 'text'
      ? (aplicarAssinatura(input.text, nomeQueAssina) as string)
      : null

  // Local template row — read for the body we persist below, not for
  // the Meta payload (the wire shape is deliberately unchanged here).
  // A missing row is fine: the send still goes out, we just can't
  // reconstruct the text the customer saw.
  //
  // O 5o argumento e nosso: o catalogo da Meta e POR WABA, entao o modelo tem
  // que ser o do canal por onde o passo sai.
  const templateRow =
    input.kind === 'template'
      ? (
          await resolveTemplateRow(
            db,
            input.accountId,
            input.templateName,
            input.language,
            channel.channelId,
          )
        ).row
      : null

  let waMessageId = ''
  let workingPhone = sanitized
  let outboundRemoteJid: string | null = null

  // O `const attempt` que o upstream abre aqui nao entra: nesta base o envio
  // tem DOIS caminhos (Evolution e Meta), e o `attempt` equivalente ja vive
  // dentro do ramo Meta, mais abaixo.
  // D1 do plano do Instagram (docs/PLANO-instagram-direct.md): automação
  // NÃO responde no Direct na v1 — falha CLARA (a execução registra o
  // motivo), nunca o ramo Meta com o token do Instagram.
  if (ehInstagram(channel)) {
    throw new Error(
      'automations do not send on Instagram channels (v1) — this step needs a WhatsApp number',
    )
  }
  if (ehEvolution(channel)) {
    if (input.kind === 'template') {
      // Template é conceito da API oficial — falha CLARA em canal Evolution
      // (a execução da automação registra o motivo), nada de envio fantasma.
      throw new Error(
        'templates are not supported on the Evolution (unofficial) channel — this step needs an official Meta number',
      )
    }
    // Texto sai pelo transport da Evolution (Baileys) — sem janela de 24h.
    const transport = evolutionTransportFor(channel)
    const res = await transport.sendText({ to: sanitized, text: textoFinal! })
    waMessageId = res.providerMessageId
    outboundRemoteJid = evolutionRemoteJid(sanitized)
  } else {
    if (!channel.phone_number_id || !channel.access_token) {
      throw new Error('WhatsApp (Meta) connection is incomplete for this account')
    }
    const accessToken = decrypt(channel.access_token)

    const attempt = async (phone: string): Promise<string> => {
      if (input.kind === 'template') {
        const r = await sendTemplateMessage({
          phoneNumberId: channel.phone_number_id!,
          accessToken,
          to: phone,
          templateName: input.templateName,
          language: input.language,
          params: input.params,
        })
        return r.messageId
      }
      const r = await sendTextMessage({
        phoneNumberId: channel.phone_number_id!,
        accessToken,
        to: phone,
        text: textoFinal!,
      })
      return r.messageId
    }

    // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
    // numbers registered with/without a trunk 0 both require this to
    // reliably land a message.
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

  // Persist the sent message so it appears in the inbox with a real
  // provider message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  // O que o cliente recebeu, nos dois casos:
  //  - texto  -> o ASSINADO (nosso `textoFinal`, P1.5), nao o cru `input.text`
  //  - modelo -> o corpo SUBSTITUIDO (upstream #483); antes ficava null e a
  //              bolha do template nascia vazia no inbox
  const content_text =
    input.kind === 'text'
      ? textoFinal
      : templateContentText(templateRow, input.params ?? [])
  const template_name = input.kind === 'template' ? input.templateName : null

  const { data: insertedMsg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type,
      content_text,
      template_name,
      message_id: waMessageId,
      // Partes da chave Baileys — só Evolution (NULL no Meta).
      remote_jid: outboundRemoteJid,
      from_me: ehEvolution(channel) ? true : null,
      status: 'sent',
    })
    .select('id')
    .single()
  if (msgErr) {
    // The provider already has the message; record the DB error but don't
    // pretend the send failed. The engine wraps this in a log line.
    throw new Error(`sent but DB insert failed: ${msgErr.message}`)
  }

  // Carimbo de canal (Fase 3) — best-effort; NULL no fallback → no-op.
  if (insertedMsg) await stampMessageChannel(db, insertedMsg.id, channel.channelId)

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template'
          ? (content_text ?? `[template:${input.templateName}]`)
          : textoFinal!,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
