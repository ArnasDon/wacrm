import 'server-only'
import { getDb } from './mongo'

// ============================================================
// Cross-tenant lookups. Every export here is a deliberate,
// narrow exception to tenant scoping — add to this file only
// with a comment explaining why the lookup cannot know its
// accountId in advance.
// ============================================================

/**
 * Webhook routing: which account owns this WhatsApp number, and which
 * app secret signs its webhooks? Both are needed before we can verify
 * the signature, so this runs on an as-yet unauthenticated request —
 * it therefore returns nothing but the routing facts.
 */
export async function findWebhookRouteByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ accountId: string; appSecretEnc: string | null } | null> {
  if (typeof phoneNumberId !== 'string' || !phoneNumberId) return null
  const db = await getDb()
  const row = await db
    .collection<{ _id: string; accountId: string; phoneNumberId: string; appSecretEnc: string | null }>(
      'whatsapp_configs',
    )
    .findOne({ phoneNumberId }, { projection: { accountId: 1, appSecretEnc: 1 } })
  return row ? { accountId: row.accountId, appSecretEnc: row.appSecretEnc ?? null } : null
}

/** Config save: is this phone number already claimed by ANOTHER account? */
export async function isPhoneNumberIdClaimedElsewhere(
  phoneNumberId: string,
  accountId: string,
): Promise<boolean> {
  const db = await getDb()
  const row = await db
    .collection<{ _id: string; accountId: string }>('whatsapp_configs')
    .findOne({ phoneNumberId, accountId: { $ne: accountId } }, { projection: { _id: 1 } })
  return !!row
}

/** Payment webhook routing: the account id arrives in the URL path. */
export async function accountExists(accountId: string): Promise<boolean> {
  const db = await getDb()
  const row = await db
    .collection<{ _id: string }>('accounts')
    .findOne({ _id: accountId }, { projection: { _id: 1 } })
  return !!row
}

/**
 * Meta's webhook verification handshake only carries the verify
 * token, not the phone number — so we must check every account's
 * token. Constant work per config; decrypt failures are skipped.
 */
export async function verifyTokenMatchesAnyAccount(
  token: string,
  decryptFn: (enc: string) => string,
): Promise<boolean> {
  const db = await getDb()
  const rows = await db
    .collection<{ _id: string; verifyTokenEnc: string | null }>('whatsapp_configs')
    .find({ verifyTokenEnc: { $ne: null } }, { projection: { verifyTokenEnc: 1 } })
    .toArray()
  for (const row of rows) {
    try {
      if (row.verifyTokenEnc && decryptFn(row.verifyTokenEnc) === token) return true
    } catch {
      /* wrong key / corrupt row — skip */
    }
  }
  return false
}

/**
 * Telegram webhook routing: the secret in the URL says which account an
 * update belongs to. Nothing else about the request is trusted — the
 * caller still checks Telegram's secret header against this row.
 */
export async function findTelegramConfigBySecret(
  secret: string,
): Promise<{ accountId: string } | null> {
  if (typeof secret !== 'string' || secret.length < 20) return null
  const db = await getDb()
  const row = await db
    .collection<{ _id: string; accountId: string; webhookSecret: string }>('telegram_configs')
    .findOne({ webhookSecret: secret }, { projection: { accountId: 1 } })
  return row ? { accountId: row.accountId } : null
}
