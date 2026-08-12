import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/ai/memory
 *
 * The account's persisted contact memories (Agentes -> Memória), newest
 * first. Read-only visibility over what src/lib/ai/contact-memory.ts
 * already extracts and stores — this route adds no new memory logic,
 * just a way to see and (via DELETE /api/ai/memory/[id]) remove it.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('contact_memories')
      .select(
        'id, summary, source_last_message_at, expires_at, created_at, updated_at, contact:contacts(id, name, phone)',
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('[ai/memory GET] error:', error)
      return NextResponse.json({ error: 'Failed to load memories' }, { status: 500 })
    }
    return NextResponse.json({ memories: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
