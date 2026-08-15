import type { SupabaseClient } from '@supabase/supabase-js'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'

/**
 * Apply an AI-chosen tag to a contact.
 *
 * Re-validates the tag at write time (existence, account ownership,
 * `ai_assignable`) rather than trusting the enum built at prompt time —
 * closes the race where a tag is deleted or detoggled between prompt
 * construction and the model's tool call. The actual write + `tag_added`
 * dispatch is delegated to the shared `addContactTagAndDispatch` — the
 * same path every other tag-adding surface in the app goes through
 * (manual UI, API v1, the automation engine's own `add_tag` step).
 */
export async function applyAiTag(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    conversationId: string
    tagId: string
  },
): Promise<{ applied: boolean; tagName: string | null }> {
  const { accountId, contactId, conversationId, tagId } = args

  const { data: tag } = await db
    .from('tags')
    .select('id, name')
    .eq('id', tagId)
    .eq('account_id', accountId)
    .eq('ai_assignable', true)
    .maybeSingle()

  if (!tag) return { applied: false, tagName: null }

  const { added } = await addContactTagAndDispatch({
    db,
    accountId,
    contactId,
    tagId,
    context: { conversation_id: conversationId },
  })
  if (!added) return { applied: false, tagName: null }

  return { applied: true, tagName: tag.name as string }
}
