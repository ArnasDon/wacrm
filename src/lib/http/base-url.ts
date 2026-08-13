// ============================================================
// Shared base-URL resolution for every server route that builds a
// link a user will actually click (invite emails, password resets)
// or a URL a third party will call back (uazapi/Z-API webhook
// registration).
//
// Was copy-pasted 5 times across organization/sellers,
// platform/organizations, platform/accounts/[id]/reset-password,
// uazapi/instance, and z-api/instance — consolidated here after a
// misconfigured NEXT_PUBLIC_SITE_URL made every one of them resolve
// to localhost in production simultaneously (broken invite emails,
// and potentially broken inbound-message webhooks for any account
// connected via QR code while it was wrong). One shared function
// means one place to get this right, and the loud console.error
// below means the next time this breaks, it's visible in server
// logs immediately instead of discovered days later from a support
// message.
// ============================================================

/**
 * Resolves the canonical base URL for this deployment.
 *
 * Priority: `NEXT_PUBLIC_SITE_URL` (if set) always wins, even over
 * the incoming request's own Host header — that's deliberate (see
 * account/invitations/route.ts's own comment for the full
 * rationale), but it means a wrong value here silently breaks every
 * link/webhook URL this function feeds, which is exactly what
 * happened. The production+localhost check below exists so that
 * specific failure mode can never be silent again.
 */
export function resolveBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const resolved = explicit
    ? explicit.replace(/\/+$/, '')
    : deriveFromRequest(request);

  // Vercel sets VERCEL_ENV=production only on production deploys — a
  // resolved localhost URL there is always a misconfiguration.
  if (process.env.VERCEL_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(resolved)) {
    console.error(
      `[resolveBaseUrl] resolved to "${resolved}" in production — check NEXT_PUBLIC_SITE_URL`,
    );
  }

  return resolved;
}

function deriveFromRequest(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}
