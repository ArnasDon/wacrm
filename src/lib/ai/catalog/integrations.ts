// ============================================================
// catalog_integrations service — CRUD + connection test for external
// Catalog API providers (Budun ERP is the only authorized `provider`
// value in this execution — see migration 044).
//
// Secrets are AES-256-GCM-encrypted with the SAME encrypt()/decrypt()
// already used for whatsapp_config.access_token / ai_configs.api_key /
// webhook_endpoints.secret — no new crypto, per
// docs/integrations/ai-data-integration/02_SCOPE_AND_GUARDRAILS.md
// ("Regla de mínima intervención").
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { BudunClient } from '@/lib/budun/client'

export interface CatalogIntegrationRow {
  id: string
  account_id: string
  provider: 'budun'
  display_name: string
  base_url: string
  app_key: string | null
  scopes: string[]
  status: 'active' | 'disabled' | 'error'
  priority: number
  is_primary: boolean
  last_test_at: string | null
  last_test_ok: boolean | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const PUBLIC_COLUMNS =
  'id, account_id, provider, display_name, base_url, app_key, scopes, status, priority, is_primary, last_test_at, last_test_ok, last_error, created_at, updated_at'

export async function listCatalogIntegrations(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogIntegrationRow[]> {
  const { data, error } = await db
    .from('catalog_integrations')
    .select(PUBLIC_COLUMNS)
    .eq('account_id', accountId)
    .order('is_primary', { ascending: false })
    .order('priority', { ascending: true })
  if (error) throw error
  return (data ?? []) as CatalogIntegrationRow[]
}

/** Loads the account's active catalog integrations WITH the decrypted
 *  secret, for the resolver / tool executor only. Never returned to the
 *  client — routes must select `PUBLIC_COLUMNS` instead. */
export async function loadActiveCatalogIntegrations(
  db: SupabaseClient,
  accountId: string,
): Promise<{ row: CatalogIntegrationRow; secret: string }[]> {
  const { data, error } = await db
    .from('catalog_integrations')
    .select(`${PUBLIC_COLUMNS}, encrypted_secret`)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .order('is_primary', { ascending: false })
    .order('priority', { ascending: true })
  if (error) throw error

  const out: { row: CatalogIntegrationRow; secret: string }[] = []
  for (const raw of data ?? []) {
    const { encrypted_secret, ...row } = raw as CatalogIntegrationRow & { encrypted_secret: string }
    try {
      out.push({ row, secret: decrypt(encrypted_secret) })
    } catch (err) {
      console.error(
        `[catalog integrations] secret for integration ${row.id} could not be decrypted — check ENCRYPTION_KEY:`,
        err instanceof Error ? err.message : err,
      )
      // Skip a corrupt integration rather than throwing — one bad row
      // must not take down catalog tools for every other configured
      // source on the account.
    }
  }
  return out
}

export function buildBudunClient(row: CatalogIntegrationRow, secret: string): BudunClient {
  return new BudunClient({ baseUrl: row.base_url, secret, appKey: row.app_key })
}

export interface SaveCatalogIntegrationInput {
  /** Present → update that row. Absent → create. */
  id?: string
  provider: 'budun'
  /** Required to create; when updating, `undefined` leaves the stored
   *  value unchanged (a JSON body simply omits the key). */
  displayName?: string
  baseUrl?: string
  /** `undefined` = leave unchanged. `null` or `''` = explicitly clear. */
  appKey?: string | null
  /** Plaintext — only present when the caller is setting/rotating it.
   *  Omitted on an update that leaves the secret unchanged. */
  secret?: string
  scopes?: string[]
  /** `undefined` = leave unchanged. `true`/`false` = set explicitly. */
  isPrimary?: boolean
  priority?: number
}

const DEFAULT_SCOPES = ['catalog:read', 'catalog:availability:read', 'catalog:media:read']

export async function saveCatalogIntegration(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: SaveCatalogIntegrationInput,
): Promise<CatalogIntegrationRow> {
  if (input.isPrimary === true) {
    // Only one primary integration per account — demote any other
    // active row before promoting this one (app-level, not a DB
    // constraint, so a save never fails on a race; the UI re-reads
    // after saving).
    await db.from('catalog_integrations').update({ is_primary: false }).eq('account_id', accountId)
  }

  // Only include a key in the update payload when the caller actually
  // means to change it — omitting a field here (not sending `undefined`
  // explicitly, just not setting the key) is what keeps a PATCH that
  // only rotates the secret from silently wiping app_key/is_primary/etc.
  const base: Record<string, unknown> = { provider: input.provider }
  if (input.displayName !== undefined) base.display_name = input.displayName
  if (input.baseUrl !== undefined) base.base_url = input.baseUrl
  if (input.appKey !== undefined) base.app_key = input.appKey || null
  if (input.scopes !== undefined) base.scopes = input.scopes.length > 0 ? input.scopes : DEFAULT_SCOPES
  if (input.isPrimary !== undefined) base.is_primary = input.isPrimary
  if (input.priority !== undefined) base.priority = input.priority
  if (input.secret) base.encrypted_secret = encrypt(input.secret)

  if (input.id) {
    const { data, error } = await db
      .from('catalog_integrations')
      .update(base)
      .eq('id', input.id)
      .eq('account_id', accountId)
      .select(PUBLIC_COLUMNS)
      .single()
    if (error) throw error
    return data as CatalogIntegrationRow
  }

  if (!input.secret) {
    throw new Error('secret is required to create a new integration')
  }
  if (!input.displayName || !input.baseUrl) {
    throw new Error('displayName and baseUrl are required to create a new integration')
  }
  const { data, error } = await db
    .from('catalog_integrations')
    .insert({
      ...base,
      display_name: input.displayName,
      base_url: input.baseUrl,
      scopes: base.scopes ?? DEFAULT_SCOPES,
      is_primary: base.is_primary ?? false,
      account_id: accountId,
      created_by: userId,
    })
    .select(PUBLIC_COLUMNS)
    .single()
  if (error) throw error
  return data as CatalogIntegrationRow
}

export async function deleteCatalogIntegration(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<void> {
  const { error } = await db.from('catalog_integrations').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw error
}

/** Runs BudunClient.testConnection() and persists the result — same
 *  "Test Connection" contract as `whatsapp_config` (GET always 200s
 *  with a structured `{ok, message}` rather than propagating upstream
 *  status). */
export async function testCatalogIntegration(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const { data, error } = await db
    .from('catalog_integrations')
    .select(`${PUBLIC_COLUMNS}, encrypted_secret`)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    return { ok: false, message: 'Integración no encontrada.', latencyMs: 0 }
  }

  const { encrypted_secret, ...row } = data as CatalogIntegrationRow & { encrypted_secret: string }
  let secret: string
  try {
    secret = decrypt(encrypted_secret)
  } catch {
    return {
      ok: false,
      message: 'El secreto guardado no se pudo descifrar (ENCRYPTION_KEY distinto). Vuelve a guardarlo.',
      latencyMs: 0,
    }
  }

  const client = buildBudunClient(row as CatalogIntegrationRow, secret)
  const result = await client.testConnection()

  await db
    .from('catalog_integrations')
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_error: result.ok ? null : result.message,
      status: result.ok ? 'active' : row.status === 'disabled' ? 'disabled' : 'error',
    })
    .eq('id', id)
    .eq('account_id', accountId)

  return result
}
