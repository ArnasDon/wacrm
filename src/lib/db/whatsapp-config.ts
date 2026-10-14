import type { WhatsAppConfig } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
export async function readWhatsAppConfig(db: SqlConnection, accountId: string) {
  const [row] = await queryRows<{ config: WhatsAppConfig }>(
    db,
    'SELECT to_jsonb(w) AS config FROM public.whatsapp_config w WHERE account_id=$1',
    [accountId]
  );
  return row?.config ?? null;
}
export async function saveWhatsAppConfig(
  db: SqlConnection,
  userId: string,
  input: Record<string, unknown>
) {
  const ctx = await resolveAccount(db, userId);
  const keys = [
    'phone_number_id',
    'waba_id',
    'access_token',
    'verify_token',
    'status',
    'connected_at',
    'registered_at',
    'subscribed_apps_at',
    'last_registration_error',
  ] as const;
  await db.query(
    `INSERT INTO public.whatsapp_config(user_id,account_id,${keys.join(',')})
    VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) ON CONFLICT (account_id)
    DO UPDATE SET ${keys.map((key) => `${key}=EXCLUDED.${key}`).join(',')},updated_at=now()`,
    [userId, ctx.accountId, ...keys.map((key) => input[key] ?? null)]
  );
}
export async function deleteWhatsAppConfig(
  db: SqlConnection,
  accountId: string
) {
  await db.query('DELETE FROM public.whatsapp_config WHERE account_id=$1', [
    accountId,
  ]);
}
export async function phoneClaimedByAnotherAccount(
  db: SqlConnection,
  accountId: string,
  phoneId: string
) {
  return (
    (
      await queryRows(
        db,
        'SELECT id FROM public.whatsapp_config WHERE phone_number_id=$1 AND account_id<>$2 LIMIT 1',
        [phoneId, accountId]
      )
    ).length > 0
  );
}
export async function setMirrorPreference(
  db: SqlConnection,
  accountId: string,
  enabled: boolean
) {
  await db.query(
    'UPDATE public.whatsapp_config SET mirror_inbound_media=$1,updated_at=now() WHERE account_id=$2',
    [enabled, accountId]
  );
}
