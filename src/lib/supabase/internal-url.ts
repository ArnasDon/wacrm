// Server-side Supabase URL resolution for containerised deploys.
// Inside the app container the public URL (tunnel / localhost) is not
// reachable; kong is, by its compose DNS name (SUPABASE_INTERNAL_URL).

/** URL the server should use to reach Supabase. */
export function supabaseServerUrl(): string {
  return process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
}

/**
 * Auth cookie name. supabase-js derives it from the URL hostname, so when the
 * server talks to a different host than the browser the session cookie would
 * not match. Pin it to the name the browser (public URL) derives.
 */
export function supabaseAuthCookieName(): string {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname
  return `sb-${host.split('.')[0]}-auth-token`
}

/**
 * Rewrites a URL built by the server against the internal Supabase host
 * (e.g. Storage public URLs) to the public origin, so what gets persisted is
 * reachable from the browser.
 */
export function toPublicSupabaseUrl(url: string): string {
  const internal = process.env.SUPABASE_INTERNAL_URL
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!internal || !publicUrl) return url
  const internalBase = internal.replace(/\/+$/, '')
  if (!url.startsWith(internalBase)) return url
  return publicUrl.replace(/\/+$/, '') + url.slice(internalBase.length)
}
