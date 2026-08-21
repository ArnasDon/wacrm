// ============================================================
// Message personalization for 'external'-channel campaigns
// (migration 076/077) — a single named placeholder, `{{nome}}`,
// resolved to the recipient's contact name. Deliberately separate
// from the 'api' channel's positional {{1}}/{{2}} template-variable
// system (template-variables.ts): external campaigns have no
// template and no per-placeholder type mapping, just one name to
// drop in before export (spec section 2).
// ============================================================

/** Matches {{nome}}, {{ nome }}, {{Nome}}, etc. */
const NOME_PLACEHOLDER = /\{\{\s*nome\s*\}\}/gi;

/**
 * Matches `{{nome}}` plus any whitespace immediately before it, so
 * dropping the placeholder for a nameless contact doesn't leave a
 * stray space/comma dangling in front of the following punctuation
 * (e.g. "Oi {{nome}}!" -> "Oi!", not "Oi !").
 */
const NOME_PLACEHOLDER_WITH_LEADING_SPACE = /\s*\{\{\s*nome\s*\}\}/gi;

/**
 * Compute a recipient's default message: `{{nome}}` replaced by the
 * contact's name. A contact with no name (after trim) never falls back
 * to the phone number — the placeholder (and its leading whitespace)
 * is simply removed instead. This is the value shown in the
 * preview/review step before any manual per-recipient edit
 * (broadcast_recipients.message_text) overrides it.
 */
export function resolveExternalMessage(
  template: string,
  contact: { name?: string | null; phone?: string | null },
): string {
  const name = contact.name?.trim() ?? '';
  if (!name) {
    return template.replace(NOME_PLACEHOLDER_WITH_LEADING_SPACE, '');
  }
  return template.replace(NOME_PLACEHOLDER, name);
}
