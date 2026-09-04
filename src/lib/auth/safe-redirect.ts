// ============================================================
// Safe "next" redirect validation (security audit finding AUTH-N1 —
// password recovery). Used by `/auth/callback` to decide where to
// send the browser after `exchangeCodeForSession` succeeds.
//
// `next` arrives as a raw query-string value on a PUBLIC, unauthenticated
// entry point — it must never be trusted as a destination without
// validation, or this callback becomes an open redirect (a `code` is
// still required to reach the success path, but the failure/absent-code
// path and any future reuse of this same callback for other Supabase
// Auth flows — email confirmation, magic link — would otherwise inherit
// the same hole).
//
// Only same-origin, absolute-path references are allowed:
//   OK:      "/reset-password", "/dashboard", "/join/abc123"
//   REJECTED: "https://evil.example", "//evil.example",
//             "/\\evil.example" (backslash — some browsers normalize a
//             leading "/\" into "//", turning a path into a
//             protocol-relative, i.e. external, URL), anything not
//             starting with exactly one "/".
// ============================================================

/** Fallback when `next` is missing, empty, or fails validation. */
export const DEFAULT_SAFE_REDIRECT = '/login'

function isSafeInternalPath(candidate: string): boolean {
  if (candidate.includes('\\')) return false
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return false

  // Defense in depth: resolve against a fixed placeholder origin and
  // confirm the candidate didn't smuggle in its own scheme/host despite
  // the checks above (e.g. via a URL-encoding trick the string checks
  // don't catch). If parsing itself fails, treat as unsafe.
  try {
    const resolved = new URL(candidate, 'http://internal.invalid')
    return resolved.protocol === 'http:' && resolved.host === 'internal.invalid'
  } catch {
    return false
  }
}

/**
 * Validate a caller-supplied `next` path. Returns `fallback`
 * (default {@link DEFAULT_SAFE_REDIRECT}) for anything missing or
 * unsafe — never the raw input.
 */
export function sanitizeNextPath(
  rawNext: string | null | undefined,
  fallback: string = DEFAULT_SAFE_REDIRECT
): string {
  if (!rawNext) return fallback
  return isSafeInternalPath(rawNext) ? rawNext : fallback
}
