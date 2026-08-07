// ============================================================
// Environment readers for the "Connect Google Calendar" web OAuth
// flow (authorize/callback routes). Kept separate from
// `googleOAuthCredentialsFromEnv` in client.ts, which is about
// talking to Google's APIs — these two are specific to running the
// consent redirect from *this* app's routes and don't apply to, say,
// a future non-web caller of client.ts that already has a refresh
// token in hand.
//
// Both throw loudly (never return undefined) so a missing var fails
// at the first route hit that needs it, not as a cryptic downstream
// error. See docs/eter-agent-config.md for what to set and why.
// ============================================================

export class OAuthConfigError extends Error {
  readonly code = 'missing_oauth_config' as const
  constructor(message: string) {
    super(message)
    this.name = 'OAuthConfigError'
  }
}

/**
 * Secret used to HMAC-sign the `state` query parameter for the OAuth
 * "Connect" flow — see `src/lib/calendar/google/oauth-state.ts`. Must
 * be a high-entropy random string, distinct from `ENCRYPTION_KEY`
 * (which encrypts the refresh token at rest, a different threat
 * model): this one only needs to resist forgery of the state token,
 * never decryption.
 */
export function googleOAuthStateSecretFromEnv(): string {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET
  if (!secret) {
    throw new OAuthConfigError(
      'GOOGLE_OAUTH_STATE_SECRET is not configured — see docs/eter-agent-config.md.',
    )
  }
  return secret
}

/**
 * The `redirect_uri` sent to Google, and the one it will call back
 * to. Must exactly match an "Authorized redirect URI" registered on
 * the OAuth client in Google Cloud Console — a mismatch fails the
 * exchange with `redirect_uri_mismatch`, not a silent fallback.
 */
export function googleOAuthRedirectUriFromEnv(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!uri) {
    throw new OAuthConfigError(
      'GOOGLE_OAUTH_REDIRECT_URI is not configured — see docs/eter-agent-config.md.',
    )
  }
  return uri
}
