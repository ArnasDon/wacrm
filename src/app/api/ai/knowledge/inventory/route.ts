import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * DELETE /api/ai/knowledge/inventory  (admin+)
 *
 * Remove all inventory-type documents for the current account.
 * Chunks are cascade-deleted by the FK.
 */
export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const adminDb = supabaseAdmin()
    const { error } = await adminDb
      .from('ai_knowledge_documents')
      .delete()
      .eq('account_id', accountId)
      .eq('type', 'inventory')
    if (error) {
      console.error('[ai/knowledge/inventory DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete inventory.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
