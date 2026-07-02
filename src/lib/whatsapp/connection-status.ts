/**
 * Whether ANY provider row for an account is connected.
 *
 * `whatsapp_config` is one-row-per-account-per-provider (migration 029
 * widened the uniqueness from one-row-per-account to (account_id,
 * provider) so Meta and Uazapi can coexist on the same account) — a
 * caller must not assume a single row. `.maybeSingle()` errors (and
 * silently resolves to no data) when more than one row matches, which
 * previously made the inbox's "WhatsApp not connected" banner show even
 * with a working Uazapi connection whenever a Meta row also existed.
 */
export function isAnyProviderConnected(
  rows: Array<{ status: string | null }> | null | undefined,
): boolean {
  return Boolean(rows?.some((row) => row.status === 'connected'))
}
