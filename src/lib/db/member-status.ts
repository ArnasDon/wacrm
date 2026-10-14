import type { Notification } from '@/types';
import type { StoredPresence } from '@/lib/presence';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
export function listPresence(db: SqlConnection, accountId: string) {
  return queryRows<{
    user_id: string;
    status: StoredPresence;
    last_seen_at: string;
  }>(
    db,
    'SELECT user_id,status,last_seen_at FROM public.member_presence WHERE account_id=$1',
    [accountId]
  );
}
export async function touchPresence(db: SqlConnection, status: StoredPresence) {
  await db.query('SELECT public.touch_presence($1::text)', [status]);
}
export function listNotifications(
  db: SqlConnection,
  accountId: string,
  userId: string
) {
  return queryRows<Notification>(
    db,
    'SELECT * FROM public.notifications WHERE account_id=$1 AND user_id=$2 ORDER BY created_at DESC,id LIMIT 100',
    [accountId, userId]
  );
}
export async function markNotificationsRead(
  db: SqlConnection,
  accountId: string,
  userId: string,
  id: string | null
) {
  return (
    await queryRows(
      db,
      'UPDATE public.notifications SET read_at=now() WHERE account_id=$1 AND user_id=$2 AND read_at IS NULL AND ($3::uuid IS NULL OR id=$3) RETURNING id',
      [accountId, userId, id]
    )
  ).length;
}
export async function unreadCounts(
  db: SqlConnection,
  accountId: string,
  userId: string
) {
  const [row] = await queryRows<{
    conversations: number;
    notifications: number;
  }>(
    db,
    `SELECT
    (SELECT count(*)::int FROM public.conversations WHERE account_id=$1 AND unread_count > 0) AS conversations,
    (SELECT count(*)::int FROM public.notifications WHERE account_id=$1 AND user_id=$2 AND read_at IS NULL) AS notifications`,
    [accountId, userId]
  );
  return row;
}
