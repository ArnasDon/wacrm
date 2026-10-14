// ============================================================
// Template body resolution — the local `message_templates` row for a
// send, and the substituted body text we persist alongside it.
//
// Every path that sends a template needs the same two things:
//
//   1. the row (for the send-builder's header/button components), and
//   2. the rendered body, so `messages.content_text` carries the text
//      the customer actually received rather than NULL (issue #483).
//
// Both used to be done ad hoc per caller — the dashboard composer
// rendered the body client-side and posted it as `content_text`, while
// the public API and the automation engine stored nothing, so their
// sends landed in the Inbox as empty bubbles.
// ============================================================




import type { MessageTemplate } from '@/types';

/**
 * Substitute positional `{{1}}`, `{{2}}`… placeholders in a template
 * body. A placeholder with no corresponding param is left as-is rather
 * than blanked, so a caller that under-supplies params gets a visible
 * `{{2}}` instead of a silently truncated sentence.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

/**
 * Positional body values out of either param shape a caller may send:
 * the structured `{ body: [...] }` object the composer posts, or the
 * legacy flat array. Structured wins — `sendTemplateMessage` merges
 * them the same way, so what we render matches what Meta is sent.
 */
export function templateBodyParams(
  templateParams?: string[] | null,
  templateMessageParams?: unknown
): string[] {
  const structured =
    templateMessageParams &&
    typeof templateMessageParams === 'object' &&
    Array.isArray((templateMessageParams as { body?: unknown }).body)
      ? ((templateMessageParams as { body: unknown[] }).body.filter(
          (v): v is string => typeof v === 'string'
        ) as string[])
      : null;

  if (structured && structured.length > 0) return structured;
  return Array.isArray(templateParams) ? templateParams : [];
}

export interface ResolvedTemplate {
  /** Best-matching local row, or null when the account has none. */
  row: MessageTemplate | null;
  /**
   * True when a row matched by name but failed the shape guard. Callers
   * surface their own error type — a malformed row would otherwise
   * crash deep inside the send-builder with an opaque TypeError.
   */
  malformed: boolean;
  /**
   * The language code to send to Meta: the caller's when they named
   * one, otherwise the matched row's, otherwise `en_US`. Callers that
   * pinned `en_US` unconditionally could not send an `en` template at
   * all — Meta rejects the pair as a missing translation.
   */
  language: string;
}

export {resolveLocalTemplate as resolveTemplateRow} from './template-local';

/**
 * The text to persist as `messages.content_text` for a template send.
 *
 * `callerText` wins when supplied — the dashboard composer renders the
 * body client-side and posts it, and it knows about header/button
 * values this function doesn't. Otherwise the body is rendered from the
 * local row. Null only when the account has no local copy of the
 * template, which is the one case where we genuinely don't know what
 * the customer saw.
 */
export function templateContentText(
  row: MessageTemplate | null,
  params: string[],
  callerText?: string | null
): string | null {
  if (callerText) return callerText;
  if (!row?.body_text) return null;
  return renderTemplateBody(row.body_text, params);
}
