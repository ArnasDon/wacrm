import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Closed-vocabulary "apply an existing tag" tool.
//
// The model is only ever offered tags the account has explicitly
// opted in (`tags.ai_assignable`) — it can never create a tag, and
// never sees a free-text field for the tag itself. "Which tags, when"
// is entirely the account's own system prompt; this file only builds
// the enum from what already exists.
// ============================================================

export interface AssignableTag {
  id: string
  name: string
}

/** Tags this account has opted in to AI tag-application. */
export async function loadAssignableTags(
  db: SupabaseClient,
  accountId: string,
): Promise<AssignableTag[]> {
  const { data, error } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('ai_assignable', true)

  if (error || !data) return []
  return data as AssignableTag[]
}

export const ADD_TAG_TOOL_NAME = 'add_tag'

/** Provider-agnostic tool definition; each adapter renders this into
 *  its own wire format (OpenAI `function` vs Anthropic `input_schema`). */
export interface ToolDef {
  name: string
  description: string
  tagIds: string[]
}

/**
 * Build the `add_tag` tool definition from the account's assignable
 * tags. Returns `null` when there are none — callers must omit the
 * `tools` field entirely in that case, not send an empty enum.
 */
export function buildAddTagTool(tags: AssignableTag[]): ToolDef | null {
  if (tags.length === 0) return null

  const catalogue = tags.map((t) => `- ${t.id} (${t.name})`).join('\n')
  const description =
    "Apply an existing tag to this conversation's contact when the conversation context " +
    "clearly indicates it's relevant. Only use this when it's a genuine match — do not apply " +
    'a tag out of uncertainty, and never invent a tag that is not in the list below.\n\n' +
    `Available tags (id — name):\n${catalogue}`

  return {
    name: ADD_TAG_TOOL_NAME,
    description,
    tagIds: tags.map((t) => t.id),
  }
}

/** Safety cap: at most this many tags applied per AI response, even if
 *  the model calls the tool more times in one turn. */
export const MAX_AI_TAGS_PER_REPLY = 2

/**
 * Dedupe `add_tag` calls by tag id (first occurrence wins) and cap at
 * `MAX_AI_TAGS_PER_REPLY` — shared by every caller that executes tool
 * calls (real auto-reply, playground preview), so the cap can't drift
 * between them.
 */
export function dedupeAndCapToolCalls<T extends { tagId: string }>(calls: T[]): T[] {
  const seen = new Set<string>()
  const unique = calls.filter((c) => {
    if (seen.has(c.tagId)) return false
    seen.add(c.tagId)
    return true
  })
  return unique.slice(0, MAX_AI_TAGS_PER_REPLY)
}
