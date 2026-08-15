# Security-Sensitive Code

Scope: `src/lib/auth/**`, `src/lib/supabase/**`, `src/lib/api-keys/**`, `src/lib/whatsapp/encryption.ts`, webhook handlers (`src/lib/webhooks/**`, `src/app/api/**/webhook*/**`)

wacrm ships as a self-hosted template — a slip here is a slip in every fork that doesn't catch it. Be conservative; when in doubt, match the existing pattern exactly rather than improvising a variant.

## Two auth paths, never mix them

- **Dashboard (human)**: Supabase cookie session, resolved via `src/lib/supabase/server.ts` → `createClient()` (anon key, RLS enforced) or `src/lib/auth/account.ts` (`getCurrentAccount`). RLS is the actual security boundary here.
- **Public API (machine)**: `Authorization: Bearer wacrm_live_...` resolved via `src/lib/auth/api-context.ts` → `requireApiKey()`, which returns a **service-role client that bypasses RLS**. The account is fixed at key-lookup time; every downstream query on that client must be explicitly `.eq('account_id', ctx.accountId)` — there is no RLS safety net on this path, the filter *is* the boundary.

Never use the service-role/admin client (`src/lib/*/admin-client.ts`, `supabaseAdmin()`) from a code path that serves an authenticated dashboard request unless there's a specific documented reason (background job, cross-account operation) — the cookie-session client is what keeps RLS in effect for a human.

## Secrets at rest

- **API keys**: only the SHA-256 hash (`key_hash`) is stored; the plaintext is shown exactly once at creation and never persisted (`src/lib/api-keys/keys.ts`). Follow this for any new bearer-token-shaped credential.
- **WhatsApp / OAuth-style tokens**: AES-256-GCM via `src/lib/whatsapp/encryption.ts` (`encrypt`/`decrypt`), keyed by `ENCRYPTION_KEY`. GCM specifically — not CBC — because it's authenticated; a tampered ciphertext fails decryption instead of silently producing garbage that might parse as a valid token. Reuse `encrypt`/`decrypt` for any new secret column rather than writing a parallel cipher.
- **Invitation tokens**: `token_hash`, same hash-don't-store-plaintext pattern (`account_invitations`).
- Never log a decrypted secret, a full API key, or a raw bearer token — logging the key id / prefix / hash is fine, the secret value is not.

## Webhook signatures

- **Inbound** (Meta → this app): verify the `X-Hub-Signature-256` HMAC before trusting the payload — don't process an unverified webhook body.
- **Outbound** (this app → a customer's endpoint, `src/lib/webhooks/`): sign every delivery with HMAC so the receiver can verify authenticity; don't add an outbound webhook type that skips signing.

## Adding a new authenticated surface

If you're adding a new way to authenticate a request (not a new scope on the existing API-key system — an actual new mechanism), stop and confirm with the user first. Two auth paths is a deliberate, minimal design; a third one needs a reason.

## Rate limiting

Public-API rate limiting is centralized in `src/lib/rate-limit.ts` and applied inside `requireApiKey` — see `api-v1-routes.md`. Don't add a bespoke limiter elsewhere for a public-API route; do add one (following the same module) for any new unauthenticated or high-cost endpoint (e.g. a webhook receiver).
