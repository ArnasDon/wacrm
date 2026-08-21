import type { SupabaseClient } from '@supabase/supabase-js'

// Bounds how much of the account's quick-reply library reaches the
// prompt — same reasoning as MAX_PRODUCTS_IN_PROMPT in catalog-context.ts.
const MAX_QUICK_REPLIES_IN_PROMPT = 30
const MAX_PREVIEW_CHARS = 160

export interface QuickReplyPromptOption {
  id: string
  title: string
  preview: string
}

/**
 * Compact, prompt-ready list of the account's 'text'-kind quick
 * replies, so the model can pick one by id instead of paraphrasing it.
 * 'interactive'-kind quick replies (buttons/list messages) are
 * deliberately excluded — the auto-reply pipeline only ever sends
 * plain text, so an interactive snippet has no safe send path here.
 * Returns null when the account has none, so callers can simply omit
 * the quick-replies section from the prompt in that case.
 */
export async function loadQuickReplyContext(
  db: SupabaseClient,
  accountId: string,
): Promise<QuickReplyPromptOption[] | null> {
  const { data } = await db
    .from('quick_replies')
    .select('id, title, content_text')
    .eq('account_id', accountId)
    .eq('kind', 'text')
    .not('content_text', 'is', null)
    .order('title')
    .limit(MAX_QUICK_REPLIES_IN_PROMPT)
  if (!data || data.length === 0) return null

  const options = (data as { id: string; title: string; content_text: string }[])
    .filter((qr) => qr.content_text.trim().length > 0)
    .map((qr) => ({
      id: qr.id,
      title: qr.title,
      preview: truncate(qr.content_text, MAX_PREVIEW_CHARS),
    }))
  return options.length > 0 ? options : null
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
