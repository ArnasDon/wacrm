/**
 * Resolve the deployment's own public base URL (scheme + host, no
 * trailing slash) from an incoming request. Shared by anything that
 * needs a self-referential absolute URL — currently the Google
 * Calendar OAuth routes, which must send Google the exact
 * `redirect_uri` it will call back on.
 *
 * Resolution order, first match wins:
 *   1. `NEXT_PUBLIC_SITE_URL` — explicit operator config.
 *   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
 *      reverse proxy in front of the app (Hostinger, Vercel,
 *      Cloudflare, nginx).
 *   3. `Host` header + the request's own protocol — bare
 *      deployments without a proxy.
 *
 * Unlike `src/app/api/account/invitations/route.ts`'s private
 * `getBaseUrl` (same resolution shape), this has no
 * marketing-site fallback and no `ALLOWED_INVITE_HOSTS` allow-list:
 * a wrong guess here just makes Google reject the request with
 * `redirect_uri_mismatch` (Google only calls back on URIs registered
 * in the OAuth client, so a spoofed `Host` header can't redirect the
 * flow anywhere useful) rather than silently misdirecting a user, so
 * the extra defense-in-depth invitations needs doesn't apply here.
 */
export function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host) {
    const reqProto = new URL(request.url).protocol.replace(':', '');
    return `${reqProto}://${host}`;
  }

  throw new Error('Unable to determine base URL: no Host header on request.');
}
