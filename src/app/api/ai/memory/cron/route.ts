import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { summarizeAndStoreMemory } from '@/lib/ai/contact-memory'

export const runtime = 'nodejs'

interface MemoryConversationRow {
  id: string
  account_id: string
  contact_id: string
  last_message_at: string | null
}

function validSecret(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

function inactiveHours(): number {
  const configured = Number(process.env.AI_MEMORY_INACTIVE_HOURS)
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : 24
}

function isCurrentMemory(
  memoryTimestamp: string | null | undefined,
  conversationTimestamp: string | null,
): boolean {
  if (!memoryTimestamp || !conversationTimestamp) return false
  return new Date(memoryTimestamp).getTime() >= new Date(conversationTimestamp).getTime()
}

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!validSecret(request.headers.get('x-cron-secret') ?? '', expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const now = new Date()
  const inactiveBefore = new Date(
    now.getTime() - inactiveHours() * 60 * 60 * 1_000,
  ).toISOString()
  const { count: pruned = 0, error: pruneError } = await db
    .from('contact_memories')
    .delete({ count: 'exact' })
    .lt('expires_at', now.toISOString())
  if (pruneError) {
    console.error('[ai memory cron] expiry cleanup failed:', pruneError)
  }

  const { data, error } = await db
    .from('conversations')
    .select('id, account_id, contact_id, last_message_at')
    .not('last_message_at', 'is', null)
    .or(`status.eq.closed,last_message_at.lte.${inactiveBefore}`)
    .order('last_message_at', { ascending: true })
    .limit(25)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  let skipped = 0
  let failed = 0
  for (const conversation of (data ?? []) as MemoryConversationRow[]) {
    try {
      const { data: existing, error: existingError } = await db
        .from('contact_memories')
        .select('source_last_message_at')
        .eq('account_id', conversation.account_id)
        .eq('conversation_id', conversation.id)
        .maybeSingle()
      if (existingError) throw existingError
      if (
        isCurrentMemory(
          existing?.source_last_message_at,
          conversation.last_message_at,
        )
      ) {
        skipped += 1
        continue
      }

      const config = await loadAiConfig(db, conversation.account_id)
      if (!config) {
        skipped += 1
        continue
      }

      const { data: messageRows, error: messageError } = await db
        .from('messages')
        .select('sender_type, content_text, created_at')
        .eq('conversation_id', conversation.id)
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (messageError) throw messageError

      const transcript = (messageRows ?? [])
        .reverse()
        .map((message) => {
          const text = message.content_text?.trim()
          if (!text) return null
          const speaker =
            message.sender_type === 'customer' ? 'Cliente' : 'Empresa'
          return `${speaker}: ${text}`
        })
        .filter((line): line is string => Boolean(line))
        .join('\n')
      if (!transcript) {
        skipped += 1
        continue
      }

      await summarizeAndStoreMemory({
        db,
        accountId: conversation.account_id,
        contactId: conversation.contact_id,
        conversationId: conversation.id,
        config,
        transcript,
        sourceLastMessageAt: conversation.last_message_at,
      })
      processed += 1
    } catch (error) {
      failed += 1
      console.error('[ai memory cron] conversation failed:', {
        conversationId: conversation.id,
        error,
      })
    }
  }

  return NextResponse.json({
    processed,
    skipped,
    failed,
    pruned: pruned ?? 0,
    inactive_before: inactiveBefore,
  })
}
