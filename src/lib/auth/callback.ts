// ============================================================
// Helpers for /auth/callback — the landing route for every link
// Supabase emails on the app's behalf (email confirmation, password
// reset, invite, magic link).
//
// Pure functions, kept out of the route file so they can be unit
// tested without Next request plumbing (vitest runs `environment:
// "node"` with no jsdom — see vitest.config.ts).
// ============================================================

import type { EmailOtpType } from '@supabase/supabase-js';

/** Where a link lands when it carries no usable `next`. */
export const DEFAULT_NEXT_PATH = '/dashboard';

/** Where a link that could not be exchanged for a session lands. */
export const LOGIN_PATH = '/login';

/**
 * The `?error=` values /login knows how to explain. Anything else
 * emitted here must get a message in `LoginPage`.
 */
export type CallbackFailure =
  /** Supabase itself reported the link expired (`error_code=otp_expired`). */
  | 'link_expired'
  /** No `code` / `token_hash` at all, a bad `type`, or the exchange failed. */
  | 'link_invalid';

const MAX_NEXT_LENGTH = 2048;

/**
 * Coerce the `next` query parameter into a same-origin absolute path.
 *
 * `next` is query-string input. Without this, `?next=//evil.example`
 * (or `/\evil.example`, which browsers treat the same) would turn the
 * callback into an open redirect the moment a session is minted.
 * Rules: must start with a single `/`, the second character may not be
 * `/` or `\`, and no control characters (a CR/LF would split the
 * Location header). Anything else falls back to `fallback`.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_NEXT_LENGTH) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) {
    return fallback;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  return value;
}

/** Values Supabase's `verifyOtp` accepts for an emailed `token_hash`. */
const EMAIL_OTP_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

export function isEmailOtpType(value: string | null): value is EmailOtpType {
  return typeof value === 'string' && EMAIL_OTP_TYPES.has(value);
}

/**
 * The two shapes an emailed Supabase link can take by the time it hits
 * this route, or `null` when neither is present:
 *
 *   - `code`: the PKCE flow. `@supabase/ssr`'s browser client starts
 *     every sign-up / reset with a code challenge, so the default
 *     `{{ .ConfirmationURL }}` email templates redirect here with
 *     `?code=...`. Exchanged server-side via `exchangeCodeForSession`
 *     (the code verifier lives in a cookie the server can read).
 *   - `token_hash` + `type`: what a template customised to use
 *     `{{ .TokenHash }}` sends. Exchanged via `verifyOtp`. Doesn't need
 *     the verifier cookie, so it also works when the link is opened in
 *     a different browser than the one that requested it.
 */
export type EmailLink =
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string; type: EmailOtpType };

export function parseEmailLink(params: URLSearchParams): EmailLink | null {
  const code = params.get('code')?.trim();
  if (code) return { kind: 'code', code };

  const tokenHash = params.get('token_hash')?.trim();
  const type = params.get('type');
  if (tokenHash && isEmailOtpType(type)) {
    return { kind: 'token_hash', tokenHash, type };
  }

  return null;
}

/**
 * Supabase reports a link it could not verify (expired, already used)
 * by redirecting to us with `error`, `error_code` and
 * `error_description` instead of a credential. Map that to the one
 * failure /login can explain precisely; everything else is generic.
 */
export function parseSupabaseError(
  params: URLSearchParams,
): CallbackFailure | null {
  const errorCode = params.get('error_code');
  const error = params.get('error');
  if (!errorCode && !error) return null;
  return errorCode === 'otp_expired' ? 'link_expired' : 'link_invalid';
}

export function loginFailurePath(reason: CallbackFailure): string {
  return `${LOGIN_PATH}?error=${reason}`;
}

/**
 * A redirect whose `Location` is a *relative* path.
 *
 * `NextResponse.redirect()` insists on an absolute URL, and building
 * one from the request breaks behind a reverse proxy: a Cloudflare
 * Tunnel forwards `Host: localhost:3000` with `x-forwarded-proto:
 * https`, so `request.nextUrl.origin` comes out as
 * `https://localhost:3000` and resolves nowhere. Browsers resolve a
 * relative `Location` against the URL they actually loaded, which is
 * right on localhost and behind any proxy. 303 makes the follow-up a
 * GET regardless of the method that arrived.
 */
export function relativeRedirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      // A callback that just minted (or failed to mint) a session must
      // never be served from a cache.
      'Cache-Control': 'no-store',
    },
  });
}
