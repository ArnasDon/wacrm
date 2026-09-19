import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { NotifyEvent, TelegramConfigDoc } from '@/lib/db/types'
import { readJson, ValidationError } from '@/lib/http/errors'
import { bool, oneOf, str } from '@/lib/http/validate'
import {
  getBotInfo,
  isValidBotToken,
  pollForLinks,
  sendTestNotification,
  TelegramError,
} from '@/lib/notify/telegram'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/security/secrets'

const EVENTS: NotifyEvent[] = ['orderCreated', 'orderPaid', 'proofSubmitted', 'handoff']

function shape(c: TelegramConfigDoc | null) {
  if (!c) return { connected: false }
  return {
    connected: true,
    enabled: c.enabled,
    botUsername: c.botUsername,
    linkCode: c.linkCode,
    deepLink: `https://t.me/${c.botUsername}?start=${c.linkCode}`,
    chats: c.chats.map((ch) => ({ chatId: ch.chatId, title: ch.title, linkedAt: ch.linkedAt })),
    events: c.events,
  }
}

function asHttp(err: unknown): never {
  if (err instanceof TelegramError) throw new ValidationError(err.message)
  throw err
}

/** GET — this merchant's bot + linked chats. Admin+. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
    return NextResponse.json(shape(await configs.findOne({})))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT { botToken } — connect (or replace) the merchant's own bot. Admin+. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const token = str(body.botToken, 'botToken', { max: 120 })
    if (!isValidBotToken(token)) throw new ValidationError('That does not look like a bot token from @BotFather')
    const bot = await getBotInfo(token).catch(asHttp)

    const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
    const existing = await configs.findOne({})
    // A new bot starts with no linked chats — chats proved ownership
    // of the OLD bot, not this one.
    const sameBot = existing?.botId === bot.id
    const saved = await configs.findOneAndUpdate(
      {},
      {
        $set: {
          botTokenEnc: encrypt(token),
          botUsername: bot.username,
          botId: bot.id,
          linkCode: sameBot && existing ? existing.linkCode : `link-${randomBytes(6).toString('hex')}`,
          chats: sameBot && existing ? existing.chats : [],
          lastUpdateId: sameBot && existing ? existing.lastUpdateId : 0,
          enabled: true,
          events: existing?.events ?? { orderCreated: true, orderPaid: true, proofSubmitted: true, handoff: true },
        },
      },
      { upsert: true },
    )
    return NextResponse.json(shape(saved))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST { action: link | test | unlink | events, ... }
 *   link   — look for "/start <code>" messages sent to the bot
 *   test   — send a test alert to every linked chat
 *   unlink { chatId }
 *   events { event, enabled } / { enabled } for the whole integration
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const action = oneOf(body.action, 'action', ['link', 'test', 'unlink', 'events'] as const)
    const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
    if (action === 'link') {
      const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
      if (!limit.success) return rateLimitResponse(limit)
      const { linked } = await pollForLinks(ctx).catch(asHttp)
      return NextResponse.json({ linked, ...shape(await configs.findOne({})) })
    }
    if (action === 'test') {
      const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
      if (!limit.success) return rateLimitResponse(limit)
      const count = await sendTestNotification(ctx).catch(asHttp)
      return NextResponse.json({ ok: true, count })
    }
    if (action === 'unlink') {
      const chatId = str(body.chatId, 'chatId', { max: 30 })
      await configs.updateOne({}, { $pull: { chats: { chatId } } })
      return NextResponse.json(shape(await configs.findOne({})))
    }
    // events
    if ('event' in body) {
      const event = oneOf(body.event, 'event', EVENTS)
      await configs.updateOne({}, { $set: { [`events.${event}`]: bool(body.enabled, 'enabled') } })
    } else {
      await configs.updateOne({}, { $set: { enabled: bool(body.enabled, 'enabled') } })
    }
    return NextResponse.json(shape(await configs.findOne({})))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
    await configs.deleteMany({})
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
