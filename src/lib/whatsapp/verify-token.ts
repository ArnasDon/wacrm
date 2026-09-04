import { encrypt } from './encryption';

/**
 * Decide what `whatsapp_config.verify_token` should hold after a config save.
 *
 * The settings form never shows the stored token (it is encrypted at rest
 * and the GET endpoint does not return it), so the field arrives empty on
 * every save that did not deliberately change it. Empty therefore means
 * "keep what is stored", not "clear it" — the previous
 * `incoming ? encrypt(incoming) : null` nulled the token whenever any OTHER
 * field was saved. Measured live on 2026-09-05: the row had
 * verify_token = NULL and every Meta GET handshake got 403, which from the
 * outside looks exactly like a wrong token.
 *
 * Clearing the token on its own is not a supported operation; "Reset
 * Configuration" wipes the whole row for that.
 */
export function resolveVerifyTokenForSave(
  incoming: string | null | undefined,
  existingEncrypted: string | null
): string | null {
  const trimmed = typeof incoming === 'string' ? incoming.trim() : '';
  if (trimmed) return encrypt(trimmed);
  return existingEncrypted ?? null;
}
