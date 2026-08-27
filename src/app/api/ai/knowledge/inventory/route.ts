import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { deleteDataSource, findLegacyDefaultDataSource } from '@/lib/ai/data-sources/service'

/**
 * DELETE /api/ai/knowledge/inventory  (admin+)
 *
 * Kept for compatibility with AiKnowledgeCard's inventory uploader.
 * Now deletes the account's legacy default Data Source (see migration
 * 045) — its ai_catalog_products rows and linked KB document cascade
 * with it (AI_Catalog_Fix_Kit FASE 2/3 unification). A no-op (still
 * `success: true`) when there's nothing to delete, matching the old
 * route's idempotent-DELETE behavior.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const existing = await findLegacyDefaultDataSource(supabase, accountId)
    if (existing) {
      await deleteDataSource(supabase, accountId, existing.id)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
