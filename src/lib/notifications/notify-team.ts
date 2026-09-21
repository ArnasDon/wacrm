import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, isOutsideSessionWindowError } from '@/lib/whatsapp/phone-utils'
import { findApprovedTemplateByName } from '@/lib/eter/repo/message-templates.repo'

// ============================================================
// notify-team.ts — avisos ao Ricardo/equipa em dois eventos do modo
// comercial: handoff (conversa passada à equipa) e reunião marcada
// (book_commercial_meeting). Dois canais, cada um à prova de falha:
//
//   1. Mattermost — um incoming webhook (MATTERMOST_WEBHOOK_URL), uma
//      mensagem por evento, para o canal onde o webhook foi criado
//      (por omissão, "leads-whatsapp" na equipa team.etergrowth.com).
//   2. WhatsApp — texto livre para cada número em
//      `ai_configs.notify_phone_numbers` (migração 053), pelo mesmo
//      número de WhatsApp Business da conta (`whatsapp_config`), com o
//      mesmo mecanismo de fallback para template aprovado fora da
//      janela de 24h que `whatsapp-admin-alert.ts` já usa.
//
// Nunca lança: cada canal falha para o seu lado sem afectar o outro
// nem a conversa/marcação que disparou o aviso — ver doc comment de
// `sendWhatsAppAdminAlert` (mesmo espírito). Toda a falha fica em log
// com uma razão clara, nunca engolida em silêncio.
// ============================================================

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

/** Mesmo nome de template usado por whatsapp-admin-alert.ts — uma única
 *  provisão em WhatsApp Manager serve os dois canais de alerta interno. */
const NOTIFY_TEMPLATE_NAME = 'eter_admin_alert'
const TEMPLATE_PARAM_MAX = 1024

export interface HandoffNotifyInput {
  accountId: string
  conversationId: string
  contactName: string | null
  company: string | null
  phone: string | null
  email: string | null
  reason: string | null
  /** Últimas mensagens da conversa (mais antiga primeiro), já em texto simples. */
  lastMessages: { role: 'user' | 'assistant' | string; content: string }[]
  conversationUrl: string
}

export interface MeetingNotifyInput {
  accountId: string
  contactName: string | null
  company: string | null
  startsAt: Date
  timezone: string
  eventUrl: string | null
}

export type NotifyChannelOutcome =
  | { sent: true; via: 'text' | 'template' | 'webhook' }
  | { sent: false; reason: string }

export interface NotifyTeamOutcome {
  mattermost: NotifyChannelOutcome
  whatsapp: NotifyChannelOutcome[]
}

function formatDateTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

