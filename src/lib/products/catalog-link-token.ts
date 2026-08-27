// ============================================================
// Signed `?c=` token for the public catalog link.
//
// `sendCatalogToConversation` puts the originating conversation id in
// the catalog URL so the public "Me lo llevo" flow can push the quote
// straight back into that exact conversation. That id was previously
// carried raw — but the catalog `accountId` is public and the route
// only checked "does this conversation belong to that account", so a
// visitor could swap in any conversation id of the account and have a
// quote (and their typed phone number) land on someone else's thread.
//
// The id is now HMAC-signed with the instance's `ENCRYPTION_KEY`, so a
// visitor can't fabricate or swap one. A missing / stale / bad token
// simply falls back to the phone-based contact resolution the no-`?c=`
// path already uses — old links keep working, just without the
// instant-push fast path.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIG_LEN = 24; // hex chars — 96 bits, ample for a non-secret URL param

function key(): string {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not configured.');
  return k;
}

function sign(conversationId: string): string {
  return createHmac('sha256', key())
    .update(`catalog-conv:${conversationId}`)
    .digest('hex')
    .slice(0, SIG_LEN);
}

/** `<conversationId>.<sig>` — the value to put in the catalog link's `?c=`. */
export function signCatalogConversation(conversationId: string): string {
  return `${conversationId}.${sign(conversationId)}`;
}

/**
 * Extract the conversation id from a `?c=` token, or `null` when the
 * token is absent, malformed, or the signature doesn't verify. Callers
 * treat `null` as "no trusted conversation — resolve the contact by
 * phone instead".
 */
export function verifyCatalogConversation(
  token: string | null | undefined,
): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1).toLowerCase();
  if (sig.length !== SIG_LEN) return null;

  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}
