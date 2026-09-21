import { describe, expect, it } from 'vitest';

import { decrypt, encrypt } from './encryption';
import { resolveVerifyTokenForSave } from './verify-token';

/**
 * Regression cover for the settings page silently dropping the webhook
 * verify token.
 *
 * The settings form never shows the stored token (it is encrypted at rest
 * and the GET endpoint does not return it), so the field is always empty
 * when the page loads. Saving any OTHER field then posted `verify_token`
 * as empty, and the route wrote NULL over the stored value. Measured live
 * on 2026-09-05: `whatsapp_config.verify_token` was NULL, every Meta GET
 * handshake got 403, and from the outside that was indistinguishable from
 * a wrong token.
 *
 * Contract: an empty incoming token means "keep what is stored". Clearing
 * the token on its own is not a supported operation — "Reset Configuration"
 * wipes the whole row for that.
 */
describe('resolveVerifyTokenForSave', () => {
  const stored = encrypt('old-token');

  it('a non-empty incoming token replaces the stored one, re-encrypted', () => {
    const out = resolveVerifyTokenForSave('new-token', stored);
    expect(out).not.toBeNull();
    expect(out).not.toBe(stored);
    expect(decrypt(out!)).toBe('new-token');
  });

  it.each([undefined, null, '', '   '])(
    'incoming %j keeps the stored encrypted token untouched',
    (incoming) => {
      expect(resolveVerifyTokenForSave(incoming, stored)).toBe(stored);
    }
  );

  it('nothing incoming and nothing stored stays null', () => {
    expect(resolveVerifyTokenForSave(undefined, null)).toBeNull();
    expect(resolveVerifyTokenForSave('', null)).toBeNull();
  });

  it('trims surrounding whitespace before encrypting', () => {
    const out = resolveVerifyTokenForSave('  padded  ', null);
    expect(decrypt(out!)).toBe('padded');
  });
});
