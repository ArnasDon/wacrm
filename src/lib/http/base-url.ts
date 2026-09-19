// ============================================================
// Public base URL for links we hand to third parties (invite links,
// Paystack/Flutterwave callback URLs, Gmail OAuth redirect).
//
// APP_URL (or NEXT_PUBLIC_SITE_URL) pins it. Without either we fall
// back to the request's Host — acceptable in development, but a
// spoofed Host header could then steer a payment callback or invite
// link to another domain, so ALLOWED_HOSTS is honoured when set and
// production deployments should always set APP_URL.
// ============================================================

export function getAppBaseUrl(request?: Request): string {
  const pinned = (process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (pinned) return pinned.replace(/\/+$/, '')
  if (!request) return 'http://localhost:3000'

  const allow = (process.env.ALLOWED_HOSTS || process.env.ALLOWED_INVITE_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const host = request.headers.get('host')?.trim().toLowerCase()
  if (host && (allow.length === 0 || allow.includes(host.split(':')[0]))) {
    const proto = new URL(request.url).protocol.replace(':', '')
    return `${proto}://${host}`
  }
  return 'http://localhost:3000'
}
