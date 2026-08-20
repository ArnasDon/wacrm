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
 * Compute a recipient's default message: `{{nome}}` replaced by the
 * contact's name (falling back to phone — findOrCreateContact already
 * seeds `name` with the phone when none was given, so this is mostly
 * a defensive fallback for a contact edited to have a blank name).
 * This is the value shown in the preview/review step before any
 * manual per-recipient edit (broadcast_recipients.message_text)
 * overrides it.
 */
export function resolveExternalMessage(
  template: string,
  contact: { name?: string | null; phone?: string | null },
): string {
  const name = contact.name?.trim() || contact.phone?.trim() || '';
  return template.replace(NOME_PLACEHOLDER, name);
}
