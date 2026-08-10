// ============================================================
// Render a template's stored body into the plain text we persist on
// `messages.content_text` (and preview on `conversations.last_message_text`).
//
// Meta only ever receives the template *name* plus its parameters — the
// body text lives in the approved template, not in the send payload. So
// unless we substitute the params ourselves at send time, the Inbox has
// nothing to show and the thread renders an empty bubble.
//
// Shared by every outbound template path: the send core behind both
// `/api/whatsapp/send` and `/api/v1/messages`, the automation engine,
// and the dashboard composer (which pre-renders client-side so the
// optimistic bubble reads correctly before the insert round-trips).
// ============================================================

import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';

/**
 * Substitute `{{1}}`, `{{2}}`, … in a template body with positional
 * `params`. A placeholder with no corresponding value is left intact
 * rather than blanked, so a partially-filled body still reads as a
 * template with a missing value instead of silently losing text.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

/**
 * Pick the body values out of the two shapes callers may supply:
 * structured `messageParams.body` (the current send-builder path) or a
 * bare positional array (the legacy path). Mirrors how
 * `sendTemplateMessage` resolves the same pair, so what we persist can't
 * drift from what Meta was actually sent.
 */
export function resolveTemplateBodyParams(
  messageParams: unknown,
  legacyParams?: string[]
): string[] {
  const structured =
    messageParams && typeof messageParams === 'object'
      ? (messageParams as SendTimeParams).body
      : undefined;
  return structured ?? legacyParams ?? [];
}
