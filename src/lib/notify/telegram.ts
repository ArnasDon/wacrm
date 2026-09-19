import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { NotifyEvent, OrderDoc, TelegramConfigDoc } from '@/lib/db/types'
import { formatMoney } from '@/lib/money'
import { decrypt } from '@/lib/security/secrets'

// ============================================================
// Per-merchant Telegram push notifications.
//
// Tenant isolation: the config (bot token + linked chat ids) is read
// through scopedCollection(ctx) — so a notification for account A can
// only ever be sent with A's bot to A's chats. There is no shared
// bot and no global chat list. A chat is linked only after someone
// sends the account's one-time link code TO THE MERCHANT'S OWN BOT,
// proving they control both.
//
// All sends are best-effort: a Telegram outage never fails an order.
// ============================================================

const API = 'https://api.telegram.org'
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/

export class TelegramError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TelegramError'
  }
}

export function isValidBotToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

async function tg<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  if (!isValidBotToken(token)) throw new TelegramError('Invalid bot token format')
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string }
    if (!json.ok) {
      if (res.status === 401) throw new TelegramError('Telegram rejected the bot token')
      throw new TelegramError(json.description?.slice(0, 200) ?? `Telegram error ${res.status}`)
    }
    return json.result as T
  } catch (err) {
    if (err instanceof TelegramError) throw err
    throw new TelegramError('Telegram is unreachable')
  } finally {
    clearTimeout(t)
  }
}

export async function getBotInfo(token: string): Promise<{ id: string; username: string }> {
  const me = await tg<{ id: number; username: string }>(token, 'getMe')
  return { id: String(me.id), username: me.username }
}

interface TgUpdate {
  update_id: number
  message?: { text?: string; chat: { id: number; title?: string; first_name?: string; username?: string; type: string } }
}

/**
 * Link chats that sent "/start <code>" (or just the code) to the
 * merchant's bot. Uses getUpdates polling, so it works without a
 * public webhook URL (local installs, private servers).
 */
export async function pollForLinks(ctx: AuthContext): Promise<{ linked: string[] }> {
  const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
  const cfg = await configs.findOne({})
  if (!cfg) throw new TelegramError('Telegram bot is not connected')
  const token = decrypt(cfg.botTokenEnc)
  const updates = await tg<TgUpdate[]>(token, 'getUpdates', {
    offset: cfg.lastUpdateId + 1,
    timeout: 0,
    allowed_updates: ['message'],
  })
  const linked: string[] = []
  let lastId = cfg.lastUpdateId
  for (const u of updates) {
    lastId = Math.max(lastId, u.update_id)
    const text = u.message?.text?.trim() ?? ''
    const code = text.replace(/^\/start\s*/i, '').trim()
    if (!u.message || code !== cfg.linkCode) continue
    const chat = u.message.chat
    const chatId = String(chat.id)
    if (cfg.chats.some((c) => c.chatId === chatId) || cfg.chats.length >= 10) continue
    const title = (chat.title ?? chat.first_name ?? chat.username ?? 'Telegram chat').slice(0, 80)
    await configs.updateById(cfg._id, { $push: { chats: { chatId, title, linkedAt: new Date() } } })
    linked.push(title)
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: '✅ Connected! You will get order and payment alerts here.',
    }).catch(() => {})
  }
  if (lastId !== cfg.lastUpdateId) await configs.updateById(cfg._id, { $set: { lastUpdateId: lastId } })
  return { linked }
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

/** Send `html` to every chat linked to THIS account's bot. Never throws. */
export async function notifyMerchant(ctx: AuthContext, event: NotifyEvent, html: string): Promise<void> {
  try {
    const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
    const cfg = await configs.findOne({ enabled: true })
    if (!cfg || !cfg.events[event] || cfg.chats.length === 0) return
    const token = decrypt(cfg.botTokenEnc)
    await Promise.all(
      cfg.chats.map((c) =>
        tg(token, 'sendMessage', {
          chat_id: c.chatId,
          text: html.slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }).catch((err) => console.warn('[telegram] send failed', (err as Error).message)),
      ),
    )
  } catch (err) {
    console.warn('[telegram] notify failed', (err as Error).message)
  }
}

export async function sendTestNotification(ctx: AuthContext): Promise<number> {
  const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
  const cfg = await configs.findOne({})
  if (!cfg) throw new TelegramError('Telegram bot is not connected')
  if (cfg.chats.length === 0) throw new TelegramError('No chats linked yet')
  const token = decrypt(cfg.botTokenEnc)
  for (const c of cfg.chats) {
    await tg(token, 'sendMessage', { chat_id: c.chatId, text: '🔔 Test notification from your WhatsApp sales CRM.' })
  }
  return cfg.chats.length
}

// ---------- message builders ----------

function itemsLine(order: OrderDoc): string {
  return order.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(', ')
}

export function notifyOrderCreated(ctx: AuthContext, order: OrderDoc): Promise<void> {
  const who = esc(order.customer.name ?? (order.customer.phone ? `+${order.customer.phone}` : 'A customer'))
  return notifyMerchant(
    ctx,
    'orderCreated',
    `🛒 <b>New order ${esc(order.number)}</b>\n${who} — ${esc(formatMoney(order.total, order.currency))}\n${itemsLine(order)}\n<i>via ${order.source === 'manual' ? 'staff' : order.source === 'ai' ? 'AI sales rep' : 'auto-detect'}</i>`,
  )
}

export function notifyOrderPaid(ctx: AuthContext, order: OrderDoc): Promise<void> {
  const who = esc(order.customer.name ?? (order.customer.phone ? `+${order.customer.phone}` : 'Customer'))
  const via = order.payment.provider === 'paystack' ? 'Paystack' : order.payment.provider === 'flutterwave' ? 'Flutterwave' : order.payment.provider === 'bank_transfer' ? 'bank transfer' : 'manual'
  return notifyMerchant(
    ctx,
    'orderPaid',
    `✅ <b>Sale closed — ${esc(order.number)} paid</b>\n${who} paid ${esc(formatMoney(order.payment.amountPaid ?? order.total, order.currency))} via ${via}\n${itemsLine(order)}\nReceipt sent to the customer.`,
  )
}

export function notifyProofSubmitted(ctx: AuthContext, order: OrderDoc): Promise<void> {
  const who = esc(order.customer.name ?? (order.customer.phone ? `+${order.customer.phone}` : 'A customer'))
  return notifyMerchant(
    ctx,
    'proofSubmitted',
    `🧾 <b>Transfer proof to review</b>\n${who} sent a payment screenshot for ${esc(order.number)} (${esc(formatMoney(order.total, order.currency))}).\nCheck your bank app, then confirm it in Orders → Payment proofs.`,
  )
}

export function notifyHandoff(ctx: AuthContext, customer: string, reason: string): Promise<void> {
  return notifyMerchant(ctx, 'handoff', `🙋 <b>Customer needs a person</b>\n${esc(customer)}\n<i>${esc(reason)}</i>`)
}
