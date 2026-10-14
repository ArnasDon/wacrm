import type { SqlConnection } from './transaction';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  type ApiWebhookEndpoint,
} from '@/lib/webhooks/endpoints';
type Result<T> = { rows: T[] };
export interface WebhookUpdate {
  url?: string;
  events?: string[];
  is_active?: boolean;
}
export async function listWebhooks(
  db: SqlConnection,
  accountId: string
): Promise<ApiWebhookEndpoint[]> {
  return (
    (await db.query(
      `SELECT ${WEBHOOK_PUBLIC_COLUMNS} FROM public.webhook_endpoints WHERE account_id=$1 ORDER BY created_at DESC,id DESC`,
      [accountId]
    )) as Result<ApiWebhookEndpoint>
  ).rows;
}
export async function getWebhook(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<ApiWebhookEndpoint | null> {
  return (
    (
      (await db.query(
        `SELECT ${WEBHOOK_PUBLIC_COLUMNS} FROM public.webhook_endpoints WHERE account_id=$1 AND id=$2`,
        [accountId, id]
      )) as Result<ApiWebhookEndpoint>
    ).rows[0] ?? null
  );
}
export async function createWebhook(
  db: SqlConnection,
  accountId: string,
  userId: string,
  input: { url: string; secret: string; events: string[] }
): Promise<ApiWebhookEndpoint> {
  return (
    (await db.query(
      `INSERT INTO public.webhook_endpoints(account_id,created_by,url,secret,events) VALUES($1,$2,$3,$4,$5) RETURNING ${WEBHOOK_PUBLIC_COLUMNS}`,
      [accountId, userId, input.url, input.secret, input.events]
    )) as Result<ApiWebhookEndpoint>
  ).rows[0];
}
export async function updateWebhook(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: WebhookUpdate
): Promise<ApiWebhookEndpoint | null> {
  return (
    (
      (await db.query(
        `UPDATE public.webhook_endpoints SET url=COALESCE($3,url),events=COALESCE($4::text[],events),is_active=COALESCE($5,is_active),failure_count=CASE WHEN $5::boolean IS TRUE THEN 0 ELSE failure_count END WHERE account_id=$1 AND id=$2 RETURNING ${WEBHOOK_PUBLIC_COLUMNS}`,
        [
          accountId,
          id,
          input.url ?? null,
          input.events ?? null,
          input.is_active ?? null,
        ]
      )) as Result<ApiWebhookEndpoint>
    ).rows[0] ?? null
  );
}
export async function deleteWebhook(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<{ id: string } | null> {
  return (
    (
      (await db.query(
        'DELETE FROM public.webhook_endpoints WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )) as Result<{ id: string }>
    ).rows[0] ?? null
  );
}
export async function recordWebhookFailure(
  db: SqlConnection,
  accountId: string,
  id: string,
  threshold: number
): Promise<void> {
  await db.query(
    'UPDATE public.webhook_endpoints SET failure_count=failure_count+1,is_active=CASE WHEN failure_count+1 >= $3 THEN false ELSE is_active END WHERE account_id=$1 AND id=$2',
    [accountId, id, threshold]
  );
}
