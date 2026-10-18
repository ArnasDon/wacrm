import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

export type QuickReplyKind = 'text' | 'interactive'

export interface StoredQuickReply {
  kind: QuickReplyKind
  content_text: string | null
  interactive_payload: unknown
}

export type QuickReplyPatchResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string }

export function resolveQuickReplyPatch(
  body: Record<string, unknown>,
  stored: StoredQuickReply,
): QuickReplyPatchResult {
  const update: Record<string, unknown> = {}

  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return { ok: false, error: t('common.titleEmpty') }
    update.title = title
  }

  let kind = stored.kind
  if ('kind' in body) {
    if (body.kind !== 'text' && body.kind !== 'interactive') {
      return { ok: false, error: t('quickReplies.kindInvalid') }
    }
    kind = body.kind
    update.kind = kind
    if (kind === 'interactive') {
      update.interactive_payload = body.interactive_payload
      update.content_text = null
    } else {
      update.content_text = body.content_text
      update.interactive_payload = null
    }
  } else {
    if ('content_text' in body) update.content_text = body.content_text ?? null
    if ('interactive_payload' in body) {
      update.interactive_payload = body.interactive_payload ?? null
    }
  }

  const merged = { ...stored, ...update }

  if (merged.content_text != null && typeof merged.content_text !== 'string') {
    return { ok: false, error: t('quickReplies.contentTextRequired') }
  }

  if (kind === 'interactive' || update.interactive_payload != null) {
    const result = validateInteractivePayload(merged.interactive_payload)
    if (!result.ok) return { ok: false, error: result.error }
  }

  if (kind === 'text') {
    const text = merged.content_text
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: t('quickReplies.contentTextRequired') }
    }
  }

  return { ok: true, update }
}