function truncateQuote(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

function buildHandoffMattermostText(input: HandoffNotifyInput): string {
  const lines = [
    ':rotating_light: **Handoff — conversa passada à equipa**',
    `Nome: ${input.contactName ?? 'desconhecido'}`,
    `Empresa: ${input.company ?? 'desconhecida'}`,
    `Telefone: ${input.phone ?? 'desconhecido'}`,
    `Email: ${input.email ?? 'desconhecido'}`,
    `Motivo: ${input.reason ?? 'não indicado'}`,
  ]
  if (input.lastMessages.length > 0) {
    lines.push('', 'Últimas mensagens:')
    for (const m of input.lastMessages.slice(-3)) {
      const who = m.role === 'user' ? 'Lead' : 'Agente'
      lines.push(`- ${who}: ${truncateQuote(m.content, 200)}`)
    }
  }
  lines.push('', `Conversa: ${input.conversationUrl}`)
  return lines.join('\n')
}

function buildHandoffWhatsAppText(input: HandoffNotifyInput): string {
  const parts = [
    `Handoff: ${input.contactName ?? 'lead desconhecido'}`,
    input.company ? `(${input.company})` : null,
    input.phone ? `tel ${input.phone}` : null,
    input.reason ? `motivo: ${truncateQuote(input.reason, 80)}` : null,
    input.conversationUrl,
  ].filter(Boolean)
  return parts.join(' — ')
}

function buildMeetingMattermostText(input: MeetingNotifyInput): string {
  const lines = [
    ':calendar: **Reunião comercial marcada**',
    `Nome: ${input.contactName ?? 'desconhecido'}`,
    `Empresa: ${input.company ?? 'desconhecida'}`,
    `Quando: ${formatDateTime(input.startsAt, input.timezone)}`,
  ]
  if (input.eventUrl) lines.push(`Evento: ${input.eventUrl}`)
  return lines.join('\n')
}

function buildMeetingWhatsAppText(input: MeetingNotifyInput): string {
  const parts = [
    `Reunião marcada: ${input.contactName ?? 'lead desconhecido'}`,
    input.company ? `(${input.company})` : null,
    formatDateTime(input.startsAt, input.timezone),
    input.eventUrl,
  ].filter(Boolean)
  return parts.join(' — ')
}

/**
 * Envia uma mensagem simples para o canal Mattermost via incoming
 * webhook (`MATTERMOST_WEBHOOK_URL`). Sem a variável configurada,
 * devolve `sent: false` e regista o motivo — nunca lança.
 */
async function postToMattermost(text: string): Promise<NotifyChannelOutcome> {
  const url = process.env.MATTERMOST_WEBHOOK_URL
  if (!url) {
    console.error('[notify-team] MATTERMOST_WEBHOOK_URL não configurada, aviso NÃO enviado ao Mattermost.')
    return { sent: false, reason: 'webhook_not_configured' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[notify-team] Mattermost respondeu ${res.status}: ${body}`)
      return { sent: false, reason: `mattermost_http_${res.status}` }
    }
    return { sent: true, via: 'webhook' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-team] falha a contactar o Mattermost:', message)
    return { sent: false, reason: `send_failed: ${message}` }
  }
}

/**
 * Envia texto por WhatsApp a um número, com o mesmo fallback para
 * template aprovado fora da janela de 24h de `whatsapp-admin-alert.ts`.
 * Nunca lança.
 */
async function sendWhatsAppToNumber(
  db: SupabaseClient,
  accountId: string,
  rawPhone: string,
  text: string,
): Promise<NotifyChannelOutcome> {
  const to = sanitizePhoneForMeta(rawPhone)
  if (!isValidE164(to)) {
    console.error(`[notify-team] número inválido em notify_phone_numbers ("${rawPhone}"), aviso NÃO enviado.`)
    return { sent: false, reason: 'invalid_phone' }
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !config) {
    console.error(`[notify-team] whatsapp_config não encontrado para account_id=${accountId}, aviso NÃO enviado.`)
    return { sent: false, reason: 'whatsapp_config_not_found' }
  }

  let accessToken: string
  try {
    accessToken = decrypt((config as { access_token: string }).access_token)
  } catch (err) {
    console.error('[notify-team] falha a decifrar o access_token do WhatsApp:', err)
    return { sent: false, reason: 'access_token_decrypt_failed' }
  }
  const phoneNumberId = (config as { phone_number_id: string }).phone_number_id

  try {
    await sendTextMessage({ phoneNumberId, accessToken, to, text })
    return { sent: true, via: 'text' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isOutsideSessionWindowError(message)) {
      console.error('[notify-team] falha a enviar aviso por WhatsApp (texto livre):', message)
      return { sent: false, reason: `send_failed: ${message}` }
    }
    // Fora da janela de 24h — cai para o template aprovado, se existir.
  }

  const template = await findApprovedTemplateByName(db, accountId, NOTIFY_TEMPLATE_NAME).catch((err) => {
    console.error('[notify-team] falha a procurar o template de alerta aprovado:', err)
    return null
  })

  if (!template) {
    console.error(
      `[notify-team] fora da janela de 24h e sem template aprovado "${NOTIFY_TEMPLATE_NAME}" para ` +
        `account_id=${accountId}. Aviso NÃO enviado (janela fechada, sem template alternativo).`,
    )
    return { sent: false, reason: 'outside_window_no_template' }
  }

  try {
    await sendTemplateMessage({
      phoneNumberId,
      accessToken,
      to,
      templateName: template.name,
      language: template.language,
      params: [text.length > TEMPLATE_PARAM_MAX ? `${text.slice(0, TEMPLATE_PARAM_MAX - 1)}…` : text],
    })
    return { sent: true, via: 'template' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-team] falha a enviar o template de alerta:', message)
    return { sent: false, reason: `template_send_failed: ${message}` }
  }
}

async function sendToConfiguredNumbers(
  accountId: string,
  text: string,
): Promise<NotifyChannelOutcome[]> {
  const db = admin()
  const { data: config, error } = await db
    .from('ai_configs')
    .select('notify_phone_numbers')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !config) {
    console.error(`[notify-team] ai_configs não encontrado para account_id=${accountId}, sem números a avisar.`)
    return []
  }

  const numbers = ((config as { notify_phone_numbers?: string[] | null }).notify_phone_numbers ?? []).filter(
    (n) => n && n.trim(),
  )
  if (numbers.length === 0) return []

  return Promise.all(numbers.map((n) => sendWhatsAppToNumber(db, accountId, n, text)))
}

/**
 * Avisa a equipa (Mattermost + WhatsApp) de um handoff. Best-effort nos
 * dois canais — nunca lança, chamar depois de a conversa já estar
 * marcada como `team_requested_at` na base de dados (esta função não
 * escreve nada, só notifica).
 */
export async function notifyHandoff(input: HandoffNotifyInput): Promise<NotifyTeamOutcome> {
  const mattermostText = buildHandoffMattermostText(input)
  const whatsappText = buildHandoffWhatsAppText(input)

  const [mattermost, whatsapp] = await Promise.all([
    postToMattermost(mattermostText).catch((err) => {
      console.error('[notify-team] erro inesperado a notificar Mattermost (handoff):', err)
      return { sent: false, reason: 'unexpected_error' } as NotifyChannelOutcome
    }),
    sendToConfiguredNumbers(input.accountId, whatsappText).catch((err) => {
      console.error('[notify-team] erro inesperado a notificar WhatsApp (handoff):', err)
      return [] as NotifyChannelOutcome[]
    }),
  ])

  return { mattermost, whatsapp }
}

/**
 * Avisa a equipa (Mattermost + WhatsApp) de uma reunião comercial
 * marcada. Best-effort nos dois canais — nunca lança, chamar depois de
 * `bookCommercialSlot` devolver `status: 'booked'`.
 */
export async function notifyMeetingBooked(input: MeetingNotifyInput): Promise<NotifyTeamOutcome> {
  const mattermostText = buildMeetingMattermostText(input)
  const whatsappText = buildMeetingWhatsAppText(input)

  const [mattermost, whatsapp] = await Promise.all([
    postToMattermost(mattermostText).catch((err) => {
      console.error('[notify-team] erro inesperado a notificar Mattermost (reunião):', err)
      return { sent: false, reason: 'unexpected_error' } as NotifyChannelOutcome
    }),
    sendToConfiguredNumbers(input.accountId, whatsappText).catch((err) => {
      console.error('[notify-team] erro inesperado a notificar WhatsApp (reunião):', err)
      return [] as NotifyChannelOutcome[]
    }),
  ])

  return { mattermost, whatsapp }
}
